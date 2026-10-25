import { addDays, diffDays, hojeSP, type DateRange } from "@/lib/period";
import type { PresetPeriodo } from "../types";

export const ROTULO_PRESET: Record<PresetPeriodo, string> = {
  hoje: "Hoje",
  mes: "Mês atual",
  mes_completo: "Este mês inteiro",
  proximo_mes: "Próximo mês",
  mes_anterior: "Mês anterior",
  custom: "Personalizado"
};

function ehDataIso(valor: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(new Date(`${valor}T00:00:00Z`).getTime());
}

/** Primeiro dia do mês seguinte à data (AAAA-MM-DD). */
function primeiroDoMesSeguinte(data: string) {
  const [ano, mes] = data.split("-").map(Number);
  return new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10);
}

/** Período em datas civis de São Paulo (AAAA-MM-DD). */
export function resolverPeriodo(
  preset: PresetPeriodo,
  ini: string,
  fim: string,
  hoje: string = hojeSP()
): DateRange {
  const primeiroDoMes = `${hoje.slice(0, 7)}-01`;
  switch (preset) {
    case "hoje":
      return { inicio: hoje, fim: hoje };
    case "mes":
      return { inicio: primeiroDoMes, fim: hoje };
    case "mes_completo":
      return { inicio: primeiroDoMes, fim: addDays(primeiroDoMesSeguinte(hoje), -1) };
    case "proximo_mes": {
      const inicioProximo = primeiroDoMesSeguinte(hoje);
      return { inicio: inicioProximo, fim: addDays(primeiroDoMesSeguinte(inicioProximo), -1) };
    }
    case "mes_anterior": {
      const ultimo = addDays(primeiroDoMes, -1);
      return { inicio: `${ultimo.slice(0, 7)}-01`, fim: ultimo };
    }
    case "custom": {
      if (!ehDataIso(ini) || !ehDataIso(fim)) return { inicio: primeiroDoMes, fim: hoje };
      return ini <= fim ? { inicio: ini, fim } : { inicio: fim, fim: ini };
    }
  }
}

/** Dias do período, contando os dois extremos. */
export function diasDoPeriodo(periodo: DateRange) {
  return diffDays(periodo.inicio, periodo.fim) + 1;
}

export { ehDataIso };
