/**
 * maestro-simple-pagamentos.server.ts
 *
 * Adapter server-side read-only para consultas de faturamento/recebimento real.
 * Fase 2 — Inteligência Comercial e Financeira por id_cliente.
 *
 * REGRA FUNDAMENTAL DE RECEBIMENTO:
 *   confirmado = true
 *   status = 'PAID'
 *   paid_at is not null
 *
 * Fonte: public.pagamentos_v2
 * Modo: somente leitura — nunca INSERT, UPDATE, DELETE ou UPSERT.
 *
 * ⚠️  Roda exclusivamente no servidor (via API route) — preserva RLS com auth.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MaestroPeriodo } from './maestro-simple-intents';

// Colunas seguras — sem dados sensíveis de token, url ou pix
const PAGAMENTOS_COLS = 'id_int, status, valor, paid_at, criado_em:created_at';

// ─── Tipos Exportados ──────────────────────────────────────────────────────

export interface RecebimentoSimples {
  id_int: number | null;
  status: string | null;
  valor: number | null;
  paid_at: string;
}

export interface RecebimentosResult {
  found: boolean;
  items: RecebimentoSimples[];
  count: number;
  totalValor?: number;
  periodo?: string;
  source: string;
  authError?: boolean;
  error?: string;
}

// ─── Helpers Internos ─────────────────────────────────────────────────────

function mapPagamento(row: Record<string, unknown>): RecebimentoSimples {
  return {
    id_int:         row.id_int != null ? Number(row.id_int) : null,
    status:         typeof row.status === 'string' ? row.status : null,
    valor:          row.valor != null ? Number(row.valor) : null,
    paid_at:        String(row.paid_at),
  };
}

function isAuthError(err: unknown): boolean {
  const e = err as Record<string, unknown>;
  const msg = String(e?.message ?? '').toLowerCase();
  return e?.code === 'PGRST301' || e?.code === '42501' || msg.includes('jwt') || msg.includes('permission');
}

// ─── Helpers de Data (UTC para consistência com Supabase) ─────────────────

function primeiroDiaMesAtual(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString();
}

function menosNDias(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

function primeiroDiaMesPassado(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1)).toISOString();
}

// ─── FATURAMENTO OFICIAL (regra de negócio, 2026-07-26) ───────────────────
// Faturamento, vendas, comissão e metas vêm de public.pagamentos_v2:
//   confirmado = true AND status IN ('PAID','A_VENCER'), período por
//   data_confirmacao; soma por id_int; propostas = count distinct id_int.
// public.propostas é usada APENAS como dimensão (vendedor, cliente).
// ⚠️ NUNCA usar propostas.created_at/status_interno/valor_total como fonte
//    de faturamento mensal.
// Validado em 26/07/2026: André Toniazzo julho/2026 = 256 propostas,
// R$ 177.803,45 (gabarito do negócio).

export interface FaturamentoVendedorAgregado {
  vendedor: string;
  propostas: number;
  faturamento: number;
}

export interface FaturamentoEmpresaAgregado {
  /** null = pagamentos SEM id_empresa (sinalizados, nunca descartados) */
  id_empresa: number | null;
  empresa: string | null;
  propostas: number;
  faturamento: number;
  vendedores: FaturamentoVendedorAgregado[];
}

export interface FaturamentoOficialResult {
  found: boolean;
  periodo: string;
  criterio: string;
  /** Propostas distintas com pagamento confirmado no período */
  total_propostas: number;
  /** Soma dos pagamentos confirmados (PAID/A_VENCER) no período */
  faturamento: number;
  /** Ranking — presente apenas quando agruparPorVendedor=true */
  por_vendedor?: FaturamentoVendedorAgregado[];
  /** Subtotais por empresa (id_empresa de pagamentos_v2) com vendedores dentro — quando agruparPorEmpresa=true */
  por_empresa?: FaturamentoEmpresaAgregado[];
  /** Contagens por empresa podem se sobrepor (proposta paga em 2 empresas) */
  nota_contagem?: string;
  /** Filtro de vendedor ambíguo (mais de um nome correspondente) */
  aviso?: string;
  truncado: boolean;
  source: string;
  authError?: boolean;
  error?: string;
}

