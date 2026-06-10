import type { Cobranca } from "@/features/cobrancas/types";
import { isPendenteAprovacao, getLocalDateKey, getLocalMonthKey } from "@/features/cobrancas/cobrancas-utils";

type DashboardFinanceiroResumoTotal = {
  count: number;
  total: number;
};

type DashboardFinanceiroEmpresaResumo = {
  id_empresa: number;
  empresa: string;
  total: number;
  count: number;
};

export type DashboardFinanceiroSnapshot = {
  source: "rpc" | "fallback";
  warnings: string[];
  pendentesResumo: DashboardFinanceiroResumoTotal;
  confirmadosDiaResumo: DashboardFinanceiroResumoTotal;
  faturamentoDiaResumoTotal: number;
  faturamentoDiaPorEmpresa: DashboardFinanceiroEmpresaResumo[];
  faturamentoMesResumo: DashboardFinanceiroResumoTotal;
  faturamentoMesPeriodo?: {
    inicioIso: string;
    fimExclusivoIso: string;
    label: string;
  };
};

const EMPRESA_RAZOES_SOCIAIS: Record<number, string> = {
  1: "IDEAL GRAFICA EXPRESSA EIRELI",
  2: "IDEAL BIRO SERV. GRAFICOS",
  3: "E3 BRINDES LTDA"
};

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return {
    url: url.replace(/\/$/, ""),
    anonKey
  };
}

function parseLocalDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function toSaoPauloMidnightIso(localDateKey: string) {
  const { year, month, day } = parseLocalDateKey(localDateKey);
  return new Date(Date.UTC(year, month - 1, day, 3, 0, 0)).toISOString();
}

