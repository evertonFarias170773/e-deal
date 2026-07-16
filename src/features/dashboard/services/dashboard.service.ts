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
 *  2. Contas a receber    → public.vw_boletos_controle (Todas) / public.boletos (por empresa)
 *       Saldo em aberto = situacao IN ('AVENCER', 'VENCIDO') na view /
 *                         status IN ('A_VENCER', 'A_RECEBER') em boletos.
 *       PAGO não entra no total pendente.
 *
 *       Vínculo investigado:
 *         - vw_boletos_controle não possui id_empresa nem campo de empresa.
 *         - A view não tem DDL local; origem desconhecida no código.
 *         - Não existe FK PostgREST configurada entre a view e boletos.
 *         - A tabela boletos possui id_empresa (número) nativo e confirmado.
 *
 *       DECISÃO:
 *         companyId = 0 (Todas): paginação completa na view sem limite arbitrário.
 *         companyId ≠ 0 (empresa): consulta direta em boletos com id_empresa.
 *           status A_VENCER ≅ situacao AVENCER, status A_RECEBER ≅ situacao VENCIDO.
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

// ─── 2. Contas a receber — vw_boletos_controle (Todas) / boletos (por empresa) ─────────
//
// Estratégia de total sem truncamento:
//   companyId = 0 (Todas) → paginação completa em vw_boletos_controle.
//     Cada página tem PAGE_SIZE registros. Continua enquanto a página vier cheia.
//     Isso garante que um volume > 20.000 não produz total parcial silencioso.
//
//   companyId ≠ 0 (empresa) → consulta direta em public.boletos.
//     boletos.id_empresa é numérico e nativo — filtro direto e confiável.
//     status A_VENCER corresponde a situacao AVENCER na view.
//     status A_RECEBER corresponde a situacao VENCIDO na view.
//     PAGO (status PAID / confirmado) não entra em nenhum dos dois status.
//     A paginação também se aplica aqui para cobrir volumes altos por empresa.
//
// PostgREST embedding (vw_boletos_controle → boletos) NÃO está disponível:
//   Views não têm FK constraint; nenhum COMMENT ON VIEW de override foi encontrado.

const PAGE_SIZE_CONTAS = 1000;

async function fetchContasReceber(
  companyId: number
): Promise<{ valor: number; quantidade: number }> {
  const client = getSupabaseClient();
  if (!client) return { valor: 0, quantidade: 0 };

  // ─ Caminho A: companyId = 0 (Todas empresas) – paginação sobre vw_boletos_controle ──────────
  if (companyId === 0) {
    let totalValor = 0;
    let totalQtd = 0;
    let page = 0;

    while (true) {
      const from = page * PAGE_SIZE_CONTAS;
      const to = from + PAGE_SIZE_CONTAS - 1;

      const { data, error } = await client
        .from("vw_boletos_controle")
        .select("valor")
        .in("situacao", ["AVENCER", "VENCIDO"])
        .range(from, to);

      if (error) {
        console.warn("[Dashboard] Erro ao paginar vw_boletos_controle:", error.message);
        break;
      }

      if (!Array.isArray(data) || data.length === 0) break;

      for (const row of data) totalValor += toNumber(row.valor);
      totalQtd += data.length;

      // Se a página veio incompleta, chegamos ao fim
      if (data.length < PAGE_SIZE_CONTAS) break;
      page++;
    }

    return { valor: totalValor, quantidade: totalQtd };
  }

  // ─ Caminho B: empresa específica – paginação sobre public.boletos com id_empresa ──────────
  // boletos.id_empresa é um campo numérico nativo confirmado.
  // status A_VENCER ≡ situacao AVENCER (título futuro não pago).
  // status A_RECEBER ≡ situacao VENCIDO (título em cobrança, possivelmente vencido).
  // PAID/CANCELADO não entram em nenhum dos dois.
  {
    let totalValor = 0;
    let totalQtd = 0;
    let page = 0;

    while (true) {
      const from = page * PAGE_SIZE_CONTAS;
      const to = from + PAGE_SIZE_CONTAS - 1;

      const { data, error } = await client
        .from("boletos")
        .select("valor")
        .eq("id_empresa", companyId)
        .in("status", ["A_VENCER", "A_RECEBER"])
        .range(from, to);

      if (error) {
        console.warn("[Dashboard] Erro ao paginar boletos por empresa:", error.message);
        break;
      }

      if (!Array.isArray(data) || data.length === 0) break;

      for (const row of data) totalValor += toNumber(row.valor);
      totalQtd += data.length;

      if (data.length < PAGE_SIZE_CONTAS) break;
      page++;
    }

    return { valor: totalValor, quantidade: totalQtd };
  }
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
        // companyId = 0: view paginada (total consolidado). companyId != 0: boletos por id_empresa.
        description: companyId === 0
          ? `${contasReceber.quantidade} título(s) em aberto · todas as empresas`
          : `${contasReceber.quantidade} título(s) em aberto`,
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