const FATURAMENTO_MAX_ROWS = 5000;
const FATURAMENTO_LOTE_PROPOSTAS = 400;

export const CRITERIO_FATURAMENTO_OFICIAL =
  'pagamentos_v2 com confirmado=true e status PAID ou A_VENCER, período por data_confirmacao; ' +
  'faturamento = soma dos pagamentos; propostas = id_int distintos. propostas é só dimensão (vendedor/cliente).';

export async function calcularFaturamentoOficial(
  supabase: SupabaseClient,
  opts: {
    desde: string;
    ate?: string;
    periodoLabel: string;
    idCliente?: number;
    /** Filtra um vendedor pelo nome (via propostas — match parcial, case-insensitive) */
    vendedorNome?: string;
    /** Devolve o ranking por vendedor */
    agruparPorVendedor?: boolean;
    /** Filtra uma empresa (pagamentos_v2.id_empresa — NUNCA a empresa do cadastro do cliente) */
    idEmpresa?: number;
    /** Subtotais por empresa com vendedores dentro de cada uma */
    agruparPorEmpresa?: boolean;
  },
): Promise<FaturamentoOficialResult> {
  const base = {
    periodo: opts.periodoLabel,
    criterio: CRITERIO_FATURAMENTO_OFICIAL,
    source: 'public.pagamentos_v2 (fonte; empresa = id_empresa) + public.propostas (dimensão vendedor)',
  };

  let query = supabase
    .from('pagamentos_v2')
    .select('id_int, id_cliente, valor, data_confirmacao, id_empresa, empresa')
    .eq('confirmado', true)
    .in('status', ['PAID', 'A_VENCER'])
    .not('id_int', 'is', null)
    .not('data_confirmacao', 'is', null)
    .gte('data_confirmacao', opts.desde);
  if (opts.ate) query = query.lt('data_confirmacao', opts.ate);
  if (opts.idCliente != null) query = query.eq('id_cliente', opts.idCliente);
  if (opts.idEmpresa != null) query = query.eq('id_empresa', opts.idEmpresa);

  const { data, error } = await query
    .order('data_confirmacao', { ascending: false })
    .limit(FATURAMENTO_MAX_ROWS);

  if (error) {
    return { ...base, found: false, total_propostas: 0, faturamento: 0, truncado: false, authError: isAuthError(error), error: error.message };
  }

  const pagamentos = (data ?? []).map(raw => {
    const r = raw as Record<string, unknown>;
    return {
      id_int: Number(r.id_int),
      valor: r.valor != null ? Number(r.valor) : 0,
      id_empresa: r.id_empresa != null && Number.isFinite(Number(r.id_empresa)) ? Number(r.id_empresa) : null,
      empresaLabel: typeof r.empresa === 'string' && r.empresa.trim() ? r.empresa.trim() : null,
    };
  });

  // Dimensão vendedor (propostas), somente quando necessária
  // (na separação por empresa os vendedores aparecem dentro de cada empresa)
  const precisaVendedor =
    Boolean(opts.vendedorNome) || opts.agruparPorVendedor === true || opts.agruparPorEmpresa === true;
  const vendedorPorProposta = new Map<number, string>();
  if (precisaVendedor && pagamentos.length > 0) {
    const ids = [...new Set(pagamentos.map(p => p.id_int))];
    for (let i = 0; i < ids.length; i += FATURAMENTO_LOTE_PROPOSTAS) {
      const lote = ids.slice(i, i + FATURAMENTO_LOTE_PROPOSTAS);
      const { data: props, error: perr } = await supabase
        .from('propostas')
        .select('id_int, vendedor')
        .in('id_int', lote);
      if (perr) {
        return { ...base, found: false, total_propostas: 0, faturamento: 0, truncado: false, authError: isAuthError(perr), error: perr.message };
      }
      for (const raw of props ?? []) {
        const r = raw as Record<string, unknown>;
        const nome = typeof r.vendedor === 'string' && r.vendedor.trim() ? r.vendedor.trim() : 'SEM_VENDEDOR';
        vendedorPorProposta.set(Number(r.id_int), nome);
      }
    }
  }

  // Match de nome sem acento; preferência por igualdade exata ("Andre" não
  // pode agregar Alexandre junto com André silenciosamente)
  const normalizar = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filtroNome = opts.vendedorNome?.trim() ? normalizar(opts.vendedorNome) : undefined;
  let vendedoresFiltrados: Set<string> | null = null;
  if (filtroNome) {
    const nomes = [...new Set(vendedorPorProposta.values())];
    const exatos = nomes.filter(n => normalizar(n) === filtroNome);
    const parciais = nomes.filter(n => normalizar(n).includes(filtroNome));
    vendedoresFiltrados = new Set(exatos.length > 0 ? exatos : parciais);
  }
  // Filtro ambíguo (mais de um vendedor) → devolve separado por vendedor,
  // nunca uma soma mesclada sem aviso
  const agrupar = opts.agruparPorVendedor === true || (vendedoresFiltrados?.size ?? 0) > 1;

  const propostasDistintas = new Set<number>();
  let faturamentoTotal = 0;
  const porVendedor = new Map<string, { vendedor: string; propostasSet: Set<number>; faturamento: number }>();
  interface EmpresaAgg {
    id_empresa: number | null;
    empresa: string | null;
    propostasSet: Set<number>;
    faturamento: number;
    vendedores: Map<string, { propostasSet: Set<number>; faturamento: number }>;
  }
  const porEmpresa = new Map<string, EmpresaAgg>();

  for (const pg of pagamentos) {
    const vendedor = precisaVendedor ? (vendedorPorProposta.get(pg.id_int) ?? 'SEM_VENDEDOR') : null;
    if (vendedoresFiltrados && !vendedoresFiltrados.has(vendedor ?? '')) continue;

    propostasDistintas.add(pg.id_int);
    faturamentoTotal += pg.valor;

    if (agrupar && vendedor !== null) {
      const agg = porVendedor.get(vendedor) ?? { vendedor, propostasSet: new Set<number>(), faturamento: 0 };
      agg.propostasSet.add(pg.id_int);
      agg.faturamento = Number((agg.faturamento + pg.valor).toFixed(2));
      porVendedor.set(vendedor, agg);
    }

    if (opts.agruparPorEmpresa === true) {
      // Pagamentos SEM id_empresa entram no grupo próprio — nunca descartados
      const chave = pg.id_empresa != null ? `emp:${pg.id_empresa}` : 'emp:sem';
      const emp = porEmpresa.get(chave) ?? {
        id_empresa: pg.id_empresa,
        empresa: pg.id_empresa != null ? pg.empresaLabel : 'SEM id_empresa (pagamentos sem empresa atribuída)',
        propostasSet: new Set<number>(),
        faturamento: 0,
        vendedores: new Map(),
      };
      if (!emp.empresa && pg.empresaLabel) emp.empresa = pg.empresaLabel;
      emp.propostasSet.add(pg.id_int);
      emp.faturamento = Number((emp.faturamento + pg.valor).toFixed(2));
      if (vendedor !== null) {
        const ve = emp.vendedores.get(vendedor) ?? { propostasSet: new Set<number>(), faturamento: 0 };
        ve.propostasSet.add(pg.id_int);
        ve.faturamento = Number((ve.faturamento + pg.valor).toFixed(2));
        emp.vendedores.set(vendedor, ve);
      }
      porEmpresa.set(chave, emp);
    }
  }

  const empresas: FaturamentoEmpresaAgregado[] | undefined = opts.agruparPorEmpresa
    ? [...porEmpresa.values()]
        .map(e => ({
          id_empresa: e.id_empresa,
          empresa: e.empresa,
          propostas: e.propostasSet.size,
          faturamento: e.faturamento,
          vendedores: [...e.vendedores.entries()]
            .map(([vendedor, v]) => ({ vendedor, propostas: v.propostasSet.size, faturamento: v.faturamento }))
            .sort((a, b) => b.faturamento - a.faturamento),
        }))
        // sem-empresa por último; demais por faturamento desc
        .sort((a, b) => (a.id_empresa === null ? 1 : b.id_empresa === null ? -1 : b.faturamento - a.faturamento))
    : undefined;

  // Uma proposta com pagamentos em mais de uma empresa conta em cada grupo,
  // mas uma única vez no consolidado — sinalize quando as contagens divergirem
  const somaPropostasEmpresas = empresas?.reduce((acc, e) => acc + e.propostas, 0);

  return {
    ...base,
    found: propostasDistintas.size > 0,
    total_propostas: propostasDistintas.size,
    faturamento: Number(faturamentoTotal.toFixed(2)),
    por_vendedor: agrupar
      ? [...porVendedor.values()]
          .map(v => ({ vendedor: v.vendedor, propostas: v.propostasSet.size, faturamento: v.faturamento }))
          .sort((a, b) => b.faturamento - a.faturamento)
      : undefined,
    por_empresa: empresas,
    ...(empresas && somaPropostasEmpresas !== propostasDistintas.size
      ? { nota_contagem: 'Proposta com pagamentos em mais de uma empresa conta em cada empresa, mas UMA única vez no total consolidado — por isso a soma das contagens difere do total.' }
      : {}),
    ...((vendedoresFiltrados?.size ?? 0) > 1
      ? { aviso: 'O nome informado corresponde a mais de um vendedor — números apresentados SEPARADOS por vendedor; o total soma todos os correspondentes.' }
      : {}),
    truncado: pagamentos.length >= FATURAMENTO_MAX_ROWS,
  };
}

