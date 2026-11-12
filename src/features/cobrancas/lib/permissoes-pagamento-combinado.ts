/**
 * Permissões do pagamento combinado (E-Crédito + restante), conforme a forma
 * usada de fato no restante (12/11/2026, caso 25197).
 *
 * Antes a rota /api/cobrancas/pagamento-combinado exigia sempre `credito.usar`
 * e `cobrancas.emitir_boleto`, qualquer que fosse o restante. O perfil Vendedor
 * tem `credito.usar` e não tem `cobrancas.emitir_boleto`, e ficava sem o
 * E-Crédito + PIX, que nada tem de boleto.
 *
 * Regra:
 *   - sempre `credito.usar` (a parte E-Crédito);
 *   - restante em PIX: nada a mais (o PIX avulso também não pede permissão de
 *     boleto: gerar-pix só exige sessão);
 *   - restante em Boleto, Cartão ou E-Faturado: `cobrancas.emitir_boleto`,
 *     como antes. Só o PIX foi liberado.
 */

export const PERMISSAO_CREDITO = "credito.usar";
export const PERMISSAO_BOLETO = "cobrancas.emitir_boleto";

const RESTANTE_SEM_PERMISSAO_EXTRA = new Set(["PIX", "E-PIX"]);

export function permissoesDoPagamentoCombinado(tipoSecundario: string | null | undefined): string[] {
  const tipo = String(tipoSecundario ?? "").trim().toUpperCase();
  if (RESTANTE_SEM_PERMISSAO_EXTRA.has(tipo)) return [PERMISSAO_CREDITO];
  return [PERMISSAO_CREDITO, PERMISSAO_BOLETO];
}

/** Mensagem da recusa, com as permissões que faltam. */
export function mensagemPermissaoCombinado(faltando: string[]): string {
  return `Você não tem permissões suficientes para realizar o pagamento combinado (${faltando.join(" e ")}).`;
}
