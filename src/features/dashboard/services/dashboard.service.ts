/**
 * dashboard.service.ts
 *
 * Camada de acesso a dados do Dashboard — somente leitura (SELECT).
 * Nenhuma escrita, migration ou alteração de schema, views, triggers, RPCs ou Edge Functions.
 *
 * ─── Fontes oficiais por card (Fase 0 — indicadores reais corrigidos) ────────
 *
 *  1. Vendas do mês (Faturamento confirmado) → view_pagamentos_pagos_v2
 *       Regra oficial: status IN ('PAID','A_VENCER') AND confirmado = true
 *       (a própria view já aplica esse filtro — ver view-pagamentos-pagos.service.ts).
 *       Reutiliza o service oficial fetchViewPagamentosPagos + calcFaturamentoPeriodo/
 *       calcFaturamentoPorEmpresa. NÃO reimplementa a soma aqui.
 *
 *  2. Propostas aguardando → public.propostas
 *       status_interno IN ('AGUARDANDO','AGUARDANDO / EM ARTE','AGUARDANDO / PENDENTE').
 *       NOVO / NOVO EM ARTE ficam de fora deliberadamente (ainda não submetidas).
 *       Proposta com pagamento parcial permanece AGUARDANDO por decisão do motor
 *       oficial de status (status-engine.service.ts) — aqui apenas contamos o
 *       status_interno já reconciliado, sem reinterpretar cobertura financeira.
 *       is_reproved = false. Filtro de empresa via campo texto `empresa`.
 *
 *  3. OS em produção → reutiliza listarPedidosOperacionais() (Produção)
 *       Fonte oficial já exige is_prd_aprovado = true E status operacional
 *       (LIBERADO, REVISAO ATENDENTE/PRODUCAO, EM PRODUCAO/IMPRESSAO/ACABAMENTO).
 *       Mesma lista exibida na tela /producao. Filtro de empresa via texto.
 *
 *  4. Contas a receber → reutiliza getContasReceberReadOnlyData() (public.boletos)
 *       Fonte oficial de Contas a Receber. NUNCA mistura com pagamentos_v2.
 *       "Em aberto a receber" = status A_VENCER (previsão futura) + VENCIDO
 *       (overdue), somando valor_atualizado ?? valor — exatamente os buckets do
 *       resumo da tela oficial (A_RECEBER é deliberadamente excluído da carteira,
 *       PAID/CANCELADO não entram). Filtro de empresa por id_empresa nativo.
 *
 *  5. Notas a liberar → PLACEHOLDER EXPLÍCITO (Fiscal fora do escopo da Fase 0).
 *
 * ─── Erro de consulta ≠ resultado zero ──────────────────────────────────────
 *  Cada fetch devolve um flag `error`. Quando uma consulta falha, o card mostra
 *  "—" com tom danger e aviso de erro — distinto de um zero real (R$ 0,00 / 0).
 *
 * ─── Regra de empresa em `propostas` (cards 2 e 3) ──────────────────────────
 *  A tabela `propostas` NÃO possui `id_empresa`. O campo `empresa` é texto.
 *  O filtro é aplicado no JavaScript após a busca, usando exclusão explícita.
 *  (boletos possui id_empresa nativo, usado diretamente no card 4.)
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  fetchViewPagamentosPagos,
  calcFaturamentoPeriodo,
  calcFaturamentoPorEmpresa,
} from "@/features/cobrancas/services/view-pagamentos-pagos.service";
import { listarPedidosOperacionais } from "@/features/pedidos/services/pedidos-producao.service";
import { getContasReceberReadOnlyData } from "@/features/contas-a-receber/services/contas-receber.service";

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
  /** true quando a consulta falhou (distinto de um zero legítimo). */
  isError?: boolean;
};

export type DashboardMetricsResult = {
  cards: DashboardCardData[];
  source: "supabase" | "fallback";
  errorMessage?: string;
};

// Resultado interno de cada fetch, separando erro de zero legítimo.
type ValorQtdResult = { valor: number; quantidade: number; error: boolean };
type QtdResult = { quantidade: number; error: boolean };

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

// Status que compõem o card "Propostas aguardando".
// Decisão explícita: NÃO inclui NOVO / NOVO EM ARTE (propostas ainda não
// submetidas para aprovação/financeiro), apenas os estados de espera efetiva.
const AGUARDANDO_STATUSES = [
  "AGUARDANDO",
  "AGUARDANDO / EM ARTE",
  "AGUARDANDO / PENDENTE",
] as const;

