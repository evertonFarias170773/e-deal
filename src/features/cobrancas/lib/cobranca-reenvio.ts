/**
 * COBRANCA DO REENVIO (fase 2A, 22/10/2026).
 *
 * A diferenca de frete de um reenvio vira uma cobranca nova em `pagamentos_v2`,
 * no mesmo pedido, marcada pela coluna `chave_reenvio` ("REENVIO:<id_int>:<ciclo>",
 * a mesma chave de `expedicao_reenvios`). Ela NAO e pagamento da proposta: o
 * banco a tira de `cc__valor_pago` (e com isso do saldo do despacho, da pendencia
 * de Conta Corrente e do complemento). Migration
 * `supabase/migrations/20261022_exp_reenvio_fase2a_fundacao.sql`.
 *
 * Aqui o espelho para as contas feitas em TypeScript sobre a lista de cobrancas
 * (editar-paga, abonar-diferenca, saldo da aba Pagamentos). Linha sem a coluna
 * (leitura antiga, ou banco antes da migration) = cobranca da proposta, como
 * sempre foi: pedido sem reenvio da exatamente o mesmo resultado.
 */

export type ComMarcadorDeReenvio = { chave_reenvio?: string | null };

/** A cobranca e a diferenca de frete de um reenvio (fora do pago e do cobrado da proposta). */
export function ehCobrancaDeReenvio(cobranca: ComMarcadorDeReenvio | null | undefined): boolean {
  const chave = cobranca?.chave_reenvio;
  return typeof chave === "string" && chave.trim() !== "";
}

/** So as cobrancas que contam para o pago e o cobrado da proposta. A ordem nao muda. */
export function semCobrancaDeReenvio<T extends ComMarcadorDeReenvio>(cobrancas: readonly T[]): T[] {
  return cobrancas.filter((c) => !ehCobrancaDeReenvio(c));
}
