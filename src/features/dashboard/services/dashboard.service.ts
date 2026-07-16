/**
 * dashboard.service.ts
 *
 * Camada de acesso a dados do Dashboard — somente leitura (SELECT).
 * Nenhuma escrita, migration ou alteração de schema, views, triggers, RPCs ou Edge Functions.
 *
 * ─── Fontes oficiais por card ────────────────────────────────────────────────
 *
 *  1. Vendas do mês       → view_pagamentos_pagos_v2
 *       Status PAID no mês corrente; filtro por id_empresa.
 *       Service reutilizado de: @/features/cobrancas/services/view-pagamentos-pagos.service
 *
 *  2. Contas a receber    → public.vw_boletos_controle
 *       Saldo em aberto = situacao IN ('AVENCER', 'VENCIDO')
 *       PAGO não entra no total pendente.
 *       ⚠️  A view não possui id_empresa nem campo de empresa.
 *       O único vínculo possível seria: vw_boletos_controle.id_int → propostas.id_int → propostas.empresa
 *       Isso exigiria dois passos de consulta (buscar id_ints da empresa e depois filtrar a view),
 *       o que não é seguro por volume e não existe como RPC ou join nativo.
 *       DECISÃO: card exibe total consolidado (todas as empresas) independentemente do seletor.
 *       O seletor de empresa não afeta este card até que haja RPC ou campo id_empresa na view.
 *
 *  3. Propostas aguardando → public.propostas
 *       status_interno IN ['AGUARDANDO', 'AGUARDANDO / EM ARTE', 'AGUARDANDO / PENDENTE']
 *       is_reproved = false
 *       Filtro de empresa via campo texto `empresa` (propostas não tem id_empresa).
 *
 *  4. Notas a liberar     → PLACEHOLDER EXPLÍCITO
 *       Integração fiscal adiada. Retorna 0 sem consultar banco.
 *       TODO: integrar com notas_fiscais + notas_servico quando definido pelo produto.
 *
 *  5. OS em produção      → public.propostas
 *       status_interno = 'EM PRODUCAO' (grafia exata confirmada no banco)
 *       Filtro de empresa via campo texto `empresa`.
 *
 * ─── Regra de empresa em `propostas` ────────────────────────────────────────
 *  A tabela `propostas` NÃO possui `id_empresa`. O campo `empresa` é texto.
 *  O filtro é aplicado no JavaScript após a busca, usando exclusão explícita.
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/formatters/currency";
import { fetchViewPagamentosPagos } from "@/features/cobrancas/services/view-pagamentos-pagos.service";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type DashboardCardKey =
  | "vendasMes"
  | "contasReceber"
  | "propostasAguardando"
  | "notasLiberar"
  | "emProducao";

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

// ─── Filtro de empresa em `propostas` (campo texto) ───────────────────────────
// Padrões específicos listados antes dos genéricos para evitar falso-positivo.
// Empresa 1 usa lógica de exclusão: exclui padrões de 2 e 3, depois aceita "ideal".

const EMPRESA_INCLUDE_PATTERNS: Record<number, string[]> = {
  1: ["ideal grafica", "ideal gráfica", "ingresso ideal"],
  2: ["ideal biro", "biro grafica", "biro gráfica", "birô", "biro"],
  3: ["e3 brindes", "e3"],
};

const EMPRESA_EXCLUDE_PATTERNS: Record<number, string[]> = {
  // Para empresa 1, rejeitar qualquer texto que contenha padrões de empresa 2 ou 3
  1: [...EMPRESA_INCLUDE_PATTERNS[2], ...EMPRESA_INCLUDE_PATTERNS[3]],
  2: [],
  3: [],
};

function empresaTextMatchesCompany(
  empresaText: string | null | undefined,
  companyId: number
): boolean {
  if (companyId === 0) return true; // "Todas" — sem filtro
  const lower = String(empresaText ?? "").toLowerCase();

  // Verificar exclusões primeiro
  const exclusions = EMPRESA_EXCLUDE_PATTERNS[companyId] ?? [];
  if (exclusions.some((p) => lower.includes(p))) return false;

  // Empresa 1: aceitar o genérico "ideal" após exclusão de biro/e3
  if (companyId === 1 && lower.includes("ideal")) return true;

  const includes = EMPRESA_INCLUDE_PATTERNS[companyId] ?? [];
  return includes.some((p) => lower.includes(p));
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Retorna o primeiro e último dia do mês corrente no formato "YYYY-MM-DD"
 * em horário de São Paulo (America/Sao_Paulo).
 */
function getCurrentMonthRangeSP(): { inicio: string; fim: string } {
  const now = new Date();
  const spDateStr = now.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const [year, month] = spDateStr.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const inicio = `${year}-${String(month).padStart(2, "0")}-01`;
  const fim = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { inicio, fim };
}