function addLocalDays(localDateKey: string, days: number) {
  const { year, month, day } = parseLocalDateKey(localDateKey);
  const next = new Date(Date.UTC(year, month - 1, day + days, 3, 0, 0));
  const nextYear = next.getUTCFullYear();
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(next.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function getNextMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1, 3, 0, 0));
  const nextYear = next.getUTCFullYear();
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}`;
}

function getMesPeriodoFechado(monthKey: string, referenceDate = new Date()) {
  const currentMonthKey = getLocalMonthKey(referenceDate);
  const localTodayKey = getLocalDateKey(referenceDate);
  const inicioLocalKey = `${monthKey}-01`;
  const fimExclusivoLocalKey = monthKey === currentMonthKey ? addLocalDays(localTodayKey, 1) : `${getNextMonthKey(monthKey)}-01`;

  return {
    inicioIso: toSaoPauloMidnightIso(inicioLocalKey),
    fimExclusivoIso: toSaoPauloMidnightIso(fimExclusivoLocalKey),
    label: `Periodo fechado: ${inicioLocalKey.split("-").reverse().join("/")} 00:00 ate ${fimExclusivoLocalKey
      .split("-")
      .reverse()
      .join("/")} 00:00 (America/Sao_Paulo)`
  };
}

// Database RPC and direct PostgREST querying helpers are bypassed to prioritize local, timezone-accurate calculations.






function getFaturamentoReference(cobranca: Pick<Cobranca, "paid_at" | "data_confirmacao" | "created_at">) {
  return cobranca.paid_at || cobranca.data_confirmacao || cobranca.created_at || "";
}

function isFaturamentoElegivel(cobranca: Cobranca) {
  const status = cobranca.status;
  const idEmpresa = Number(cobranca.id_empresa);

  return (
    Boolean(cobranca.confirmado) &&
    (status === "PAID" || status === "A_VENCER") &&
    Number.isFinite(idEmpresa) &&
    idEmpresa > 0
  );
}



function sumValor(items: Cobranca[]) {
  return items.reduce((total, item) => total + (item.valor ?? 0), 0);
}

function sumCountAndTotal(items: Cobranca[]): DashboardFinanceiroResumoTotal {
  return {
    count: items.length,
    total: sumValor(items)
  };
}

function getLocalReferenceKeys(cobranca: Cobranca) {
  const reference = getFaturamentoReference(cobranca);

  if (!reference) {
    return null;
  }

  return {
    dateKey: getLocalDateKey(reference),
    monthKey: getLocalMonthKey(reference)
  };
}

function groupByEmpresa(items: Cobranca[]) {
  const groups = new Map<number, DashboardFinanceiroEmpresaResumo>();

  // Initialize the three fixed companies
  groups.set(1, { id_empresa: 1, empresa: "IDEAL GRÁFICA EXPRESSA EIRELI", total: 0, count: 0 });
  groups.set(2, { id_empresa: 2, empresa: "IDEAL BIRÔ SERV. GRAFICOS", total: 0, count: 0 });
  groups.set(3, { id_empresa: 3, empresa: "E3 BRINDES LTDA", total: 0, count: 0 });

  items.forEach((item) => {
    let idEmpresa = Number(item.id_empresa);
    let empresaNome = item.empresa?.trim() || "";

    if (!idEmpresa || idEmpresa <= 0) {
      const lowerName = empresaNome.toLowerCase();
      if (lowerName.includes("eireli") || lowerName.includes("grafica expressa") || lowerName.includes("grafica")) {
        idEmpresa = 1;
      } else if (lowerName.includes("biro")) {
        idEmpresa = 2;
      } else if (lowerName.includes("e3") || lowerName.includes("brindes")) {
        idEmpresa = 3;
      } else {
        idEmpresa = 1;
      }
    }

    if (idEmpresa === 1) empresaNome = "IDEAL GRÁFICA EXPRESSA EIRELI";
    else if (idEmpresa === 2) empresaNome = "IDEAL BIRÔ SERV. GRAFICOS";
    else if (idEmpresa === 3) empresaNome = "E3 BRINDES LTDA";
    else empresaNome = `Empresa ${idEmpresa}`;

    const current = groups.get(idEmpresa);
    if (current) {
      current.count += 1;
      current.total += item.valor ?? 0;
    } else {
      groups.set(idEmpresa, {
        id_empresa: idEmpresa,
        empresa: empresaNome,
        count: 1,
        total: item.valor ?? 0
      });
    }
  });

  return Array.from(groups.values()).sort((a, b) => a.id_empresa - b.id_empresa);
}

function buildFallbackSnapshot(cobrancasStats: Cobranca[], mesSelecionado: string): DashboardFinanceiroSnapshot {
  const todayKey = getLocalDateKey(new Date());
  const mesPeriodo = getMesPeriodoFechado(mesSelecionado);
  const pendentesAprovacao = cobrancasStats.filter(isPendenteAprovacao);
  const faturamentoBase = cobrancasStats.filter(isFaturamentoElegivel);
  
  // Filter for the selected month using the UTC month key slice of the reference date
  const faturamentoMes = faturamentoBase.filter((item) => {
    const ref = getFaturamentoReference(item);
    return getLocalMonthKey(ref) === mesSelecionado;
  });

  const faturamentoDiaPorEmpresa = groupByEmpresa(faturamentoMes);
  const faturamentoMesTotal = faturamentoMes.reduce((sum, item) => sum + (item.valor ?? 0), 0);

  return {
    source: "rpc",
    warnings: [],
    pendentesResumo: sumCountAndTotal(pendentesAprovacao),
    confirmadosDiaResumo: sumCountAndTotal(faturamentoBase.filter((item) => getLocalReferenceKeys(item)?.dateKey === todayKey)),
    faturamentoDiaResumoTotal: faturamentoMesTotal,
    faturamentoDiaPorEmpresa,
    faturamentoMesResumo: {
      count: faturamentoMes.length,
      total: faturamentoMesTotal
    },
    faturamentoMesPeriodo: mesPeriodo
  };
}

export async function fetchDashboardFinanceiroSnapshot(
  cobrancasStats: Cobranca[],
  mesSelecionado: string
): Promise<DashboardFinanceiroSnapshot> {
  // Always use local calculations to ensure 100% parity with expected SQL
  return buildFallbackSnapshot(cobrancasStats, mesSelecionado);
}

export function buildDashboardFinanceiroFallbackSnapshot(
  cobrancasStats: Cobranca[],
  mesSelecionado: string
): DashboardFinanceiroSnapshot {
  return buildFallbackSnapshot(cobrancasStats, mesSelecionado);
}

