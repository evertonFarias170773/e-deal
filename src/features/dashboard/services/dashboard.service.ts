/**
 * dashboard.service.ts
 *
 * Camada de acesso a dados do Dashboard — somente leitura (SELECT).
 * Nenhuma escrita, migration ou alteração de schema.
 *
 * Cards implementados:
 *   1. Vendas do mês        → public.propostas     (status_interno = 'APROVADO', mês atual, filtro empresa)
 *   2. Contas a receber     → public.boletos       (status aberto, filtro id_empresa)
 *   3. Propostas aguardando → public.propostas     (status_interno = 'AGUARDANDO', filtro empresa texto)
 *   4. Notas com erro       → public.notas_fiscais + public.notas_servico (filtro id_empresa)
 *   5. Produção             → placeholder: módulo de OS consolidado ainda não existe
 *
 * ⚠️  public.propostas NÃO possui `id_empresa` — empresa é identificada pelo campo TEXT `empresa`.
 *     public.boletos, notas_fiscais e notas_servico possuem `id_empresa` numérico.
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/formatters/currency";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type DashboardCardKey =
  | "vendasMes"
  | "contasReceber"
  | "propostasAguardando"
  | "notasErro"
  | "producao";

export type DashboardCardData = {
  key: DashboardCardKey;
  title: string;
  value: string;
  description: string;
  trend?: string;
  tone: "success" | "info" | "warning" | "danger" | "special" | "neutral";
  isLoading: boolean;
  isPlaceholder?: boolean;
};

export type DashboardMetricsResult = {
  cards: DashboardCardData[];
  source: "supabase" | "fallback";
  errorMessage?: string;
};

// ─── Mapeamento empresa ID → padrão de texto em `propostas.empresa` ───────────
// Empresa id=0 significa "Todas" — sem filtro.
// As demais correspondem aos padrões utilizados pelo ERP ao gravar o campo `empresa`.

const EMPRESA_TEXT_PATTERNS: Record<number, string[]> = {
  1: ["ideal grafica", "ideal gráfica", "ingresso ideal", "ideal"],
  2: ["ideal biro", "biro grafica", "biro gráfica", "birô", "biro"],
  3: ["e3 brindes", "e3"],
};

// ─── Helpers internos ─────────────────────────────────────────────────────────

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Retorna o intervalo [start, end) do mês corrente em ISO,
 * ajustado para UTC considerando fuso de São Paulo (UTC-3).
 */
function getCurrentMonthRange(): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  // Mês inicia à meia-noite em SP = 03:00 UTC
  const start = new Date(Date.UTC(year, month, 1, 3, 0, 0)).toISOString();
  const end = new Date(Date.UTC(year, month + 1, 1, 3, 0, 0)).toISOString();
  return { start, end };
}

/**
 * Verifica se o texto do campo `empresa` em propostas pertence a uma empresa específica.
 * Retorna true se companyId === 0 (Todas).
 */
