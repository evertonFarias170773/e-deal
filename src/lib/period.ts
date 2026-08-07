/**
 * Períodos de análise do Dashboard — camada pura (sem React).
 *
 * Todas as datas são strings "YYYY-MM-DD" no fuso de negócio America/Sao_Paulo
 * (padrão canônico do projeto: toLocaleDateString("sv-SE")). Comparações usam
 * a própria string ISO, que é ordenável.
 *
 * Presets correntes (mês/trimestre/semestre/ano) têm o fim CLAMPADO a hoje e o
 * período anterior TRUNCADO ao mesmo dia relativo do ciclo — sem isso, comparar
 * um mês em andamento com o mês anterior inteiro deixaria a tendência sempre
 * negativa.
 */

export type PeriodPreset =
  | "hoje"
  | "7d"
  | "mes"
  | "30d"
  | "tri"
  | "sem"
  | "ano"
  | "custom";

export type DateRange = { inicio: string; fim: string };

export const PERIOD_PRESET_VALUES = [
  "hoje",
  "7d",
  "mes",
  "30d",
  "tri",
  "sem",
  "ano",
  "custom"
] as const;

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  hoje: "Hoje",
  "7d": "Últimos 7 dias",
  mes: "Mês atual",
  "30d": "Últimos 30 dias",
  tri: "Trimestre",
  sem: "Semestre",
  ano: "Ano",
  custom: "Personalizado"
};

/** Data de hoje em São Paulo, formato YYYY-MM-DD. */
export function hojeSP(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

const DIA_MS = 86_400_000;

function paraUTC(data: string): number {
  const [ano, mes, dia] = data.split("-").map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

function deUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(data: string, dias: number): string {
  return deUTC(paraUTC(data) + dias * DIA_MS);
}

/** Diferença fim - inicio, em dias (0 quando iguais). */
export function diffDays(inicio: string, fim: string): number {
  return Math.round((paraUTC(fim) - paraUTC(inicio)) / DIA_MS);
}

function ehDataIso(valor: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

/** Primeiro dia do ciclo (mês/trimestre/semestre/ano) que contém a data. */
function inicioDoCiclo(preset: PeriodPreset, data: string): string {
  const [ano, mes] = data.split("-").map(Number);
  if (preset === "mes") return `${ano}-${String(mes).padStart(2, "0")}-01`;
  if (preset === "tri") {
    const mesInicio = Math.floor((mes - 1) / 3) * 3 + 1;
    return `${ano}-${String(mesInicio).padStart(2, "0")}-01`;
  }
  if (preset === "sem") return `${ano}-${mes <= 6 ? "01" : "07"}-01`;
  return `${ano}-01-01`;
}

/**
 * Resolve o range do período selecionado. `ini`/`fim` só são considerados no
 * preset "custom"; incompletos ou inválidos caem no mês atual.
 */
export function resolveRange(
  preset: PeriodPreset,
  ini: string,
  fim: string,
  hoje: string = hojeSP()
): DateRange {
  switch (preset) {
    case "hoje":
      return { inicio: hoje, fim: hoje };
    case "7d":
      return { inicio: addDays(hoje, -6), fim: hoje };
    case "30d":
      return { inicio: addDays(hoje, -29), fim: hoje };
    case "mes":
    case "tri":
    case "sem":
    case "ano":
      return { inicio: inicioDoCiclo(preset, hoje), fim: hoje };
    case "custom": {
      if (!ehDataIso(ini) || !ehDataIso(fim)) {
        return { inicio: inicioDoCiclo("mes", hoje), fim: hoje };
      }
      return ini <= fim ? { inicio: ini, fim } : { inicio: fim, fim: ini };
    }
  }
}

/**
 * Período anterior equivalente, para os comparativos.
 *
 * - Presets de calendário (mes/tri/sem/ano): ciclo anterior, truncado ao mesmo
 *   dia relativo (em 07/08, "Mês atual" 01–07/08 compara com 01–07/07).
 * - Presets rolantes (hoje/7d/30d/custom): mesma duração imediatamente
 *   anterior (fim = véspera do início atual).
 */
export function previousRange(preset: PeriodPreset, range: DateRange): DateRange {
  const duracao = diffDays(range.inicio, range.fim);

  if (preset === "mes" || preset === "tri" || preset === "sem" || preset === "ano") {
    const fimCicloAnterior = addDays(range.inicio, -1);
    const inicioCicloAnterior = inicioDoCiclo(preset, fimCicloAnterior);
    const fimTruncado = addDays(inicioCicloAnterior, duracao);
    return {
      inicio: inicioCicloAnterior,
      fim: fimTruncado > fimCicloAnterior ? fimCicloAnterior : fimTruncado
    };
  }

  const fimAnterior = addDays(range.inicio, -1);
  return { inicio: addDays(fimAnterior, -duracao), fim: fimAnterior };
}

/** Rótulo curto de um range para descrições ("01/08 – 07/08"). */
export function formatRangeLabel(range: DateRange): string {
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  if (range.inicio === range.fim) return br(range.inicio);
  return `${br(range.inicio)} – ${br(range.fim)}`;
}