// ─── Perfil de pagamento (comportamento real) ─────────────────────────────

export interface PerfilPagamentoResult {
  found: boolean;
  /** Agregado por tipo_cobranca (PIX, BOLETO, CREDIT_CARD, CARD_PARCELADO...) */
  por_tipo_cobranca: Record<string, { quantidade: number; somaValor: number; ultimo_em: string | null }>;
  /** Condições a prazo registradas em forma_pgto (ex.: "Prazo 14 dias") */
  condicoes_prazo: Record<string, number>;
  total_pagamentos: number;
  totalValor: number;
  periodo: string;
  truncado: boolean;
  source: string;
  authError?: boolean;
  error?: string;
}

const PERFIL_MAX_ROWS = 1000;

/**
 * Como o cliente REALMENTE paga: agrega os pagamentos confirmados (PAID,
 * confirmado=true, por paid_at) por tipo_cobranca. Servidor agrega — o
 * consumidor nunca conta nem soma.
 */
export async function calcularPerfilPagamento(
  supabase: SupabaseClient,
  idCliente: number,
  dias = 365,
): Promise<PerfilPagamentoResult> {
  const diasSeguro = Number.isFinite(dias) && dias > 0 && dias <= 1830 ? Math.floor(dias) : 365;
  const periodo = `últimos ${diasSeguro} dias`;

  const { data, error } = await supabase
    .from('pagamentos_v2')
    .select('tipo_cobranca, forma_pgto, valor, paid_at')
    .eq('id_cliente', idCliente)
    .eq('confirmado', true)
    .eq('status', 'PAID')
    .not('paid_at', 'is', null)
    .gte('paid_at', menosNDias(diasSeguro))
    .order('paid_at', { ascending: false })
    .limit(PERFIL_MAX_ROWS);

  if (error) {
    return {
      found: false, por_tipo_cobranca: {}, condicoes_prazo: {}, total_pagamentos: 0,
      totalValor: 0, periodo, truncado: false, source: 'public.pagamentos_v2',
      authError: isAuthError(error), error: error.message,
    };
  }

  const porTipo: PerfilPagamentoResult['por_tipo_cobranca'] = {};
  const condicoesPrazo: Record<string, number> = {};
  let totalValor = 0;

  for (const raw of data ?? []) {
    const r = raw as Record<string, unknown>;
    const tipo = typeof r.tipo_cobranca === 'string' && r.tipo_cobranca.trim() ? r.tipo_cobranca.trim() : 'NAO_INFORMADO';
    const valor = r.valor != null ? Number(r.valor) : 0;
    const paidAt = typeof r.paid_at === 'string' ? r.paid_at : null;

    const agg = porTipo[tipo] ?? { quantidade: 0, somaValor: 0, ultimo_em: null };
    agg.quantidade++;
    agg.somaValor = Number((agg.somaValor + valor).toFixed(2));
    if (paidAt && (!agg.ultimo_em || paidAt > agg.ultimo_em)) agg.ultimo_em = paidAt;
    porTipo[tipo] = agg;
    totalValor += valor;

    const forma = typeof r.forma_pgto === 'string' ? r.forma_pgto.trim() : '';
    if (forma) condicoesPrazo[forma] = (condicoesPrazo[forma] ?? 0) + 1;
  }

  const total = (data ?? []).length;
  return {
    found: total > 0,
    por_tipo_cobranca: porTipo,
    condicoes_prazo: condicoesPrazo,
    total_pagamentos: total,
    totalValor: Number(totalValor.toFixed(2)),
    periodo,
    truncado: total >= PERFIL_MAX_ROWS,
    source: 'public.pagamentos_v2',
  };
}

