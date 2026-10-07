/**
 * Cancelamento de título no C6 (empresas 1 e 3) pelo webhook `del-boleto-vibe`.
 *
 * ATÉ 07/10/2026 o NAVEGADOR chamava esse webhook, em
 * `deleteBoletoFromBankViaN8n` (`nfe.service.ts`): a rota
 * `cancelar-boleto-faturado` devolvia `delegarLegado: true` e a tela ia ao n8n
 * sozinha, sem segredo. Agora quem chama é a rota, e este módulo guarda as três
 * peças que os dois lados usam — sem navegador e sem `next/server`, para rodar
 * em teste:
 *
 *   1. `cancelarTituloNoC6`: a chamada, com teto de tempo;
 *   2. `lerRespostaDoCancelamentoC6`: a leitura da resposta do n8n. É o trecho
 *      que vivia no navegador, RECORTADO sem alteração de regra — o motivo da
 *      recusa sai pela mesma `mensagemDoRetornoBancario`, sem prefixo nem corte,
 *      porque `titulo-inativo-no-banco` decide pelo TEXTO dele;
 *   3. `destinoDaRespostaDoCancelamento`: o que o navegador faz com o que a rota
 *      devolve. Só `RECUSA_DO_BANCO` abre os dois caminhos de recusa.
 *
 * O WEBHOOK NÃO GRAVA NADA no banco de dados (lido no fluxo vivo em
 * 07/10/2026): escolhe a empresa, pede o token, manda o C6 cancelar e responde
 * 200 `{ success: true, cancelado: true, cod_C6 }` ou 409
 * `{ success: false, message }`. A baixa no ERP continua sendo de quem chamou.
 */
import { mensagemDoRetornoBancario } from "@/features/cobrancas/services/boleto-c6";

export const WEBHOOK_CANCELA_C6_FATURADO = "https://10074.hostoo.net.br/webhook/del-boleto-vibe";

/**
 * Teto da chamada ao n8n. As 8 execuções guardadas do ramo levaram de 0,6 a
 * 1,0 s (medido em 07/10/2026); 25 s cobre o banco lento com folga e fica bem
 * abaixo do `maxDuration` de 60 s da rota. Estouro vira `BANCO_INDISPONIVEL`.
 */
export const TEMPO_LIMITE_CANCELAMENTO_C6_MS = 25_000;

export type CodigoDeFalhaDoCancelamentoC6 = "RECUSA_DO_BANCO" | "BANCO_INDISPONIVEL" | "RESPOSTA_INVALIDA";

export type ResultadoDoCancelamentoC6 =
  /** O C6 cancelou. `dados` é o corpo que o n8n devolveu. */
  | { tipo: "SUCESSO"; dados: Record<string, unknown> }
  /** O banco respondeu e NÃO cancelou. `motivo` é o texto dele, como sempre chegou à tela. */
  | { tipo: "RECUSA"; motivo: string }
  /** O n8n respondeu 200 com algo que não dá para ler. */
  | { tipo: "INVALIDA"; mensagem: string }
  /** Não houve resposta: rede ou tempo esgotado. O estado no banco é desconhecido. */
  | { tipo: "INDISPONIVEL"; mensagem: string; tempoEsgotado: boolean };

/** O corpo do webhook: os mesmos três campos, na mesma ordem, que o navegador enviava. */
export function corpoDoCancelamentoC6(titulo: { id: string; id_boleto_c6: string | null; id_empresa: number | null }) {
  return {
    boleto_id: titulo.id,
    // Sem código do banco vai vazio, de propósito: o C6 recusa e o caso segue
    // pelo caminho da recusa, como sempre foi. Não há recusa nova aqui.
    cod_C6: String(titulo.id_boleto_c6 ?? ""),
    // NÚMERO: o seletor do fluxo compara com tipo estrito.
    id_empresa: Number(titulo.id_empresa)
  };
}

/**
 * A leitura da resposta do n8n — o que o navegador fazia, linha a linha:
 *
 *   resposta com erro HTTP  -> recusa; motivo = `mensagemDoRetornoBancario` do
 *                              JSON, ou o texto cru, ou a frase com o status;
 *   200 que não é JSON      -> inválida;
 *   200 vazio               -> inválida;
 *   200 com `error`, `message`, `status: "error"` ou `success: false` -> recusa;
 *   o resto                 -> sucesso.
 */
export function lerRespostaDoCancelamentoC6(resposta: { ok: boolean; statusText: string; texto: string }): ResultadoDoCancelamentoC6 {
  if (!resposta.ok) {
    let legivel = "";
    try {
      legivel = mensagemDoRetornoBancario(JSON.parse(resposta.texto), "");
    } catch {
      legivel = "";
    }
    return {
      tipo: "RECUSA",
      motivo: legivel || resposta.texto || `Erro no processamento da exclusão do boleto: ${resposta.statusText}`
    };
  }

  let dados: unknown;
  try {
    dados = JSON.parse(resposta.texto);
  } catch {
    return { tipo: "INVALIDA", mensagem: "A resposta do servidor não é um JSON válido." };
  }

  if (!dados) {
    return { tipo: "INVALIDA", mensagem: "Resposta do banco vazia ou inválida." };
  }

  const corpo = dados as { error?: unknown; message?: unknown; status?: unknown; success?: unknown };
  if (corpo.error || corpo.message || corpo.status === "error" || corpo.success === false) {
    return { tipo: "RECUSA", motivo: mensagemDoRetornoBancario(corpo.error ?? corpo.message, "Erro retornado pelo webhook.") };
  }

  return { tipo: "SUCESSO", dados: dados as Record<string, unknown> };
}

