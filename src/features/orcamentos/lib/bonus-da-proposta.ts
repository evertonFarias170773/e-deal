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
 * A REGRA DOS LEITORES (Fase 4, 30/09/2026)
 *   Linha gravada → vale o percentual dela, mesmo que seja 0.
 *   Sem linha     → 0%. O bônus do cadastro NÃO é mais lido aqui: a carga de
 *                   30/09 gravou a linha em toda proposta que usava percentual,
 *                   e o salvar grava as novas (`bonusDaEdicao`).
 *
 *   Linha com percentual fora de 0..100, ou que não é número, conta como
 *   ausente — um valor quebrado não pode inflar um total calado. (A CHECK
 *   desconto_proposta_tabela_especial_valida já impede gravá-la.)
 *
 * A REGRA DO SALVAR (`bonusDaEdicao`)
 *   Proposta SEM pagamento confirmado: vale o bônus vigente do cliente, e o
 *   salvar grava esse percentual na linha — o orçamento acompanha o cadastro.
 *   COM pagamento confirmado: a linha está CONGELADA. Vale o percentual gravado
 *   (sem linha, 0) e o salvar não a toca, mesmo que o bônus do cliente mude.
 *
 * O banco segue a MESMA conta (`cc__total_soberano_proposta`,
 * `recalcular_proposta_v3` e `v4`): o percentual da linha sai dos produtos ANTES
 * do desconto geral.
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
 * O percentual de bônus que os LEITORES aplicam: o gravado, ou 0 sem linha.
 *
 * `percentualDaLinha` já é o número gravado (ou `null`); quem tem a linha crua
 * passa por `percentualGravado` antes.
 */
export function bonusDaProposta(percentualDaLinha: number | null | undefined): number {
  return typeof percentualDaLinha === "number" && Number.isFinite(percentualDaLinha) ? percentualDaLinha : 0;
}

/**
 * O percentual que o formulário usa e que o salvar grava.
 *
 * Congelada (tem pagamento confirmado): o gravado, ou 0 sem linha — o bônus do
 * cliente não entra. Aberta: o bônus vigente do cliente.
 */
export function bonusDaEdicao(entrada: {
  congelada: boolean;
  percentualDaLinha: number | null | undefined;
  bonusDoCliente: number;
}): number {
  if (entrada.congelada) return bonusDaProposta(entrada.percentualDaLinha);
  return Number.isFinite(entrada.bonusDoCliente) && entrada.bonusDoCliente > 0 ? entrada.bonusDoCliente : 0;
}

/** Uma cobrança de `pagamentos_v2`, só com o que decide o pagamento confirmado. */
export type CobrancaParaCongelamento = {
  status?: unknown;
  confirmado?: unknown;
  valor?: unknown;
  obs_v2?: unknown;
};

/**
 * A proposta tem pagamento confirmado? A MESMA regra de `cc__valor_pago`:
 * cobrança não cancelada, PAID ou A_VENCER confirmada, e o valor menos o
 * abatimento de débito (`[ABATIMENTO_DEBITO:x]` em `obs_v2`) acima de zero.
 */
export function temPagamentoConfirmado(cobrancas: readonly CobrancaParaCongelamento[] | null | undefined): boolean {
  let pago = 0;
  for (const c of cobrancas ?? []) {
    const status = String(c.status ?? "").toUpperCase();
    if (status === "CANCELADO") continue;
    if (!(status === "PAID" || (status === "A_VENCER" && c.confirmado === true))) continue;
    const marcador = String(c.obs_v2 ?? "").match(/\[ABATIMENTO_DEBITO:(\d+(?:\.\d{1,2})?)\]/);
    const abatimento = marcador ? Number(marcador[1]) || 0 : 0;
    pago += Math.max(0, (Number(c.valor) || 0) - abatimento);
  }
  return Math.round(pago * 100) > 0;
}