// ─── Consultas Read-Only ──────────────────────────────────────────────────

/**
 * Calcula faturamento financeiro recebido do cliente em um período.
 * Usa paid_at como referência de data, confirmado = true e status = 'PAID'.
 */
export async function calcularRecebimentoPeriodo(
  supabase: SupabaseClient,
  idCliente: number,
  periodo: MaestroPeriodo,
): Promise<RecebimentosResult> {
  let desde: string;
  let ate: string | null = null;
  const periodoLabel: string = periodo.label;

  if (periodo.tipo === 'dinamico' && periodo.start) {
    desde = periodo.start;
    if (periodo.end) ate = periodo.end;
  } else {
    switch (periodo.tipo) {
      case 'mes_atual':
        desde = primeiroDiaMesAtual();
        break;
      case 'mes_passado':
        desde = primeiroDiaMesPassado();
        ate   = primeiroDiaMesAtual();
        break;
      case 'ultimos_30_dias':
      default:
        desde = menosNDias(30);
    }
  }

  let query = supabase
    .from('pagamentos_v2')
    .select(PAGAMENTOS_COLS)
    .eq('id_cliente', idCliente)
    .eq('confirmado', true)
    .eq('status', 'PAID')
    .not('paid_at', 'is', null)
    .gte('paid_at', desde);

  if (ate) {
    query = query.lt('paid_at', ate);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[calcularRecebimentoPeriodo] Erro:', error);
    return {
      found: false,
      items: [],
      count: 0,
      periodo: periodoLabel,
      source: 'public.pagamentos_v2',
      authError: isAuthError(error),
      error: error.message,
    };
  }

  if (!data || data.length === 0) {
    return {
      found: false,
      items: [],
      count: 0,
      totalValor: 0,
      periodo: periodoLabel,
      source: 'public.pagamentos_v2',
    };
  }

  const items = data.map(mapPagamento);
  const totalValor = items.reduce((sum, item) => sum + (item.valor ?? 0), 0);

  return {
    found: true,
    items,
    count: items.length,
    totalValor,
    periodo: periodoLabel,
    source: 'public.pagamentos_v2',
  };
}

