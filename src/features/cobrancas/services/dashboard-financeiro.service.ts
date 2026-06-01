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

async function callDashboardFinanceiroRpc(data_inicio: string, data_fim: string) {
  const config = getSupabaseConfig();

  if (!config) {
    return null;
  }

  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/get_dashboard_financeiro`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${config.anonKey}`,
        accept: "application/json",
        "content-type": "application/json",
        "accept-profile": "public"
      },
      body: JSON.stringify({
        data_inicio,
        data_fim
      })
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json().catch(() => null)) as unknown;
    return data;
  } catch {
    return null;
  }
}

type PagamentoV2MonthRow = {
  valor?: number | string | null;
};

async function fetchPagamentosV2MonthRows(inicioIso: string, fimExclusivoIso: string) {
  const config = getSupabaseConfig();

  if (!config) {
    return null;
  }

  const rows: PagamentoV2MonthRow[] = [];
  const limit = 1000;

  for (let offset = 0; offset < 20000; offset += limit) {
    const url = new URL(`${config.url}/rest/v1/pagamentos_v2`);
    url.searchParams.set("select", "valor");
    url.searchParams.set("status", "in.(PAID,A_VENCER)");
    url.searchParams.set("confirmado", "eq.true");
    url.searchParams.append("paid_at", `gte.${inicioIso}`);
    url.searchParams.append("paid_at", `lt.${fimExclusivoIso}`);
    url.searchParams.set("order", "paid_at.asc");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const response = await fetch(url.toString(), {
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${config.anonKey}`,
        accept: "application/json",
        "accept-profile": "public"
      }
    });

    if (!response.ok) {
      return null;
    }

    const page = (await response.json().catch(() => null)) as PagamentoV2MonthRow[] | null;
    if (!Array.isArray(page)) {
      return null;
    }

    rows.push(...page);

    if (page.length < limit) {
      break;
    }
  }

  return rows;
}






function getFaturamentoReference(cobranca: Pick<Cobranca, "paid_at" | "data_confirmacao">) {
  return cobranca.paid_at || cobranca.data_confirmacao || "";
}

function isFaturamentoElegivel(cobranca: Cobranca) {
  const status = cobranca.status;
  const idEmpresa = Number(cobranca.id_empresa);

  return (
    Boolean(cobranca.confirmado) &&
    (status === "PAID" || status === "A_VENCER") &&
    Number.isFinite(idEmpresa) &&
    idEmpresa > 0 &&
    Boolean(getFaturamentoReference(cobranca))
  );
}

function getPaidAtValue(cobranca: Pick<Cobranca, "paid_at">) {
  return cobranca.paid_at || "";
}

function isWithinIsoRange(value: string, inicioIso: string, fimExclusivoIso: string) {
  if (!value) {
    return false;
  }

  const timestamp = new Date(value).getTime();
  const start = new Date(inicioIso).getTime();
  const end = new Date(fimExclusivoIso).getTime();

  return Number.isFinite(timestamp) && timestamp >= start && timestamp < end;
}

function getEmpresaResumoLabel(idEmpresa: number) {
  return EMPRESA_RAZOES_SOCIAIS[idEmpresa] ?? `Empresa ${idEmpresa}`;
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

  items.forEach((item) => {
    const idEmpresa = Number(item.id_empresa);
    if (!Number.isFinite(idEmpresa) || idEmpresa <= 0) {
      return;
    }

    const current = groups.get(idEmpresa);
    const nextCount = (current?.count ?? 0) + 1;
    const nextTotal = (current?.total ?? 0) + (item.valor ?? 0);

    groups.set(idEmpresa, {
      id_empresa: idEmpresa,
      empresa: getEmpresaResumoLabel(idEmpresa),
      count: nextCount,
      total: nextTotal
    });
  });

  return Array.from(groups.values()).sort((a, b) => a.id_empresa - b.id_empresa);
}

function buildFallbackSnapshot(cobrancasStats: Cobranca[], mesSelecionado: string): DashboardFinanceiroSnapshot {
  const todayKey = getLocalDateKey(new Date());
  const mesPeriodo = getMesPeriodoFechado(mesSelecionado);
  const pendentesAprovacao = cobrancasStats.filter(isPendenteAprovacao);
  const faturamentoBase = cobrancasStats.filter(isFaturamentoElegivel);
  const confirmadosDoDia = faturamentoBase.filter((item) => getLocalReferenceKeys(item)?.dateKey === todayKey);
  const faturamentoMes = faturamentoBase.filter((item) => isWithinIsoRange(getPaidAtValue(item), mesPeriodo.inicioIso, mesPeriodo.fimExclusivoIso));
  const faturamentoDiaPorEmpresa = groupByEmpresa(confirmadosDoDia);

  return {
    source: "fallback",
    warnings: [
      `RPC get_dashboard_financeiro indisponivel no ambiente. Usando fallback temporario em pagamentos_v2 para ${mesPeriodo.label}.`
    ],
    pendentesResumo: sumCountAndTotal(pendentesAprovacao),
    confirmadosDiaResumo: sumCountAndTotal(confirmadosDoDia),
    faturamentoDiaResumoTotal: sumValor(confirmadosDoDia),
    faturamentoDiaPorEmpresa,
    faturamentoMesResumo: sumCountAndTotal(faturamentoMes),
    faturamentoMesPeriodo: mesPeriodo
  };
}

export async function fetchDashboardFinanceiroSnapshot(
  cobrancasStats: Cobranca[],
  mesSelecionado: string
): Promise<DashboardFinanceiroSnapshot> {
  const [year, month] = mesSelecionado.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const data_inicio = `${mesSelecionado}-01`;
  const data_fim = `${mesSelecionado}-${String(lastDay).padStart(2, "0")}`;

  const rpcData = await callDashboardFinanceiroRpc(data_inicio, data_fim);
  const mesPeriodo = getMesPeriodoFechado(mesSelecionado);

  if (Array.isArray(rpcData) && rpcData.length > 0) {
    const rpcRow = rpcData[0] as Record<string, unknown>;
    const emp1 = Number(rpcRow.empresa1) || 0;
    const emp2 = Number(rpcRow.empresa2) || 0;
    const emp3 = Number(rpcRow.empresa3) || 0;
    const totalPeriodo = Number(rpcRow.total_periodo) || 0;

    const fallback = buildFallbackSnapshot(cobrancasStats, mesSelecionado);
    return {
      ...fallback,
      source: "rpc",
      warnings: [],
      faturamentoMesResumo: {
        count: fallback.faturamentoMesResumo.count,
        total: totalPeriodo
      },
      faturamentoDiaPorEmpresa: [
        { id_empresa: 1, empresa: "IDEAL GRAFICA EXPRESSA EIRELI", total: emp1, count: 0 },
        { id_empresa: 2, empresa: "IDEAL BIRO SERV. GRAFICOS", total: emp2, count: 0 },
        { id_empresa: 3, empresa: "E3 BRINDES LTDA", total: emp3, count: 0 }
      ],
      faturamentoDiaResumoTotal: totalPeriodo,
      faturamentoMesPeriodo: mesPeriodo
    };
  }

  const monthRows = await fetchPagamentosV2MonthRows(mesPeriodo.inicioIso, mesPeriodo.fimExclusivoIso);
  if (monthRows) {
    const fallback = buildFallbackSnapshot(cobrancasStats, mesSelecionado);
    const total = monthRows.reduce((sum, row) => sum + (Number(row.valor) || 0), 0);
    return {
      ...fallback,
      faturamentoMesResumo: {
        count: monthRows.length,
        total
      },
      faturamentoMesPeriodo: mesPeriodo
    };
  }

  return buildFallbackSnapshot(cobrancasStats, mesSelecionado);
}

export function buildDashboardFinanceiroFallbackSnapshot(
  cobrancasStats: Cobranca[],
  mesSelecionado: string
): DashboardFinanceiroSnapshot {
  return buildFallbackSnapshot(cobrancasStats, mesSelecionado);
}

