import { codigoDaCobrancaNaResposta, estadoDoRegistroBancario } from "../lib/registro-bancario";

/**
 * Registro de título faturado no Banco Inter (Ideal Birô), lado do Vibe.
 *
 * POR QUE EXISTE (04/11/2026, título 24402-A)
 *   O Inter aceitou a cobrança e levou ~20 min para emitir o boleto. O fluxo do
 *   n8n caiu esperando (429 no token, 401 na consulta), a rota mostrou erro, e
 *   cada nova tentativa criou outro boleto real: 7 no total. O Vibe nunca
 *   guardou o código da cobrança, e é nele que as travas contra duplicidade se
 *   apoiam (`boletos.id_boleto_c6`).
 *
 * AS REGRAS
 *   1. Título que já tem o código da cobrança NÃO é criado de novo: a rota
 *      retoma a consulta dela (`retomarRegistroInter`).
 *   2. Depois de chamar a criação, qualquer código que tenha chegado (na
 *      resposta ou já gravado pelo fluxo) é gravado no título se ele ainda não
 *      tiver, antes de qualquer outra coisa.
 *   3. Com código e sem boleto, o título fica EM PROCESSAMENTO — nunca volta a
 *      "boleto não registrado", que convida a clicar de novo.
 *
 * Módulo sem acesso a banco nem rede: quem chama passa as funções (o teste
 * passa dublês). Não muda o caminho normal: boleto pronto continua REGISTRADO.
 */

export type TituloLido = {
  id_boleto_c6?: string | null;
  nosso_numero?: string | null;
  linha_digitavel?: string | null;
  [coluna: string]: unknown;
};

export type RespostaDaIntegracao = { status: number; corpo: unknown };

export type ResultadoDoRegistro =
  | { tipo: "REGISTRADO"; idempotente: boolean; titulo: TituloLido }
  | { tipo: "EM_PROCESSAMENTO"; codigo: string; criadoAgora: boolean; codigoGravado: boolean }
  | { tipo: "NAO_CONFIRMADO"; mensagem: string };

const codigoDo = (t: TituloLido | null | undefined) => String(t?.id_boleto_c6 ?? "").trim();

/**
 * Título que já tem código: não cria outro. Pede a consulta (quando há uma
 * configurada) e relê o título, que o fluxo atualiza quando o boleto sai.
 */
export async function retomarRegistroInter(deps: {
  titulo: TituloLido;
  relerTitulo: () => Promise<TituloLido | null>;
  consultar?: (codigo: string) => Promise<void>;
}): Promise<ResultadoDoRegistro> {
  if (estadoDoRegistroBancario(deps.titulo) === "REGISTRADO") {
    return { tipo: "REGISTRADO", idempotente: true, titulo: deps.titulo };
  }
  const codigo = codigoDo(deps.titulo);
  if (deps.consultar) {
    try {
      await deps.consultar(codigo);
    } catch {
      // A consulta é só um empurrão; falhar nela não muda o estado do título.
    }
  }
  const relido = (await deps.relerTitulo()) ?? deps.titulo;
  if (estadoDoRegistroBancario(relido) === "REGISTRADO") {
    return { tipo: "REGISTRADO", idempotente: true, titulo: relido };
  }
  return { tipo: "EM_PROCESSAMENTO", codigo: codigoDo(relido) || codigo, criadoAgora: false, codigoGravado: true };
}

/** Título sem código: pede a criação e grava o código que vier, aconteça o que acontecer depois. */
export async function criarRegistroInter(deps: {
  criar: () => Promise<RespostaDaIntegracao>;
  relerTitulo: () => Promise<TituloLido | null>;
  /** Grava `id_boleto_c6` só se o título ainda estiver sem código. `false` se não gravou. */
  gravarCodigoSeVazio: (codigo: string) => Promise<boolean>;
}): Promise<ResultadoDoRegistro> {
  let resposta: RespostaDaIntegracao | null = null;
  let falhaDeChamada = false;
  try {
    resposta = await deps.criar();
  } catch {
    falhaDeChamada = true; // rede ou tempo esgotado: não se sabe se o banco criou
  }

  const corpo = resposta?.corpo ?? null;
  const respondeuSucesso =
    !!resposta &&
    resposta.status >= 200 &&
    resposta.status < 300 &&
    !!corpo &&
    typeof corpo === "object" &&
    (corpo as { success?: unknown }).success !== false;

  // O fluxo grava o título direto no banco; a resposta pode não trazer nada.
  const relido = await deps.relerTitulo();
  if (relido && estadoDoRegistroBancario(relido) === "REGISTRADO") {
    return { tipo: "REGISTRADO", idempotente: false, titulo: relido };
  }

  const codigoGravado = codigoDo(relido);
  const codigoNaResposta = codigoDaCobrancaNaResposta(corpo);
  const codigo = codigoGravado || codigoNaResposta || "";

  if (codigo) {
    let gravado = Boolean(codigoGravado);
    if (!gravado) {
      try {
        gravado = await deps.gravarCodigoSeVazio(codigo);
      } catch {
        gravado = false;
      }
      if (!gravado) {
        // Outra tentativa pode ter gravado primeiro: vale o que estiver no título.
        const deNovo = await deps.relerTitulo();
        if (codigoDo(deNovo)) return { tipo: "EM_PROCESSAMENTO", codigo: codigoDo(deNovo), criadoAgora: true, codigoGravado: true };
      }
    }
    return { tipo: "EM_PROCESSAMENTO", codigo, criadoAgora: true, codigoGravado: gravado };
  }

  if (respondeuSucesso) {
    return {
      tipo: "NAO_CONFIRMADO",
      mensagem: "O título foi enviado ao banco, mas o retorno não foi gravado. Verifique antes de tentar novamente."
    };
  }
  if (falhaDeChamada) {
    return {
      tipo: "NAO_CONFIRMADO",
      mensagem:
        "Não foi possível confirmar com a integração bancária se o boleto foi criado. Confira no banco antes de tentar de novo: uma nova tentativa pode criar um segundo boleto."
    };
  }
  const mensagemDoFluxo = corpo && typeof corpo === "object" ? String((corpo as { message?: unknown }).message ?? "").trim() : "";
  return {
    tipo: "NAO_CONFIRMADO",
    mensagem:
      (mensagemDoFluxo || "A integração bancária não confirmou o registro do título.") +
      " O banco pode ter criado o boleto: confira antes de tentar de novo."
  };
}
