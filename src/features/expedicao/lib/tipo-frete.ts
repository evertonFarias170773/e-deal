import type { TipoFreteNormalizado } from "../types";

/** Ordem de exibição no select de filtro da tela. */
export const TIPOS_FRETE: TipoFreteNormalizado[] = [
  "CORREIOS",
  "MOTOBOY",
  "TRANSPORTADORA",
  "RETIRA_BALCAO",
  "SEM_CUSTO",
  "INDEFINIDO"
];

const LABELS: Record<TipoFreteNormalizado, string> = {
  CORREIOS: "Correios",
  MOTOBOY: "Motoboy",
  TRANSPORTADORA: "Transportadora",
  RETIRA_BALCAO: "Retira balcão",
  SEM_CUSTO: "Sem custo",
  INDEFINIDO: "A definir"
};

export function labelTipoFrete(tipo: TipoFreteNormalizado): string {
  return LABELS[tipo];
}

/**
 * Normaliza o texto LIVRE de cotacao_frete.servico nas categorias canônicas.
 * Vocabulário levantado do banco em 15/08/2026: SEDEX(490), FRETE INCLUSO(1077),
 * SEM CUSTO(97), MOTOBOY(69), SÃO MIGUEL(28), AZUL ECOMM/ECOMM/AZUL(34),
 * VEPPO/VEPPO-RS(23), RETIRA*(25), UNESUL(5), BRASPRESS/BRASPESS(3), TROCA(2),
 * TRANSPORTADORA PARCEIRA(5) e lixo ("12", "AS", "DD", "NÃO", "FRETE"...).
 * "RETIRA" antes de "TRANSPORTADORA"; acentos são removidos antes do match.
 * IMPORTANTE: "SEM CUSTO" é envio grátis, NÃO retirada (corrige a heurística
 * antiga da tela, que jogava SEM CUSTO em retirada local).
 */
export function normalizarTipoFrete(
  servico: string | null | undefined
): TipoFreteNormalizado {
  const s = (servico ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  if (!s) return "INDEFINIDO";
  if (/(^|[^A-Z])(SEDEX|PAC)([^A-Z]|$)/.test(s)) return "CORREIOS";
  if (s.includes("MOTOBOY")) return "MOTOBOY";
  if (s.includes("RETIRA") || s.includes("BALCAO")) return "RETIRA_BALCAO";
  if (s.includes("SEM CUSTO")) return "SEM_CUSTO";
  if (
    s.includes("SAO MIGUEL") ||
    s.includes("UNESUL") ||
    s.includes("BRASPRESS") ||
    s.includes("BRASPESS") ||
    s.includes("AZUL") ||
    s.includes("ECOMM") ||
    s.includes("VEPPO") ||
    s.includes("TROCA") ||
    s.includes("TRANSPORTADORA")
  ) {
    return "TRANSPORTADORA";
  }
  return "INDEFINIDO";
}
