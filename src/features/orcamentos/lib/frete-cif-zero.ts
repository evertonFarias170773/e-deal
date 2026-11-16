/**
 * FRETE CIF NUNCA É R$ 0,00 (regra do dono, 11/11/2026; trava em 16/11/2026).
 *
 * Não existe frete grátis: desconto é abono do gerente (desconto da proposta),
 * não frete zero. RETIRA e FOB seguem a zero.
 *
 * Fora da regra, por decisão:
 *   - proposta avulsa ("Frete Incluso");
 *   - pedido complementar (CIF com diferença ≤ 0 fica a zero);
 *   - cliente com "Pode editar valor do frete" (clientes.pode_editar_frete),
 *     até a diretoria decidir.
 *
 * Duas travas, a mesma regra:
 *   - Salvar: `saveProposta` (tela e Maestro), sobre o valor final do frete.
 *   - Cobrança: o gatilho `trg_pgv2_frete_cif_zero` em pagamentos_v2
 *     (migration 20261116_pagamentos_v2_frete_cif_zero), em toda porta.
 *
 * Sem imports de propósito: roda no navegador, no servidor e no teste do Node.
 */

export const MENSAGEM_FRETE_CIF_ZERO = "Frete CIF não pode ser R$ 0,00. Cote ou informe o valor do frete.";

export type EntradaFreteCifZero = {
  /** Modalidade vigente: "CIF", "FOB", "RETIRA" ou nula (nula cobra frete, como CIF). */
  modalidade: string | null | undefined;
  /** O frete que a proposta grava/cobra, já com a modalidade aplicada. */
  valorFrete: number | null | undefined;
  isAvulso: boolean;
  ehComplemento: boolean;
  clientePodeEditarFrete: boolean;
};

/** true = a regra recusa (CIF a zero fora das exceções). */
export function freteCifZeroRecusado(e: EntradaFreteCifZero): boolean {
  if (e.isAvulso || e.ehComplemento || e.clientePodeEditarFrete) return false;
  const modalidade = String(e.modalidade ?? "").trim().toUpperCase();
  if (modalidade === "FOB" || modalidade === "RETIRA") return false;
  const valor = Number(e.valorFrete ?? 0);
  return !Number.isFinite(valor) || Math.round(valor * 100) <= 0;
}

/** O erro do banco é a recusa do gatilho? Devolve a mensagem limpa, ou null. */
export function recusaFreteCifZeroNoErro(mensagemDeErro: unknown): string | null {
  return String(mensagemDeErro ?? "").includes(MENSAGEM_FRETE_CIF_ZERO) ? MENSAGEM_FRETE_CIF_ZERO : null;
}
