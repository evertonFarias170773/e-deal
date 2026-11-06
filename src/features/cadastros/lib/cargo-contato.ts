/**
 * Cargo do contato: lista fechada (06/11/2026).
 *
 * Deixou de ser texto livre. Só "Comprador", "Financeiro" ou vazio — a regra
 * do banco (`contatos_cargo_lista`, migration 20261106_contatos_cargo_lista)
 * recusa qualquer outro valor.
 *
 * `normalizarCargoContato` é a MESMA conversão que a migration aplicou aos
 * cargos antigos: contém "financeiro" (sem maiúscula nem acento) → Financeiro;
 * qualquer outro texto preenchido → Comprador; vazio → null. Toda gravação de
 * contato passa por ela, então valor antigo ou colado de outro sistema nunca
 * chega ao banco fora da lista.
 */
export const CARGOS_DO_CONTATO = ["Comprador", "Financeiro"] as const;

export type CargoDoContato = (typeof CARGOS_DO_CONTATO)[number];

function semAcento(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizarCargoContato(valor: string | null | undefined): CargoDoContato | null {
  const texto = String(valor ?? "").trim();
  if (!texto) return null;
  return semAcento(texto).toLowerCase().includes("financeiro") ? "Financeiro" : "Comprador";
}