// ─── 1. Vendas do mês (Faturamento confirmado) — view_pagamentos_pagos_v2 ─────
//
// A view já entrega apenas linhas confirmadas conforme a regra oficial
// (status IN ('PAID','A_VENCER') AND confirmado = true). Portanto NÃO filtramos
// mais por "status === 'PAID'" (isso descartava indevidamente os A_VENCER já
// confirmados e subestimava o faturamento). Usamos os agregadores oficiais.

async function fetchVendasMes(companyId: number): Promise<ValorQtdResult> {
  const { inicio, fim } = getCurrentMonthRangeSP();

  const result = await fetchViewPagamentosPagos(inicio, fim);

  if (result.error) {
    console.warn("[Dashboard] Erro ao buscar vendas do mês:", result.error);
    return { valor: 0, quantidade: 0, error: true };
  }

  // companyId = 0 (Todas): soma do período inteiro.
  if (companyId === 0) {
    const { total, count } = calcFaturamentoPeriodo(result.rows, inicio, fim);
    return { valor: total, quantidade: count, error: false };
  }

  // Empresa específica: reutiliza o agregador oficial por empresa.
  const porEmpresa = calcFaturamentoPorEmpresa(result.rows, inicio, fim);
  const alvo = porEmpresa.find((e) => e.id_empresa === companyId);
  return {
    valor: alvo?.total ?? 0,
    quantidade: alvo?.quantidade ?? 0,
    error: false,
  };
}

// ─── 2. Propostas aguardando — public.propostas ───────────────────────────────
//
// Sem truncamento silencioso:
//   companyId = 0 (Todas) → count exato via head:true (não trafega linhas).
//   companyId ≠ 0        → pagina apenas a coluna `empresa` (texto leve) e filtra
//                          no JS, sem .limit fixo — nada é descartado em silêncio.

const PAGE_SIZE_PROPOSTAS = 1000;

async function fetchPropostasAguardando(companyId: number): Promise<QtdResult> {
  const client = getSupabaseClient();
  if (!client) return { quantidade: 0, error: true };

  // Caminho A: Todas — count exato, sem trazer linhas.
  if (companyId === 0) {
    const { count, error } = await client
      .from("propostas")
      .select("*", { count: "exact", head: true })
      .in("status_interno", AGUARDANDO_STATUSES)
      .eq("is_reproved", false);

    if (error) {
      console.warn("[Dashboard] Erro ao contar propostas aguardando:", error.message);
      return { quantidade: 0, error: true };
    }
    return { quantidade: count ?? 0, error: false };
  }

  // Caminho B: empresa específica — pagina a coluna `empresa` e filtra no JS.
  let quantidade = 0;
  let page = 0;

  while (true) {
    const from = page * PAGE_SIZE_PROPOSTAS;
    const to = from + PAGE_SIZE_PROPOSTAS - 1;

    const { data, error } = await client
      .from("propostas")
      .select("empresa")
      .in("status_interno", AGUARDANDO_STATUSES)
      .eq("is_reproved", false)
      .range(from, to);

    if (error) {
      console.warn("[Dashboard] Erro ao paginar propostas aguardando:", error.message);
      return { quantidade: 0, error: true };
    }

    if (!Array.isArray(data) || data.length === 0) break;

    quantidade += data.filter((row) => empresaTextMatchesCompany(row.empresa, companyId)).length;

    if (data.length < PAGE_SIZE_PROPOSTAS) break;
    page++;
  }

  return { quantidade, error: false };
}

// ─── 3. OS em produção — reutiliza o service oficial de Produção ──────────────
//
// listarPedidosOperacionais() já aplica a regra oficial:
//   is_prd_aprovado = true  E  status_interno operacional.
// É a mesma fonte da tela /producao, garantindo números idênticos.
// Limitação conhecida: o service engole erros internamente e devolve [] — logo,
// uma falha de consulta aparece como zero neste card (ver relatório da Fase 0).

async function fetchEmProducao(companyId: number): Promise<QtdResult> {
  try {
    const operacionais = await listarPedidosOperacionais();
    const quantidade =
      companyId === 0
        ? operacionais.length
        : operacionais.filter((p) => empresaTextMatchesCompany(p.empresa, companyId)).length;
    return { quantidade, error: false };
  } catch (err) {
    console.error("[Dashboard] Erro ao buscar OS em produção:", err);
    return { quantidade: 0, error: true };
  }
}

