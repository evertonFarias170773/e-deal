/**
 * O que a Focus realmente respondeu, por baixo do envelope do n8n.
 *
 * POR QUE EXISTE
 *   O n8n devolve `status_code: 201`, `envio_focus_ok: true` e
 *   `erro_mensagem: "Created"` — e isso é o sucesso da chamada HTTP à Focus, não
 *   da autorização na SEFAZ. O resultado fiscal vem dentro de
 *   `retorno_focus.data`, e ali a NFE-20872-001 trazia
 *   `status: "erro_autorizacao"`, `status_sefaz: "732"`. Lendo só o 201, a tela
 *   tratou uma rejeição como sucesso.
 *
 * O QUE ESTE MÓDULO NÃO FAZ
 *   Não escreve nada. O estado da nota (`ERRO_AUTORIZACAO`, `erro_codigo`,
 *   `mensagem_sefaz`) é gravado pelo n8n, e está sendo gravado corretamente.
 */

export type DesfechoFocus =
  | { tipo: "AUTORIZADO"; status: string; codigo: string; mensagem: string }
  | { tipo: "REJEITADO"; status: string; codigo: string; mensagem: string }
  | { tipo: "PROCESSANDO"; status: string }
  /** O campo veio, mas não deu para ler. Isso é falha visível, não sucesso. */
  | { tipo: "ILEGIVEL"; motivo: string }
  /** Nem sinal do bloco. Não afirma nada — quem chamou segue consultando. */
  | { tipo: "INDETERMINADO" };

/** Status que a Focus devolve em `status`. */
const REJEICOES = ["erro_autorizacao", "denegado", "rejeitado", "erro"];
const AUTORIZACOES = ["autorizado"];
const EM_CURSO = ["processando_autorizacao", "processando", "em_processamento"];
/**
 * Nota cancelada não é recusa de emissão: ela foi autorizada e depois baixada, e
 * traz o código 135 ("Evento registrado e vinculado a NF-e"). Sem esta lista ela
 * cairia na decisão por código e apareceria como rejeição da SEFAZ. Fica
 * indeterminada de propósito — quem julga o cancelamento é o estado no banco.
 */
const NAO_JULGAR = ["cancelado", "cancelada"];

type Bruto = Record<string, unknown>;

function comoObjeto(valor: unknown): Bruto | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return comoObjeto(valor[0]);
  if (typeof valor === "object") return valor as Bruto;
  return null;
}

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

/**
 * Encontra o bloco de resultado fiscal.
 *
 * `retorno_focus.data` já apareceu como STRING JSON. Pode vir como objeto —
 * então as duas formas são aceitas, e só a string que não abre vira ILEGIVEL.
 */
function extrairData(corpo: Bruto): { dados: Bruto | null; havia: boolean; erroDeLeitura?: string } {
  const retornoFocus = comoObjeto(corpo.retorno_focus) ?? (corpo.retorno_focus ? null : null);

  const candidatos: unknown[] = [];
  if (retornoFocus && "data" in retornoFocus) candidatos.push(retornoFocus.data);
  if ("data" in corpo) candidatos.push(corpo.data);
  if (retornoFocus) candidatos.push(retornoFocus);

  for (const candidato of candidatos) {
    if (candidato === null || candidato === undefined || candidato === "") continue;

    if (typeof candidato === "string") {
      try {
        const aberto = comoObjeto(JSON.parse(candidato));
        if (aberto) return { dados: aberto, havia: true };
      } catch {
        return {
          dados: null,
          havia: true,
          erroDeLeitura: candidato.slice(0, 300)
        };
      }
      continue;
    }

    const objeto = comoObjeto(candidato);
    if (objeto) return { dados: objeto, havia: true };
  }

  // O corpo pode já ser o próprio resultado, sem envelope.
  if (texto(corpo.status) || texto(corpo.status_sefaz)) {
    return { dados: corpo, havia: true };
  }

  return { dados: null, havia: false };
}

export function lerDesfechoDaFocus(corpoBruto: unknown): DesfechoFocus {
  const corpo = comoObjeto(corpoBruto);
  if (!corpo) return { tipo: "INDETERMINADO" };

  const { dados, havia, erroDeLeitura } = extrairData(corpo);

  if (erroDeLeitura !== undefined) {
    return {
      tipo: "ILEGIVEL",
      motivo: `A integração respondeu com um retorno que não pôde ser lido: ${erroDeLeitura}`
    };
  }

  if (!havia || !dados) return { tipo: "INDETERMINADO" };

  const status = texto(dados.status).toLowerCase();
  const codigo = texto(dados.status_sefaz) || texto(dados.codigo_status_sefaz);
  const mensagem =
    texto(dados.mensagem_sefaz) || texto(dados.mensagem) || texto(dados.erro_mensagem);

  if (NAO_JULGAR.includes(status)) return { tipo: "INDETERMINADO" };

  if (REJEICOES.includes(status)) {
    return {
      tipo: "REJEITADO",
      status,
      codigo,
      mensagem: mensagem || "A SEFAZ recusou a nota e não detalhou o motivo."
    };
  }

  if (AUTORIZACOES.includes(status)) {
    return { tipo: "AUTORIZADO", status, codigo, mensagem };
  }

  if (EM_CURSO.includes(status)) {
    return { tipo: "PROCESSANDO", status };
  }

  // Sem `status` legível, mas com código da SEFAZ: só 100 é autorização.
  if (codigo) {
    if (codigo === "100") return { tipo: "AUTORIZADO", status: status || "autorizado", codigo, mensagem };
    return {
      tipo: "REJEITADO",
      status: status || "erro_autorizacao",
      codigo,
      mensagem: mensagem || `A SEFAZ devolveu o código ${codigo}.`
    };
  }

  return { tipo: "INDETERMINADO" };
}
