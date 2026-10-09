/**
 * Cobrança que foi CANCELADA e hoje consta como ativa (paga, na prática).
 *
 * COMO ISSO ACONTECE (09/10/2026, pedidos 20059, 20091, 21275, 21495, 22324 e
 * 23411). O vendedor cancela a cobrança no Vibe; o PIX continua valendo no
 * banco; o cliente paga; e o fluxo do n8n que recebe o aviso do banco grava
 * `status = PAID` localizando a cobrança só pelo número, sem olhar que ela
 * estava cancelada. A cobrança volta para a Fila de Conferência como "Pago / A
 * liberar" e o financeiro confirma — em quatro desses pedidos o cliente tinha
 * pago duas vezes.
 *
 * A REGRA REAL, conferida no banco nessa data
 *   - `pagamentos_v2` NÃO tem coluna de data de cancelamento. O único rastro
 *     que sobra numa cobrança que saiu de CANCELADO é `motivo_cancela`.
 *   - `motivo_cancela` só é gravado JUNTO com `status = CANCELADO` (todas as
 *     rotas e a tela), e a reativação oficial o limpa (`cancelar-boleto-faturado`
 *     grava `motivo_cancela: null`). Então motivo preenchido em cobrança ativa
 *     quer dizer: foi cancelada e alguém a tirou de lá sem passar pelo fluxo.
 *   - Motivo VAZIO não conta: a 19128-A tem texto vazio e nunca foi cancelada.
 *   - Motivo "." CONTA. É o motivo que as pessoas digitam para passar da tela
 *     (70 das 765 canceladas), e a 23411-A, cancelada com "." e paga 15
 *     segundos depois, é um dos seis casos reais. Nenhuma cobrança que nunca
 *     foi cancelada tem "." gravado.
 *
 * Sem I/O: a rota de confirmar e a lista da Conferência decidem com isto.
 */

export const MENSAGEM_CANCELADA_E_PAGA =
  "Esta cobrança foi cancelada e consta como paga. Não confirme: o dinheiro pode ter entrado em duplicidade. Avise a gestão para decidir entre reativar ou devolver.";

export const SELO_CANCELADA_E_PAGA = "Cancelada e paga: não confirmar";

export const CODIGO_CANCELADA_E_PAGA = "CANCELADA_E_PAGA";

const STATUS_CANCELADO = ["CANCELADO", "CANCELADA"];

type CobrancaParaAvaliar = {
  status?: string | null;
  motivo_cancela?: string | null;
};

export function statusEhCancelado(status: string | null | undefined): boolean {
  return STATUS_CANCELADO.includes(String(status ?? "").trim().toUpperCase());
}

/** Há motivo de cancelamento gravado? Só espaço em branco não é motivo. */
export function temMotivoDeCancelamento(motivo: string | null | undefined): boolean {
  return String(motivo ?? "").trim() !== "";
}

/**
 * A cobrança está ATIVA (qualquer status que não seja cancelado) e carrega
 * motivo de cancelamento. É o caso do selo na lista.
 */
export function ehCanceladaQueConstaPaga(cobranca: CobrancaParaAvaliar): boolean {
  return !statusEhCancelado(cobranca.status) && temMotivoDeCancelamento(cobranca.motivo_cancela);
}

/**
 * A rota de confirmar tem de recusar? Sim para a cancelada que consta paga e
 * para a que ainda está com status cancelado.
 */
export function confirmacaoDeveSerRecusada(cobranca: CobrancaParaAvaliar): boolean {
  return statusEhCancelado(cobranca.status) || temMotivoDeCancelamento(cobranca.motivo_cancela);
}
