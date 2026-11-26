/**
 * COBRANCAS FORA DA PROPOSTA: reenvio (fase 2A, 22/10/2026) e troca de
 * transportadora cobrando a diferenca (26/11/2026).
 *
 * Duas cobrancas novas, no mesmo pedido, que NAO sao pagamento da proposta nem
 * venda. O banco as tira de `cc__valor_pago` (e com isso do saldo do despacho,
 * da pendencia de Conta Corrente e do complemento) e dos relatorios e paineis
 * de venda:
 *   - `chave_reenvio` ("REENVIO:<id_int>:<ciclo>", de `expedicao_reenvios`):
 *     diferenca de frete do reenvio. Migration 20261022_exp_reenvio_fase2a_fundacao.
 *   - `id_troca_frete` (`expedicao_recotacoes.id`): diferenca de frete da troca
 *     de transportadora cobrando a parte. Migration 20261126b_frete_trocar_cobrando.
 *
 * Aqui o espelho para as contas feitas em TypeScript sobre a lista de cobrancas
 * (editar-paga, abonar-diferenca, saldo da aba Pagamentos). Linha sem as colunas
 * (leitura antiga) = cobranca da proposta, como sempre foi: pedido sem reenvio
 * nem troca da exatamente o mesmo resultado.
 */

export type ComMarcadorDeReenvio = {
  chave_reenvio?: string | null;
  id_troca_frete?: number | string | null;
};

/** A cobranca e a diferenca de frete de um reenvio (fora do pago e do cobrado da proposta). */
export function ehCobrancaDeReenvio(cobranca: ComMarcadorDeReenvio | null | undefined): boolean {
  const chave = cobranca?.chave_reenvio;
  return typeof chave === "string" && chave.trim() !== "";
}

/** A cobranca e a diferenca de frete da troca de transportadora (fora do pago e do cobrado da proposta). */
export function ehCobrancaDaTrocaDeFrete(cobranca: ComMarcadorDeReenvio | null | undefined): boolean {
  const id = cobranca?.id_troca_frete;
  if (id === null || id === undefined) return false;
  const n = Number(id);
  return Number.isFinite(n) && n > 0;
}

/** Qualquer das duas: a cobranca nao conta para o pago nem para o cobrado da proposta. */
export function ehCobrancaForaDaProposta(cobranca: ComMarcadorDeReenvio | null | undefined): boolean {
  return ehCobrancaDeReenvio(cobranca) || ehCobrancaDaTrocaDeFrete(cobranca);
}

/** Rotulo da lista de cobrancas. Null para cobranca da proposta. */
export function rotuloDaCobrancaForaDaProposta(cobranca: ComMarcadorDeReenvio | null | undefined): string | null {
  if (ehCobrancaDaTrocaDeFrete(cobranca)) return "Diferença de frete da troca";
  if (ehCobrancaDeReenvio(cobranca)) return "Frete do reenvio";
  return null;
}

/**
 * So as cobrancas que contam para o pago e o cobrado da proposta: sem as do
 * reenvio e sem as da troca de frete. A ordem nao muda.
 */
export function semCobrancaDeReenvio<T extends ComMarcadorDeReenvio>(cobrancas: readonly T[]): T[] {
  return cobrancas.filter((c) => !ehCobrancaForaDaProposta(c));
}