// Status de "Aguardando" conforme business-rules.ts (PROPOSTA_STATUS_GRUPOS.orcamento)
const AGUARDANDO_STATUSES = [
  "AGUARDANDO",
  "AGUARDANDO / EM ARTE",
  "AGUARDANDO / PENDENTE",
] as const;

// ─── 1. Vendas do mês — view_pagamentos_pagos_v2 ─────────────────────────────
//
// A view já possui service próprio em cobrancas/services/view-pagamentos-pagos.service.ts.
// Reutilizamos fetchViewPagamentosPagos() que faz fetch via PostgREST.
// Campos da view: data (YYYY-MM-DD), id_empresa (number), status, quantidade, total.
// Filtramos status = 'PAID' (pagamentos confirmados) no mês corrente.
// O filtro de empresa é feito no JS sobre id_empresa.

async function fetchVendasMes(companyId: number): Promise<{ valor: number; quantidade: number }> {
  const { inicio, fim } = getCurrentMonthRangeSP();

  const result = await fetchViewPagamentosPagos(inicio, fim);

  if (result.error || !result.rows.length) {
    if (result.error) console.warn("[Dashboard] Erro ao buscar vendas do mês:", result.error);
    return { valor: 0, quantidade: 0 };
  }

  // Filtrar somente PAID (pagamentos efetivados) + empresa
  const rows = result.rows.filter((r) => {
    if (r.status !== "PAID") return false;
    if (companyId === 0) return true;
    return Number(r.id_empresa) === companyId;
  });

  const valor = rows.reduce((acc, r) => acc + toNumber(r.total), 0);
  const quantidade = rows.reduce((acc, r) => acc + toNumber(r.quantidade), 0);

  return { valor, quantidade };
}

// ─── 2. Contas a receber — public.vw_boletos_controle ─────────────────────────────
//
// Saldo em aberto = situacao IN ('AVENCER', 'VENCIDO')
// PAGO não entra no total pendente.
// Campos da view: id, id_int, parcela, total_parcelas, valor, vencimento,
//                 nome_cliente, status, paid_at, situacao
//
// ⚠️  FILTRO DE EMPRESA: a view não possui id_empresa nem campo de empresa.
//     O único vínculo existente é: vw_boletos_controle.id_int → propostas.id_int → propostas.empresa
//     Para aplicar o filtro seria necessário:
//       1. Buscar todos os id_int de propostas.empresa = X (poderia ser milhares de registros)
//       2. Filtrar a view pelo array de id_int retornado
//     Isso não é seguro por volume e não existe RPC ou join nativo disponível.
//     DECISÃO: o card exibe o total consolidado (todas as empresas).
//     O argumento companyId é recebido mas ignorado até que haja id_empresa na view ou RPC dedicada.

async function fetchContasReceber(
  // companyId recebido para compatibilidade de assinatura, mas não aplicado — ver comentário acima.
  _companyId: number
): Promise<{ valor: number; quantidade: number }> {
  const client = getSupabaseClient();
  if (!client) return { valor: 0, quantidade: 0 };

  // Selecionar apenas os campos necessários para o cálculo
  const { data, error } = await client
    .from("vw_boletos_controle")
    .select("valor, situacao")
    .in("situacao", ["AVENCER", "VENCIDO"])
    .limit(20000);

  if (error || !Array.isArray(data)) {
    console.warn("[Dashboard] Erro ao buscar contas a receber (vw_boletos_controle):", error?.message);
    return { valor: 0, quantidade: 0 };
  }

  const valor = data.reduce((acc, row) => acc + toNumber(row.valor), 0);
  return { valor, quantidade: data.length };
}

// ─── 3. Propostas aguardando — public.propostas ───────────────────────────────
//
// Contagem de propostas no grupo "aguardando" da fase comercial.
// Status: AGUARDANDO | AGUARDANDO / EM ARTE | AGUARDANDO / PENDENTE
// Excluir reprovadas: is_reproved = false
// propostas não tem id_empresa → filtro de empresa no JS via campo texto `empresa`.

async function fetchPropostasAguardando(companyId: number): Promise<{ quantidade: number }> {
  const client = getSupabaseClient();
  if (!client) return { quantidade: 0 };

  const { data, error } = await client
    .from("propostas")
    .select("empresa")
    .in("status_interno", AGUARDANDO_STATUSES)
    .eq("is_reproved", false)
    .limit(5000);

  if (error || !Array.isArray(data)) {
    console.warn("[Dashboard] Erro ao buscar propostas aguardando:", error?.message);
    return { quantidade: 0 };
  }

  const quantidade =
    companyId === 0
      ? data.length
      : data.filter((row) => empresaTextMatchesCompany(row.empresa, companyId)).length;

  return { quantidade };
}