function empresaTextMatchesCompany(empresaText: string | null | undefined, companyId: number): boolean {
  if (companyId === 0) return true;
  const patterns = EMPRESA_TEXT_PATTERNS[companyId];
  if (!patterns) return false;
  const lower = String(empresaText ?? "").toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

// Statuses fiscais que representam erro/problema e devem aparecer no card "Notas com erro"
const NFE_ERROR_STATUSES = ["ERRO_AUTORIZACAO", "ERRO_ENVIO", "NAO_ENCONTRADA_FOCUS", "DENEGADA"];
const NFSE_ERROR_STATUSES = ["ERRO_ENVIO", "REJEITADA"];

// ─── 1. Vendas do mês ─────────────────────────────────────────────────────────

async function fetchVendasMes(companyId: number): Promise<{ valor: number; quantidade: number }> {
  const client = getSupabaseClient();
  if (!client) return { valor: 0, quantidade: 0 };

  const { start, end } = getCurrentMonthRange();

  // Propostas não têm id_empresa: buscamos todas aprovadas do mês e filtramos por empresa no JS
  const { data, error } = await client
    .from("propostas")
    .select("valor, valor_total, valor_frete, empresa")
    .eq("status_interno", "APROVADO")
    .gte("created_at", start)
    .lt("created_at", end)
    .limit(5000);

  if (error || !Array.isArray(data)) {
    console.warn("[Dashboard] Erro ao buscar vendas do mês:", error?.message);
    return { valor: 0, quantidade: 0 };
  }

  const filtered = companyId === 0 ? data : data.filter((row) => empresaTextMatchesCompany(row.empresa, companyId));

  const valor = filtered.reduce((acc, row) => {
    // valor_total quando disponível; fallback seguro: valor + valor_frete
    const vt = toNumber(row.valor_total);
    const v = toNumber(row.valor);
    const frete = toNumber(row.valor_frete);
    return acc + (vt > 0 ? vt : v + frete);
  }, 0);

  return { valor, quantidade: filtered.length };
}

// ─── 2. Contas a receber ──────────────────────────────────────────────────────

async function fetchContasReceber(companyId: number): Promise<{ valor: number; quantidade: number }> {
  const client = getSupabaseClient();
  if (!client) return { valor: 0, quantidade: 0 };

  // boletos possui id_empresa → podemos filtrar no banco diretamente
  let query = client
    .from("boletos")
    .select("valor, valor_atualizado")
    .not("status", "in", "(PAID,PAGO,CANCELADO)");

  if (companyId !== 0) {
    query = query.eq("id_empresa", companyId);
  }

  const { data, error } = await query.limit(10000);

  if (error || !Array.isArray(data)) {
    console.warn("[Dashboard] Erro ao buscar contas a receber:", error?.message);
    return { valor: 0, quantidade: 0 };
  }

  const valor = data.reduce((acc, row) => {
    const va = toNumber(row.valor_atualizado);
    const v = toNumber(row.valor);
    return acc + (va > 0 ? va : v);
  }, 0);

  return { valor, quantidade: data.length };
}

// ─── 3. Propostas aguardando ──────────────────────────────────────────────────

async function fetchPropostasAguardando(companyId: number): Promise<{ quantidade: number }> {
  const client = getSupabaseClient();
  if (!client) return { quantidade: 0 };

  // propostas não tem id_empresa; se "Todas" usamos count direto; senão filtramos no JS
  if (companyId === 0) {
    const { count, error } = await client
      .from("propostas")
      .select("id", { count: "exact", head: true })
      .eq("status_interno", "AGUARDANDO");

    if (error) {
      console.warn("[Dashboard] Erro ao buscar propostas aguardando:", error?.message);
      return { quantidade: 0 };
    }
    return { quantidade: count ?? 0 };
  }

  // Para empresa específica: buscar com campo `empresa` e filtrar no JS
  const { data, error } = await client
    .from("propostas")
    .select("empresa")
    .eq("status_interno", "AGUARDANDO")
    .limit(5000);

  if (error || !Array.isArray(data)) {
    console.warn("[Dashboard] Erro ao buscar propostas aguardando:", error?.message);
    return { quantidade: 0 };
  }

  const quantidade = data.filter((row) => empresaTextMatchesCompany(row.empresa, companyId)).length;
  return { quantidade };
}

// ─── 4. Notas com erro ────────────────────────────────────────────────────────

async function fetchNotasErro(companyId: number): Promise<{ quantidade: number }> {
  const client = getSupabaseClient();
  if (!client) return { quantidade: 0 };

  // NF-e (notas_fiscais) com id_empresa
  let nfeQuery = client
    .from("notas_fiscais")
    .select("id", { count: "exact", head: true })
    .in("status", NFE_ERROR_STATUSES);

  if (companyId !== 0) {
    nfeQuery = nfeQuery.eq("id_empresa", companyId);
  }

  // NFS-e (notas_servico) com id_empresa
  let nfseQuery = client
    .from("notas_servico")
    .select("id", { count: "exact", head: true })
    .in("status", NFSE_ERROR_STATUSES);

  if (companyId !== 0) {
    nfseQuery = nfseQuery.eq("id_empresa", companyId);
  }

  const [nfeResult, nfseResult] = await Promise.all([nfeQuery, nfseQuery]);

  if (nfeResult.error) console.warn("[Dashboard] Erro ao buscar NF-e com erro:", nfeResult.error?.message);
  if (nfseResult.error) console.warn("[Dashboard] Erro ao buscar NFS-e com erro:", nfseResult.error?.message);

  const quantidade = (nfeResult.count ?? 0) + (nfseResult.count ?? 0);
  return { quantidade };
}

// ─── Agregador principal ──────────────────────────────────────────────────────

export async function getDashboardMetrics(companyId: number): Promise<DashboardMetricsResult> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      cards: buildFallbackCards(),
      source: "fallback",
      errorMessage: "Conexão com o banco indisponível.",
    };
  }

  try {
    const [vendas, contasReceber, propostasAguardando, notasErro] = await Promise.all([
      fetchVendasMes(companyId),
      fetchContasReceber(companyId),
      fetchPropostasAguardando(companyId),
      fetchNotasErro(companyId),
    ]);

    const cards: DashboardCardData[] = [
      {
        key: "vendasMes",
        title: "Vendas do mês",
        value: formatCurrency(vendas.valor),
        description: `${vendas.quantidade} proposta(s) aprovada(s) no mês`,
        tone: "success",
        isLoading: false,
      },
      {
        key: "contasReceber",
        title: "Contas a receber",
        value: formatCurrency(contasReceber.valor),
        description: `${contasReceber.quantidade} título(s) em aberto`,
        tone: "info",
        isLoading: false,
      },
      {
        key: "propostasAguardando",
        title: "Propostas aguardando",
        value: String(propostasAguardando.quantidade),
        description: "Aguardando retorno ou aprovação",
        tone: "warning",
        isLoading: false,
      },
      {
        key: "notasErro",
        title: "Notas com erro",
        value: String(notasErro.quantidade),
        description: "Pendências fiscais (NF-e + NFS-e)",
        tone: notasErro.quantidade > 0 ? "danger" : "neutral",
        isLoading: false,
      },
      {
        key: "producao",
        title: "OS em produção",
        value: "—",
        description: "Módulo de Produção em preparação",
        trend: "Integração futura",
        tone: "special",
        isLoading: false,
        isPlaceholder: true,
      },
    ];

    return { cards, source: "supabase" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Dashboard] Erro inesperado ao buscar métricas:", msg);
    return {
      cards: buildFallbackCards(),
      source: "fallback",
      errorMessage: msg,
    };
  }
}

/** Cards de fallback exibidos quando o banco está indisponível. */
function buildFallbackCards(): DashboardCardData[] {
  const defs: Array<{ key: DashboardCardKey; title: string; tone: DashboardCardData["tone"] }> = [
    { key: "vendasMes", title: "Vendas do mês", tone: "success" },
    { key: "contasReceber", title: "Contas a receber", tone: "info" },
    { key: "propostasAguardando", title: "Propostas aguardando", tone: "warning" },
    { key: "notasErro", title: "Notas com erro", tone: "danger" },
    { key: "producao", title: "OS em produção", tone: "special" },
  ];

  return defs.map(({ key, title, tone }) => ({
    key,
    title,
    value: "—",
    description: "Dados indisponíveis",
    tone,
    isLoading: false,
    isPlaceholder: true,
  }));
}