/**
 * Chama o webhook e devolve o desfecho. Nunca lança.
 *
 * `cabecalhos` vem de quem chama (`cabecalhosWebhookN8n()`, na rota): este
 * módulo não lê variável de ambiente.
 */
export async function cancelarTituloNoC6(entrada: {
  corpo: Record<string, unknown>;
  cabecalhos: Record<string, string>;
  tempoLimiteMs?: number;
  buscar?: typeof fetch;
}): Promise<ResultadoDoCancelamentoC6> {
  const buscar = entrada.buscar ?? fetch;
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), entrada.tempoLimiteMs ?? TEMPO_LIMITE_CANCELAMENTO_C6_MS);

  try {
    const resposta = await buscar(WEBHOOK_CANCELA_C6_FATURADO, {
      method: "POST",
      headers: entrada.cabecalhos,
      body: JSON.stringify(entrada.corpo),
      signal: controle.signal
    });
    // O corpo também conta no teto: resposta que começa e não termina não segura a rota.
    const texto = await resposta.text();
    return lerRespostaDoCancelamentoC6({ ok: resposta.ok, statusText: resposta.statusText, texto });
  } catch {
    const tempoEsgotado = controle.signal.aborted;
    return {
      tipo: "INDISPONIVEL",
      tempoEsgotado,
      mensagem: tempoEsgotado
        ? "O banco não respondeu a tempo. Não é possível afirmar se o título foi cancelado: confira no banco antes de tentar de novo."
        : "Não foi possível contatar a integração bancária. Não é possível afirmar se o título foi cancelado: confira antes de tentar de novo."
    };
  } finally {
    clearTimeout(relogio);
  }
}

/** A resposta HTTP da rota para cada desfecho do banco. */
export function respostaDaRotaParaOCancelamentoC6(resultado: ResultadoDoCancelamentoC6): { status: number; corpo: Record<string, unknown> } {
  if (resultado.tipo === "SUCESSO") {
    return { status: 200, corpo: { success: true, canceladoNoC6: true, data: resultado.dados } };
  }
  if (resultado.tipo === "RECUSA") {
    // `message` é o motivo do banco SEM alteração: `titulo-inativo-no-banco` decide pelo texto.
    return { status: 409, corpo: { success: false, code: "RECUSA_DO_BANCO", message: resultado.motivo } };
  }
  if (resultado.tipo === "INVALIDA") {
    return { status: 502, corpo: { success: false, code: "RESPOSTA_INVALIDA", message: resultado.mensagem } };
  }
  return { status: 502, corpo: { success: false, code: "BANCO_INDISPONIVEL", message: resultado.mensagem } };
}

/* ------------------------------------------------------------ no navegador */

export type DestinoDaRespostaDoCancelamento =
  | { acao: "SUCESSO"; data: Record<string, unknown> }
  /** Erro simples: nada de baixa local, nada de relato ao servidor. */
  | { acao: "LANCAR"; mensagem: string }
  /** Recusa do banco fora do "Refazer boleto": relata a `titulo-inativo-no-banco`. */
  | { acao: "RELATAR_RECUSA"; motivo: string };

export const MENSAGEM_PADRAO_DE_FALHA_BANCARIA = "Falha na operação bancária do título faturado.";

/**
 * O que o navegador faz com a resposta de `cancelar-boleto-faturado`.
 *
 * O NAVEGADOR NÃO CHAMA MAIS O BANCO. Por isso `delegarLegado` — que só uma
 * versão ANTIGA da rota devolve, durante a troca de versão — vira erro: tratar
 * como sucesso daria baixa num título que segue vivo no C6, e chamar o webhook
 * daqui é exatamente o que deixou de existir.
 */
export function destinoDaRespostaDoCancelamento(
  resposta: { ok: boolean; resultado: Record<string, unknown> | null },
  opcoes?: { semBaixaLocal?: boolean }
): DestinoDaRespostaDoCancelamento {
  const { ok, resultado } = resposta;

  if (ok && resultado?.success === true) {
    if (resultado.delegarLegado === true) {
      return {
        acao: "LANCAR",
        mensagem: "O sistema foi atualizado enquanto esta tela estava aberta. Nada foi cancelado no banco: recarregue a página e tente de novo."
      };
    }
    // Empresas 1 e 3: o corpo que o n8n devolveu. Birô: a própria resposta da rota, como antes.
    const data = resultado.canceladoNoC6 === true ? ((resultado.data as Record<string, unknown> | undefined) ?? {}) : resultado;
    return { acao: "SUCESSO", data };
  }

  if (resultado?.code === "RECUSA_DO_BANCO") {
    // Sem `trim` no que segue adiante: o motivo vai ao servidor como o banco mandou.
    const bruto = String(resultado.message ?? "");
    const motivo = bruto.trim() ? bruto : MENSAGEM_PADRAO_DE_FALHA_BANCARIA;
    return opcoes?.semBaixaLocal ? { acao: "LANCAR", mensagem: motivo } : { acao: "RELATAR_RECUSA", motivo };
  }

  return { acao: "LANCAR", mensagem: String(resultado?.message ?? "").trim() || MENSAGEM_PADRAO_DE_FALHA_BANCARIA };
}