// ─── 4. Notas a liberar — PLACEHOLDER ────────────────────────────────────────
//
// TODO: integrar com public.notas_fiscais e public.notas_servico.
//       A integração real será implementada em fase posterior.
//       Não consulta nenhuma tabela fiscal nesta etapa.
//       Retorna valor fixo sem dados fictícios (zero, não um número inventado).

function getNotasLiberarPlaceholder(): { quantidade: number } {
  return { quantidade: 0 };
}

// ─── 5. OS em produção — public.propostas ────────────────────────────────────
//
// Status: 'EM PRODUCAO' — grafia exata confirmada em:
//   - src/features/orcamentos/types.ts
//   - src/lib/constants/proposta-status.ts
//   - src/features/maestro/core/knowledge/business-rules.ts
// Sem acento, sem cedilha, tudo maiúsculo, espaço simples.
// propostas não tem id_empresa → filtro de empresa no JS via campo texto `empresa`.

async function fetchEmProducao(companyId: number): Promise<{ quantidade: number }> {
  const client = getSupabaseClient();
  if (!client) return { quantidade: 0 };

  const { data, error } = await client
    .from("propostas")
    .select("empresa")
    .eq("status_interno", "EM PRODUCAO")
    .limit(5000);

  if (error || !Array.isArray(data)) {
    console.warn("[Dashboard] Erro ao buscar OS em produção:", error?.message);
    return { quantidade: 0 };
  }

  const quantidade =
    companyId === 0
      ? data.length
      : data.filter((row) => empresaTextMatchesCompany(row.empresa, companyId)).length;

  return { quantidade };
}

// ─── Agregador principal ──────────────────────────────────────────────────────

export async function getDashboardMetrics(companyId: number): Promise<DashboardMetricsResult> {
  // Verificação de conexão Supabase (pagamentos_v2 usa fetch direto, mas propostas usa client)
  const client = getSupabaseClient();
  const supabaseDisponivel = Boolean(client);

  if (!supabaseDisponivel) {
    // A view_pagamentos_pagos_v2 usa fetch direto (não precisa de client), mas propostas sim
    // Tentamos as consultas de view mesmo sem client para propostas
  }

  try {
    // Todas as consultas independentes em paralelo
    const [vendas, contasReceber, propostasAguardando, emProducao] = await Promise.all([
      fetchVendasMes(companyId).catch((err) => {
        console.error("[Dashboard] fetchVendasMes falhou:", err);
        return { valor: 0, quantidade: 0 };
      }),
      fetchContasReceber(companyId).catch((err) => {
        console.error("[Dashboard] fetchContasReceber falhou:", err);
        return { valor: 0, quantidade: 0 };
      }),
      fetchPropostasAguardando(companyId).catch((err) => {
        console.error("[Dashboard] fetchPropostasAguardando falhou:", err);
        return { quantidade: 0 };
      }),
      fetchEmProducao(companyId).catch((err) => {
        console.error("[Dashboard] fetchEmProducao falhou:", err);
        return { quantidade: 0 };
      }),
    ]);

    const notasLiberar = getNotasLiberarPlaceholder();

    const cards: DashboardCardData[] = [
      {
        key: "vendasMes",
        title: "Vendas do mês",
        value: formatCurrency(vendas.valor),
        description: `${vendas.quantidade} pagamento(s) confirmado(s) no mês`,
        tone: "success",
        isLoading: false,
      },
      {
        key: "contasReceber",
        title: "Contas a receber",
        value: formatCurrency(contasReceber.valor),
        // A vw_boletos_controle não tem id_empresa: exibe total consolidado independente do seletor.
        description: `${contasReceber.quantidade} título(s) em aberto · total consolidado`,
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
        key: "notasLiberar",
        title: "Notas a liberar",
        // TODO: substituir por dados reais de notas_fiscais + notas_servico
        value: "—",
        description: "Integração fiscal em preparação",
        trend: "Em breve",
        tone: "neutral",
        isLoading: false,
        isPlaceholder: true,
      },
      {
        key: "emProducao",
        title: "OS em produção",
        value: String(emProducao.quantidade),
        description: "Pedidos com status EM PRODUCAO",
        tone: "special",
        isLoading: false,
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

/** Cards exibidos quando o banco está indisponível — sem números fictícios. */
function buildFallbackCards(): DashboardCardData[] {
  const defs: Array<{ key: DashboardCardKey; title: string; tone: DashboardCardData["tone"] }> = [
    { key: "vendasMes", title: "Vendas do mês", tone: "success" },
    { key: "contasReceber", title: "Contas a receber", tone: "info" },
    { key: "propostasAguardando", title: "Propostas aguardando", tone: "warning" },
    { key: "notasLiberar", title: "Notas a liberar", tone: "neutral" },
    { key: "emProducao", title: "OS em produção", tone: "special" },
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
