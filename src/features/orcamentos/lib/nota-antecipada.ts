/**
 * "LIBERAR NOTA ANTECIPADA" (29/10/2026) — a regra, em um lugar so.
 *
 * POR QUE EXISTE
 *   Alguns clientes so pagam mediante a nota. A Fila de Faturamento so recebia
 *   pedido depois do pagamento: `libera_nf` era ligada por "Liberar para Producao" e
 *   por "Enviar para Fila de Faturamento", e as duas exigem REVISAO ATENDENTE (ou
 *   alem). Esta acao libera o pedido em AGUARDANDO para a Fila, e a nota nasce pelo
 *   fluxo oficial (Faturar), com o `id_int` do pedido: as travas de segunda nota ja
 *   a enxergam.
 *
 * A REGRA
 *   Liberar: so em AGUARDANDO, com `libera_nf` desligada, `is_prd_aprovado`
 *   desligada, sem marca de nota no sistema antigo e sem NF-e de venda autorizada
 *   ou em processamento. Grava APENAS `libera_nf = true`.
 *   Desfazer: so em AGUARDANDO, com `libera_nf` ligada, `is_prd_aprovado`
 *   desligada e sem nenhuma NF-e de venda viva (rascunho incluido). Grava APENAS
 *   `libera_nf = false`.
 *   Nunca toca em status, `is_prd_aprovado`, cobrancas nem notas. A autoria vai
 *   para a linha do tempo do pedido (`propostas_chat`).
 *
 * POR QUE O DESFAZER SO EM AGUARDANDO
 *   Em AGUARDANDO, `libera_nf` ligada so pode ter vindo desta acao. Depois do
 *   pagamento, a liberacao para a producao tambem liga `libera_nf`, e desligar ali
 *   tiraria da Fila um pedido que entrou por outro caminho.
 */

export const STATUS_DA_NOTA_ANTECIPADA = "AGUARDANDO";

/** NF-e de venda que impede LIBERAR: ja autorizada ou a caminho da SEFAZ. */
export const STATUS_NFE_QUE_IMPEDEM_LIBERAR: readonly string[] = ["AUTORIZADA", "PROCESSANDO", "PRONTA_PARA_ENVIO"];

/** NF-e de venda morta: nao impede DESFAZER. Qualquer outro status (rascunho incluido) impede. */
export const STATUS_NFE_MORTOS: readonly string[] = ["CANCELADA", "DENEGADA"];

export const CODIGO_FORA_DE_AGUARDANDO = "FORA_DE_AGUARDANDO";
export const CODIGO_NA_PRODUCAO = "JA_NA_PRODUCAO";
export const CODIGO_FATURADO_FORA = "FATURADO_NO_SISTEMA_ANTIGO";
export const CODIGO_TEM_NOTA = "TEM_NOTA_DE_VENDA";

export type EstadoParaNotaAntecipada = {
  statusInterno: string | null | undefined;
  liberaNf: boolean | null | undefined;
  isPrdAprovado: boolean | null | undefined;
  faturadoForaEm?: string | null;
};

/** NF-e do pedido, como o servidor le: so as de venda contam (remessa nao fatura). */
export type NfeDoPedido = { ref: string | null; status: string | null; tipoNota: string | null };

export type DecisaoNotaAntecipada =
  | { acao: "gravar" }
  | { acao: "idempotente" }
  | { acao: "recusar"; code: string; message: string };

const normalizar = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase();
const ehVenda = (n: NfeDoPedido) => normalizar(n.tipoNota) !== "REMESSA";

function rotulos(notas: NfeDoPedido[]): string {
  return notas.map((n) => `${n.ref ?? "sem ref"} (${normalizar(n.status) || "sem status"})`).join(", ");
}

function comumAosDois(estado: EstadoParaNotaAntecipada): DecisaoNotaAntecipada | null {
  const status = normalizar(estado.statusInterno);
  if (estado.isPrdAprovado === true) {
    return { acao: "recusar", code: CODIGO_NA_PRODUCAO, message: "O pedido já está liberado para a produção, e por isso já está na Fila de Faturamento." };
  }
  if (status !== STATUS_DA_NOTA_ANTECIPADA) {
    return {
      acao: "recusar",
      code: CODIGO_FORA_DE_AGUARDANDO,
      message: `A nota antecipada só vale para pedido em ${STATUS_DA_NOTA_ANTECIPADA}. Este está em ${status || "sem status"}.`
    };
  }
  return null;
}

/**
 * Liberar. `notas` ausente = nao conferido (a TELA nao sabe das notas; o servidor
 * sempre passa a lista).
 */
export function decidirLiberarNotaAntecipada(estado: EstadoParaNotaAntecipada, notas?: NfeDoPedido[]): DecisaoNotaAntecipada {
  const comum = comumAosDois(estado);
  if (comum) return comum;
  if (estado.faturadoForaEm) {
    return { acao: "recusar", code: CODIGO_FATURADO_FORA, message: "Este pedido já tem nota emitida no sistema antigo. Uma venda, uma NF-e." };
  }
  if (estado.liberaNf === true) return { acao: "idempotente" };
  const impedem = (notas ?? []).filter((n) => ehVenda(n) && STATUS_NFE_QUE_IMPEDEM_LIBERAR.includes(normalizar(n.status)));
  if (impedem.length > 0) {
    return { acao: "recusar", code: CODIGO_TEM_NOTA, message: `O pedido já tem NF-e de venda autorizada ou em processamento: ${rotulos(impedem)}.` };
  }
  return { acao: "gravar" };
}

/** Desfazer. Mesma convencao de `notas`. */
export function decidirDesfazerNotaAntecipada(estado: EstadoParaNotaAntecipada, notas?: NfeDoPedido[]): DecisaoNotaAntecipada {
  const comum = comumAosDois(estado);
  if (comum) return comum;
  if (estado.liberaNf !== true) return { acao: "idempotente" };
  const vivas = (notas ?? []).filter((n) => ehVenda(n) && !STATUS_NFE_MORTOS.includes(normalizar(n.status)));
  if (vivas.length > 0) {
    return {
      acao: "recusar",
      code: CODIGO_TEM_NOTA,
      message: `O pedido já tem NF-e de venda (${rotulos(vivas)}). Descarte o rascunho ou cancele a nota antes de desfazer.`
    };
  }
  return { acao: "gravar" };
}

/** O usuario da tela: mesma chave da rota (`propostas.release_nf`), calculada por quem chama. */
export function podeVerLiberarNotaAntecipada(podeLiberarNf: boolean, estado: EstadoParaNotaAntecipada): boolean {
  return podeLiberarNf && decidirLiberarNotaAntecipada(estado).acao === "gravar";
}

export function podeVerDesfazerNotaAntecipada(podeLiberarNf: boolean, estado: EstadoParaNotaAntecipada): boolean {
  return podeLiberarNf && decidirDesfazerNotaAntecipada(estado).acao === "gravar";
}