export interface ComparacaoItem {
  label: string;
  startDate: string;
  endDate: string;
  count: number;
  totalValor: number;
}

export interface ComparacaoRecebimentosResult {
  found: boolean;
  idCliente: number;
  items: ComparacaoItem[];
  source: string;
  error?: string;
}

/**
 * Compara recebimentos financeiros do cliente em múltiplos meses/períodos.
 * Executa em paralelo as consultas para cada período.
 */
export async function compararRecebimentoClienteMeses(
  supabase: SupabaseClient,
  idCliente: number,
  meses: Array<{ startDate: string; endDate: string; label: string }>,
): Promise<ComparacaoRecebimentosResult> {
  try {
    const promises = meses.map(async (m) => {
      const res = await calcularRecebimentoPeriodo(supabase, idCliente, {
        tipo: 'dinamico',
        start: m.startDate,
        end: m.endDate,
        label: m.label,
      });
      return {
        label: m.label,
        startDate: m.startDate,
        endDate: m.endDate,
        count: res.count,
        totalValor: res.totalValor ?? 0,
      };
    });

    const items = await Promise.all(promises);
    return {
      found: true,
      idCliente,
      items,
      source: 'public.pagamentos_v2',
    };
  } catch (err) {
    console.error('[compararRecebimentoClienteMeses] Erro:', err);
    return {
      found: false,
      idCliente,
      items: [],
      source: 'public.pagamentos_v2',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

