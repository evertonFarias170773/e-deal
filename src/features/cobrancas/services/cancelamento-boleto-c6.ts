import {
  lerCancelamentoBoletoAVistaC6,
  webhookCancelaBoletoAVista,
  webhookDaBiroC6ComSegredo
} from "@/features/cobrancas/lib/banco-boleto-biro";

/**
 * Cancelamento do boleto à vista NO C6 para a troca de forma de pagamento
 * (23/11/2026, caso 25255). É o mesmo pedido que a rota `cancelar-externo`
 * faz — o mesmo webhook (`webhookCancelaBoletoAVista`), o mesmo corpo
 * (`cod_C6` + `id_empresa`), o segredo nos fluxos da Birô no C6 — e a mesma
 * leitura da resposta (`lerCancelamentoBoletoAVistaC6`: só vale com
 * `cancelado: true` do fluxo, que confere o C6). O cancelamento simples NÃO
 * usa este arquivo: ele continua como está.
 *
 * Diferença de propósito: teto de tempo e nunca lança. Sem resposta, o estado
 * no banco é desconhecido: a troca é desfeita e o boleto fica ativo no Vibe,
 * com o aviso para conferir no C6.
 */

export const TEMPO_LIMITE_CANCELAMENTO_BOLETO_MS = 25_000;

export type DesfechoBoletoC6 = "CONFIRMADO" | "RECUSADO" | "TEMPO_ESGOTADO" | "REDE";

export type ResultadoCancelamentoBoletoC6 = {
  cancelou: boolean;
  desfecho: DesfechoBoletoC6;
  /** Para a resposta da rota quando não cancelou. */
  statusHttp: number;
  mensagem: string;
};

export async function cancelarBoletoAVistaNoC6(entrada: {
  codigo: string;
  idEmpresa: number;
  /** Cabeçalhos com o segredo do n8n (só vão aos fluxos da Birô no C6). */
  cabecalhosComSegredo: Record<string, string>;
  tempoLimiteMs?: number;
  buscar?: typeof fetch;
}): Promise<ResultadoCancelamentoBoletoC6> {
  const buscar = entrada.buscar ?? fetch;
  const url = webhookCancelaBoletoAVista(entrada.idEmpresa, entrada.codigo);
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), entrada.tempoLimiteMs ?? TEMPO_LIMITE_CANCELAMENTO_BOLETO_MS);
  try {
    const resposta = await buscar(url, {
      method: "POST",
      headers: webhookDaBiroC6ComSegredo(url) ? entrada.cabecalhosComSegredo : { "Content-Type": "application/json" },
      body: JSON.stringify({ cod_C6: entrada.codigo, id_empresa: entrada.idEmpresa }),
      signal: controle.signal
    });
    const texto = await resposta.text();
    const decisao = lerCancelamentoBoletoAVistaC6({ ok: resposta.ok, status: resposta.status, texto });
    if (decisao.cancelou) return { cancelou: true, desfecho: "CONFIRMADO", statusHttp: 200, mensagem: "" };
    return { cancelou: false, desfecho: "RECUSADO", statusHttp: resposta.ok ? 409 : resposta.status >= 400 ? resposta.status : 502, mensagem: decisao.mensagem };
  } catch {
    const tempoEsgotado = controle.signal.aborted;
    return {
      cancelou: false,
      desfecho: tempoEsgotado ? "TEMPO_ESGOTADO" : "REDE",
      statusHttp: 504,
      mensagem: tempoEsgotado
        ? "O banco não respondeu a tempo. O boleto continua ativo no sistema; confira no C6 se ele foi cancelado antes de tentar de novo."
        : "Não foi possível falar com o banco. O boleto continua ativo no sistema; confira no C6 antes de tentar de novo."
    };
  } finally {
    clearTimeout(relogio);
  }
}
