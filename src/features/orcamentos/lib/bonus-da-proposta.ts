/**
 * O bônus de tabela especial que vale para UMA proposta.
 *
 * POR QUE EXISTE (CONTA-CORRENTE-CREDITO.md §4.2, item 13)
 *   O bônus era lido sempre do cadastro, com o percentual de HOJE. Mudar o
 *   `percentual_bunus` de um cliente reescrevia a conta de toda proposta dele,
 *   inclusive paga e faturada — a LISITON vendeu com 8% e hoje tem 0%. A decisão
 *   de 19/08/2026: o bônus da venda fica gravado na própria proposta, como linha
 *   `desconto_proposta` do tipo TABELA_ESPECIAL.
 *
 * A REGRA
 *   Linha gravada → vale o percentual dela, mesmo que seja 0.
 *   Sem linha     → vale o bônus do cliente, como sempre foi.
 *   Nunca os dois somados: é daqui que sai o único percentual da proposta.
 *
 *   Linha com percentual fora de 0..100, ou que não é número, conta como
 *   ausente — um valor quebrado não pode zerar nem inflar um total calado.
 *
 * O banco segue a MESMA regra desde 01/10/2026 (`cc__total_soberano_proposta`,
 * `recalcular_proposta_v3` e `v4`, migration 20261001_desconto_tabela_especial_
 * leitores_banco): o percentual da linha sai dos produtos ANTES do desconto geral.
 */

export const TIPO_DESCONTO_TABELA_ESPECIAL = "TABELA_ESPECIAL";

/** A linha `desconto_proposta` do tipo TABELA_ESPECIAL, como vem do banco. */
export type LinhaTabelaEspecial = { valor_percentual: unknown } | null | undefined;

/** O percentual gravado na linha, ou `null` quando não há linha válida. */
export function percentualGravado(linha: LinhaTabelaEspecial): number | null {
  if (!linha) return null;
  const bruto = linha.valor_percentual;
  if (bruto === null || bruto === undefined || bruto === "") return null;
  const n = Number(bruto);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

/**
 * O percentual de bônus da proposta.
 *
 * `percentualDaLinha` já é o número gravado (ou `null`); quem tem a linha crua
 * passa por `percentualGravado` antes.
 */
export function bonusDaProposta(percentualDaLinha: number | null | undefined, bonusDoCliente: number): number {
  if (typeof percentualDaLinha === "number" && Number.isFinite(percentualDaLinha)) return percentualDaLinha;
  return Number.isFinite(bonusDoCliente) ? bonusDoCliente : 0;
}