// ─── 4. Contas a receber — reutiliza o service oficial (public.boletos) ───────
//
// getContasReceberReadOnlyData() é a fonte oficial de Contas a Receber (boletos),
// nunca pagamentos_v2. Somamos os títulos ainda a receber = A_VENCER (previsão
// futura) + VENCIDO (overdue), usando valor_atualizado ?? valor — os mesmos
// buckets do resumo da tela /contas-a-receber. A_RECEBER é excluído pela própria
// fonte oficial; PAID/CANCELADO não são "a receber".
//
// Limitações registradas (sem criar RPC/view nesta tarefa):
//   - Não há agregação SUM no banco; somamos as linhas em JS.
//   - O service oficial carrega até 5000 boletos (mesmo teto da tela oficial);
//     acima disso o total fica limitado — mas idêntico ao da tela oficial.
//   - O service engole erros e devolve lista vazia, então uma falha de consulta
//     aparece como zero neste card (ver relatório da Fase 0).

async function fetchContasReceber(companyId: number): Promise<ValorQtdResult> {
  try {
    const { recebiveis } = await getContasReceberReadOnlyData();

    const emAberto = recebiveis.filter((item) => {
      const statusOk = item.status === "A_VENCER" || item.status === "VENCIDO";
      if (!statusOk) return false;
      if (companyId === 0) return true;
      return toNumber(item.id_empresa) === companyId;
    });

    const valor = emAberto.reduce(
      (acc, item) => acc + toNumber(item.valor_atualizado ?? item.valor),
      0
    );

    return { valor, quantidade: emAberto.length, error: false };
  } catch (err) {
    console.error("[Dashboard] Erro ao buscar contas a receber:", err);
    return { valor: 0, quantidade: 0, error: true };
  }
}

// ─── 5. Notas a liberar — PLACEHOLDER ────────────────────────────────────────
//
// TODO: integrar com public.notas_fiscais e public.notas_servico.
//       Fora do escopo da Fase 0 (falta fonte fiscal documentada).

// ─── Construtores de card (erro ≠ zero) ───────────────────────────────────────

function buildValorCard(
  key: DashboardCardKey,
  title: string,
  tone: DashboardCardData["tone"],
  descOk: string,
  res: ValorQtdResult
): DashboardCardData {
  if (res.error) {
    return {
      key,
      title,
      value: "—",
      description: "Não foi possível carregar (erro de consulta).",
      trend: "Erro ao consultar",
      tone: "danger",
      isLoading: false,
      isError: true,
    };
  }
  return {
    key,
    title,
    value: formatCurrency(res.valor),
    description: descOk,
    tone,
    isLoading: false,
  };
}

function buildQtdCard(
  key: DashboardCardKey,
  title: string,
  tone: DashboardCardData["tone"],
  descOk: string,
  res: QtdResult
): DashboardCardData {
  if (res.error) {
    return {
      key,
      title,
      value: "—",
      description: "Não foi possível carregar (erro de consulta).",
      trend: "Erro ao consultar",
      tone: "danger",
      isLoading: false,
      isError: true,
    };
  }
  return {
    key,
    title,
    value: String(res.quantidade),
    description: descOk,
    tone,
    isLoading: false,
  };
}

// ─── Agregador principal ──────────────────────────────────────────────────────

export async function getDashboardMetrics(companyId: number): Promise<DashboardMetricsResult> {
  try {
    // Todas as consultas independentes em paralelo. Cada fetch já trata o próprio
    // erro e devolve um flag — nunca lança para o Promise.all.
    const [vendas, contasReceber, propostasAguardando, emProducao] = await Promise.all([
      fetchVendasMes(companyId),
      fetchContasReceber(companyId),
      fetchPropostasAguardando(companyId),
      fetchEmProducao(companyId),
    ]);

    const cards: DashboardCardData[] = [
      buildValorCard(
        "vendasMes",
        "Vendas do mês",
        "success",
        `${vendas.quantidade} pagamento(s) confirmado(s) no mês`,
        vendas
      ),
      buildValorCard(
        "contasReceber",
        "Contas a receber",
        "info",
        companyId === 0
          ? `${contasReceber.quantidade} título(s) em aberto · todas as empresas`
          : `${contasReceber.quantidade} título(s) em aberto`,
        contasReceber
      ),
      buildQtdCard(
        "propostasAguardando",
        "Propostas aguardando",
        "warning",
        "Aguardando retorno ou aprovação",
        propostasAguardando
      ),
      {
        key: "notasLiberar",
        title: "Notas a liberar",
        // TODO: substituir por dados reais de notas_fiscais + notas_servico (fora da Fase 0)
        value: "—",
        description: "Integração fiscal em preparação",
        trend: "Em breve",
        tone: "neutral",
        isLoading: false,
        isPlaceholder: true,
      },
      buildQtdCard(
        "emProducao",
        "OS em produção",
        "special",
        "Pedidos aprovados na esteira de produção",
        emProducao
      ),
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
