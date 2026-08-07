import type { StatusTone } from "@/lib/types";

export type TrendChip = { label: string; tone: StatusTone };

/**
 * Tendência percentual de um KPI vs o período anterior equivalente.
 *
 * - `anterior = 0` não permite variação percentual: com valor atual devolve
 *   "Novo no período"; zerado nos dois, "sem base de comparação" é omitido.
 * - `invert` marca KPIs em que crescer é ruim (ex.: valor perdido).
 */
export function formatTrend(
  atual: number,
  anterior: number,
  opts?: { invert?: boolean }
): TrendChip | undefined {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior)) return undefined;

  if (anterior === 0) {
    if (atual === 0) return undefined;
    return { label: "Novo no período", tone: "info" };
  }

  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  const arredondado = Math.round(pct);

  if (arredondado === 0) {
    return { label: "= estável vs período anterior", tone: "neutral" };
  }

  const subiu = arredondado > 0;
  const seta = subiu ? "↑" : "↓";
  const bom = opts?.invert ? !subiu : subiu;
  return {
    label: `${seta} ${subiu ? "+" : ""}${arredondado}% vs período anterior`,
    tone: bom ? "success" : "danger"
  };
}

/** Tendência em pontos percentuais (para taxas, ex.: conversão). */
export function formatTrendPontos(atualPct: number, anteriorPct: number): TrendChip | undefined {
  if (!Number.isFinite(atualPct) || !Number.isFinite(anteriorPct)) return undefined;

  const delta = Math.round((atualPct - anteriorPct) * 10) / 10;
  if (delta === 0) return { label: "= estável vs período anterior", tone: "neutral" };

  const subiu = delta > 0;
  return {
    label: `${subiu ? "↑ +" : "↓ "}${delta} p.p. vs período anterior`,
    tone: subiu ? "success" : "danger"
  };
}

/** Conversão de coorte: % das propostas criadas no período que estão ganhas. */
export function taxaConversao(ganhas: number, criadas: number): number | null {
  if (!criadas) return null;
  return (ganhas / criadas) * 100;
}
