/**
 * Service para consultar a view_pagamentos_pagos_v2.
 *
 * A view agrega pagamentos_v2 com as seguintes regras oficiais:
 *   - status IN ('PAID', 'A_VENCER')
 *   - confirmado = true
 *   - data_confirmacao IS NOT NULL
 *   - data = (data_confirmacao AT TIME ZONE 'America/Sao_Paulo')::date
 *
 * Retorna: data, id_empresa, status, quantidade, total
 * Granularidade: uma linha por (data, id_empresa, status) — sem duplicatas.
 */

export type ViewPagamentosPagosRow = {
  data: string;        // "YYYY-MM-DD" em America/Sao_Paulo
  id_empresa: number;
  status: string;      // "PAID" | "A_VENCER"
  quantidade: number;
  total: number;
};

export type ViewEmpresaTotal = {
  id_empresa: number;
  empresa: string;
  total: number;
  quantidade: number;
};

export type ViewPagamentosPagosResult = {
  rows: ViewPagamentosPagosRow[];
  error: string | null;
};

const EMPRESA_NOMES: Record<number, string> = {
  1: "IDEAL GRÁFICA EXPRESSA EIRELI",
  2: "IDEAL BIRÔ SERV. GRAFICOS",
  3: "E3 BRINDES LTDA",
};

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/$/, ""), anonKey };
}

/**
 * Busca os dados da view para o intervalo [dataInicio, dataFim] (ambos inclusivos).
 * @param dataInicio "YYYY-MM-DD"
 * @param dataFim    "YYYY-MM-DD"
 */
export async function fetchViewPagamentosPagos(
  dataInicio: string,
  dataFim: string
): Promise<ViewPagamentosPagosResult> {
  const config = getSupabaseConfig();

  if (!config) {
    return { rows: [], error: "Configuração Supabase não encontrada." };
  }

  const url = new URL(`${config.url}/rest/v1/view_pagamentos_pagos_v2`);
  url.searchParams.set("select", "data,id_empresa,status,quantidade,total");
  // PostgREST aceita múltiplas condições na mesma coluna via append
  url.searchParams.append("data", `gte.${dataInicio}`);
  url.searchParams.append("data", `lte.${dataFim}`);
  url.searchParams.set("order", "data.asc,id_empresa.asc,status.asc");

  try {
    const response = await fetch(url.toString(), {
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${await bearerDaSessao(config.anonKey)}`,
        accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        rows: [],
        error: `Erro HTTP ${response.status} ao consultar view_pagamentos_pagos_v2. ${body}`.trim(),
      };
    }

    const data: unknown = await response.json().catch(() => null);

    if (!Array.isArray(data)) {
      return { rows: [], error: "Resposta inesperada da view (formato inválido)." };
    }

    return { rows: data as ViewPagamentosPagosRow[], error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro de rede ao consultar a view.";
    return { rows: [], error: msg };
  }
}

/**
 * Retorna { count, total } dos pagamentos com data_confirmacao = today em SP.
 * @param today "YYYY-MM-DD" em America/Sao_Paulo
 */
export function calcConfirmadosDia(
  rows: ViewPagamentosPagosRow[],
  today: string
): { count: number; total: number } {
  const filtered = rows.filter((r) => r.data === today);
  return {
    count: filtered.reduce((s, r) => s + (Number(r.quantidade) || 0), 0),
    total: filtered.reduce((s, r) => s + (Number(r.total) || 0), 0),
  };
}

/**
 * Retorna { count, total } para o intervalo [dataInicio, dataFim] (ambos inclusivos, "YYYY-MM-DD").
 */
export function calcFaturamentoPeriodo(
  rows: ViewPagamentosPagosRow[],
  dataInicio: string,
  dataFim: string
): { count: number; total: number } {
  const filtered = rows.filter((r) => r.data >= dataInicio && r.data <= dataFim);
  return {
    count: filtered.reduce((s, r) => s + (Number(r.quantidade) || 0), 0),
    total: filtered.reduce((s, r) => s + (Number(r.total) || 0), 0),
  };
}

/**
 * Retorna os totais agrupados por empresa para o intervalo [dataInicio, dataFim].
 * Inicializa sempre as 3 empresas fixas, mesmo sem movimentação no período.
 */
export function calcFaturamentoPorEmpresa(
  rows: ViewPagamentosPagosRow[],
  dataInicio: string,
  dataFim: string
): ViewEmpresaTotal[] {
  const groups = new Map<number, ViewEmpresaTotal>([
    [1, { id_empresa: 1, empresa: EMPRESA_NOMES[1], total: 0, quantidade: 0 }],
    [2, { id_empresa: 2, empresa: EMPRESA_NOMES[2], total: 0, quantidade: 0 }],
    [3, { id_empresa: 3, empresa: EMPRESA_NOMES[3], total: 0, quantidade: 0 }],
  ]);

  rows
    .filter((r) => r.data >= dataInicio && r.data <= dataFim)
    .forEach((r) => {
      const idEmpresa = Number(r.id_empresa);
      const current = groups.get(idEmpresa) ?? {
        id_empresa: idEmpresa,
        empresa: EMPRESA_NOMES[idEmpresa] ?? `Empresa ${idEmpresa}`,
        total: 0,
        quantidade: 0,
      };
      current.total += Number(r.total) || 0;
      current.quantidade += Number(r.quantidade) || 0;
      groups.set(idEmpresa, current);
    });

  return Array.from(groups.values()).sort((a, b) => a.id_empresa - b.id_empresa);
}

import { bearerDaSessao } from "@/lib/supabase/bearer";