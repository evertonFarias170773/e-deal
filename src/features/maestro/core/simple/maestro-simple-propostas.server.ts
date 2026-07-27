/**
 * maestro-simple-propostas.server.ts
 *
 * Adapter server-side read-only para consultas de propostas/pedidos.
 * Fase 2 — Inteligência Comercial por id_cliente.
 *
 * REGRA FUNDAMENTAL DE PEDIDO REAL:
 *   is_prd_aprovado = true  AND  is_reproved = false
 *   ⚠️  status_interno = 'APROVADO' NÃO equivale a pedido real.
 *       Existem registros com status APROVADO e is_prd_aprovado = false.
 *
 * Fonte: public.propostas
 * Modo: somente leitura — nunca INSERT, UPDATE, DELETE ou UPSERT.
 *
 * ⚠️  Roda exclusivamente no servidor (via API route) — preserva RLS com auth.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MaestroPeriodo } from './maestro-simple-intents';

// Colunas seguras — sem dados sensíveis de proposta
const PROPOSTAS_COLS = 'id_int, status_interno, valor_total, valor, created_at, vendedor, is_prd_aprovado, is_reproved, is_avulso';

// ─── Tipos Exportados ──────────────────────────────────────────────────────

export interface PedidoSimples {
  id_int: number;
  status_interno: string | null;
  /** valor_total ?? valor — null somente se ambos ausentes */
  valor: number | null;
  created_at: string;
  vendedor: string | null;
  /** Entrada oficial na fila de Produção (FLUXO-OFICIAL-STATUS-PROPOSTAS §1.3) */
  is_prd_aprovado?: boolean;
  is_reproved?: boolean;
  /** Proposta avulsa (valor direto, sem itens detalhados em produtos_proposta) */
  is_avulso?: boolean;
}

export interface PropostasResult {
  found: boolean;
  items: PedidoSimples[];
  count: number;
  /** Soma dos valores (para faturamento) — somente quando calculado */
  totalValor?: number;
  /** Descrição textual do período consultado */
  periodo?: string;
  /** Fonte da consulta — sempre 'public.propostas' */
  source: string;
  authError?: boolean;
  error?: string;
}

// ─── Helpers Internos ─────────────────────────────────────────────────────

function coalesceValor(row: Record<string, unknown>): number | null {
  const vt = row.valor_total;
  const v  = row.valor;
  if (vt != null && vt !== '') return Number(vt);
  if (v  != null && v  !== '') return Number(v);
  return null;
}

function mapPedido(row: Record<string, unknown>): PedidoSimples {
  return {
    id_int:          Number(row.id_int),
    status_interno:  typeof row.status_interno === 'string' ? row.status_interno : null,
    valor:           coalesceValor(row),
    created_at:      String(row.created_at),
    vendedor:        typeof row.vendedor === 'string' ? row.vendedor : null,
    is_prd_aprovado: row.is_prd_aprovado === true,
    is_reproved:     row.is_reproved === true,
    is_avulso:       row.is_avulso === true,
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

// ─── Consultas Read-Only ──────────────────────────────────────────────────

/**
 * Últimos pedidos reais do cliente.
 * Filtro: is_prd_aprovado=true, is_reproved=false.
 * Ordenação: created_at DESC.
 */
export async function buscarUltimosPedidos(
  supabase: SupabaseClient,
  idCliente: number,
  limit = 5,
): Promise<PropostasResult> {
  const { data, error } = await supabase
    .from('propostas')
    .select(PROPOSTAS_COLS)
    .eq('id_cliente', idCliente)
    .eq('is_prd_aprovado', true)
    .eq('is_reproved', false)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 10));

  if (error) {
    return { found: false, items: [], count: 0, source: 'public.propostas', authError: isAuthError(error), error: error.message };
  }

  const items = (data ?? []).map(r => mapPedido(r as Record<string, unknown>));
  return { found: items.length > 0, items, count: items.length, source: 'public.propostas' };
}

/**
 * Faturamento (soma de pedidos reais) no período informado.
 * Filtro: is_prd_aprovado=true, is_reproved=false, created_at >= desde.
 */
export async function calcularFaturamentoPeriodo(
  supabase: SupabaseClient,
  idCliente: number,
  periodo: MaestroPeriodo,
): Promise<PropostasResult> {
  let desde: string;
  let ate: string | null = null;
  const periodoLabel: string = periodo.label;

  if (periodo.tipo === 'dinamico' && periodo.start) {
    desde = periodo.start;
    if (periodo.end) ate = periodo.end;
  } else {
    switch (periodo.tipo) {
      case 'mes_atual':
        desde      = primeiroDiaMesAtual();
        break;
      case 'mes_passado':
        desde      = primeiroDiaMesPassado();
        ate        = primeiroDiaMesAtual();
        break;
      case 'ultimos_30_dias':
      default:
        desde      = menosNDias(30);
    }
  }

  let query = supabase
    .from('propostas')
    .select(PROPOSTAS_COLS)
    .eq('id_cliente', idCliente)
    .eq('is_prd_aprovado', true)
    .eq('is_reproved', false)
    .gte('created_at', desde);

  if (ate) query = query.lt('created_at', ate);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return { found: false, items: [], count: 0, periodo: periodoLabel, source: 'public.propostas', authError: isAuthError(error), error: error.message };
  }

  const items    = (data ?? []).map(r => mapPedido(r as Record<string, unknown>));
  const totalValor = items.reduce((acc, p) => acc + (p.valor ?? 0), 0);

  return { found: items.length > 0, items, count: items.length, totalValor, periodo: periodoLabel, source: 'public.propostas' };
}

/**
 * Pedido real de maior valor do cliente.
 * Busca até 50 pedidos, ordena por valor coalesced em JS para precisão.
 */
export async function buscarMaiorPedido(
  supabase: SupabaseClient,
  idCliente: number,
): Promise<PropostasResult> {
  const { data, error } = await supabase
    .from('propostas')
    .select(PROPOSTAS_COLS)
    .eq('id_cliente', idCliente)
    .eq('is_prd_aprovado', true)
    .eq('is_reproved', false)
    // Ordenação dupla: valor_total desc (nulls last), depois valor desc
    .order('valor_total', { ascending: false, nullsFirst: false })
    .order('valor',       { ascending: false, nullsFirst: false })
    .limit(50);

  if (error) {
    return { found: false, items: [], count: 0, source: 'public.propostas', authError: isAuthError(error), error: error.message };
  }

  const items = (data ?? [])
    .map(r => mapPedido(r as Record<string, unknown>))
    .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0));

  const top = items.slice(0, 1);
  return { found: top.length > 0, items: top, count: top.length, source: 'public.propostas' };
}

/**
 * Propostas não aprovadas para produção no mês atual.
 * Filtro: is_prd_aprovado=false, is_reproved=false, created_at >= início do mês.
 */
export async function buscarPropostasNaoAprovadas(
  supabase: SupabaseClient,
  idCliente: number,
): Promise<PropostasResult> {
  const { data, error } = await supabase
    .from('propostas')
    .select(PROPOSTAS_COLS)
    .eq('id_cliente', idCliente)
    .eq('is_prd_aprovado', false)
    .eq('is_reproved', false)
    .gte('created_at', primeiroDiaMesAtual())
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    return { found: false, items: [], count: 0, periodo: 'neste mês', source: 'public.propostas', authError: isAuthError(error), error: error.message };
  }

  const items = (data ?? []).map(r => mapPedido(r as Record<string, unknown>));
  return { found: items.length > 0, items, count: items.length, periodo: 'neste mês', source: 'public.propostas' };
}

export interface ListagemPropostasResult {
  found: boolean;
  /** Propostas mais recentes para exibição (até `limite`) */
  items: PedidoSimples[];
  /** Total de propostas do período consideradas nos agregados */
  count: number;
  /** Soma de TODAS as propostas do período (calculada no servidor) */
  totalValor: number;
  /** Contagem por status_interno (calculada no servidor — nunca pelo modelo) */
  contagemPorStatus: Record<string, number>;
  /** Soma de valores por status_interno (calculada no servidor) */
  somaPorStatus: Record<string, number>;
  /** Aprovadas comercialmente: status_interno começando com APROVADO ou LIBERADO */
  aprovadasComercial: { quantidade: number; somaValor: number; maior: PedidoSimples | null };
  /** Fila real de Produção: is_prd_aprovado AND NOT is_reproved */
  pedidosProducao: { quantidade: number; somaValor: number; maior: PedidoSimples | null };
  /** Proposta de maior valor do período (qualquer status não reprovado) */
  maiorProposta: PedidoSimples | null;
  /** true quando o período tem mais propostas que o teto de leitura (agregados parciais) */
  truncado: boolean;
  periodo?: string;
  source: string;
  authError?: boolean;
  error?: string;
}

// Teto de leitura para agregados — acima disso, `truncado=true` sinaliza
// que contagens/somas cobrem apenas as mais recentes.
const LISTAGEM_MAX_ROWS = 500;

/**
 * Lista propostas do cliente em um período, com agregados prontos.
 * Todos os números (contagens e somas por status, fila de produção, totais)
 * são calculados AQUI sobre TODO o período (até LISTAGEM_MAX_ROWS) —
 * consumidores (Maestro Agent) nunca contam nem somam sozinhos.
 * Filtro base: is_reproved=false. Período sobre created_at.
 */
export async function listarPropostasCliente(
  supabase: SupabaseClient,
  idCliente: number,
  opts?: { desde?: string; ate?: string; periodoLabel?: string; limite?: number },
): Promise<ListagemPropostasResult> {
  let query = supabase
    .from('propostas')
    .select(PROPOSTAS_COLS)
    .eq('id_cliente', idCliente)
    .eq('is_reproved', false);

  if (opts?.desde) query = query.gte('created_at', opts.desde);
  if (opts?.ate)   query = query.lt('created_at', opts.ate);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id_int', { ascending: false })
    .limit(LISTAGEM_MAX_ROWS);

  if (error) {
    return {
      found: false, items: [], count: 0, totalValor: 0,
      contagemPorStatus: {}, somaPorStatus: {},
      aprovadasComercial: { quantidade: 0, somaValor: 0, maior: null },
      pedidosProducao: { quantidade: 0, somaValor: 0, maior: null },
      maiorProposta: null,
      truncado: false,
      periodo: opts?.periodoLabel, source: 'public.propostas',
      authError: isAuthError(error), error: error.message,
    };
  }

  const todas = (data ?? []).map(r => mapPedido(r as Record<string, unknown>));
  const contagemPorStatus: Record<string, number> = {};
  const somaPorStatus: Record<string, number> = {};
  const aprovadasComercial: ListagemPropostasResult['aprovadasComercial'] =
    { quantidade: 0, somaValor: 0, maior: null };
  const pedidosProducao: ListagemPropostasResult['pedidosProducao'] =
    { quantidade: 0, somaValor: 0, maior: null };
  let maiorProposta: PedidoSimples | null = null;
  let totalValor = 0;

  for (const p of todas) {
    const status = p.status_interno ?? 'SEM_STATUS';
    const valor = p.valor ?? 0;
    contagemPorStatus[status] = (contagemPorStatus[status] ?? 0) + 1;
    somaPorStatus[status] = Number(((somaPorStatus[status] ?? 0) + valor).toFixed(2));
    totalValor += valor;
    if (!maiorProposta || valor > (maiorProposta.valor ?? 0)) maiorProposta = p;

    if (/^(APROVADO|LIBERADO)/i.test(status)) {
      aprovadasComercial.quantidade++;
      aprovadasComercial.somaValor = Number((aprovadasComercial.somaValor + valor).toFixed(2));
      if (!aprovadasComercial.maior || valor > (aprovadasComercial.maior.valor ?? 0)) {
        aprovadasComercial.maior = p;
      }
    }
    if (p.is_prd_aprovado && !p.is_reproved) {
      pedidosProducao.quantidade++;
      pedidosProducao.somaValor = Number((pedidosProducao.somaValor + valor).toFixed(2));
      if (!pedidosProducao.maior || valor > (pedidosProducao.maior.valor ?? 0)) {
        pedidosProducao.maior = p;
      }
    }
  }

  const limite = Math.min(opts?.limite ?? 20, LISTAGEM_MAX_ROWS);

  return {
    found: todas.length > 0,
    items: todas.slice(0, limite),
    count: todas.length,
    totalValor: Number(totalValor.toFixed(2)),
    contagemPorStatus,
    somaPorStatus,
    aprovadasComercial,
    pedidosProducao,
    maiorProposta,
    truncado: todas.length >= LISTAGEM_MAX_ROWS,
    periodo: opts?.periodoLabel,
    source: 'public.propostas',
  };
}

// ─── Pipeline do VENDEDOR (Maestro Vendedor, fase 1) ──────────────────────

// Colunas do pipeline por vendedor — inclui cliente e updated_at (recência)
const PIPELINE_VENDEDOR_COLS = PROPOSTAS_COLS + ', id_cliente, cliente, updated_at, em_arte';

// Vendedores grandes passam de 500 propostas/mês — teto maior, com truncado
const PIPELINE_VENDEDOR_MAX_ROWS = 1000;

/** Status "aguardando retorno do CLIENTE": orçamento sem cobrança gerada. */
const STATUS_AGUARDANDO_RETORNO = ['NOVO', 'NOVO / EM ARTE'];

export interface PropostaVendedorItem {
  id_int: number;
  cliente: string | null;
  id_cliente: number | null;
  valor: number | null;
  status_interno: string | null;
  created_at: string;
  updated_at: string | null;
  /** Dias desde a última movimentação INTERNA (updated_at ?? created_at) */
  dias_sem_movimentacao: number | null;
  pedido_real: boolean;
  em_arte: boolean;
  is_avulso: boolean;
}

export interface PipelineVendedorResult {
  found: boolean;
  vendedor: string;
  escopo: 'proprio';
  periodo?: string;
  criterio_vinculo: string;
  /** Propostas não canceladas no período (count exact — correto mesmo truncado) */
  total_propostas: number;
  valor_total_pipeline: number;
  criadas_hoje: { quantidade: number; soma_valor: number };
  contagem_por_status: Record<string, number>;
  soma_por_status: Record<string, number>;
  aguardando_retorno_cliente: { quantidade: number; soma_valor: number; criterio: string; items: PropostaVendedorItem[] };
  aguardando_pagamento: { quantidade: number; soma_valor: number; criterio: string };
  /** Fila VIVA de produção (estado atual) — NÃO é métrica de "pedidos fechados no mês" */
  na_fila_producao: { quantidade: number; soma_valor: number; criterio: string };
  paradas: { quantidade: number; soma_valor: number; dias_sem_movimento: number; criterio: string; items: PropostaVendedorItem[] };
  maiores_propostas: { items: PropostaVendedorItem[] };
  prioridade_contato: { criterio: string; items: PropostaVendedorItem[] };
  truncado: boolean;
  source: string;
  aviso_vinculo?: string;
  authError?: boolean;
  error?: string;
}

function mapPropostaVendedor(row: Record<string, unknown>, agoraMs: number): PropostaVendedorItem {
  const updated = typeof row.updated_at === 'string' ? row.updated_at : null;
  const referencia = updated ?? (typeof row.created_at === 'string' ? row.created_at : null);
  const refMs = referencia ? new Date(referencia).getTime() : NaN;
  return {
    id_int: Number(row.id_int),
    cliente: typeof row.cliente === 'string' ? row.cliente : null,
    id_cliente: row.id_cliente != null ? Number(row.id_cliente) : null,
    valor: coalesceValor(row),
    status_interno: typeof row.status_interno === 'string' ? row.status_interno : null,
    created_at: String(row.created_at),
    updated_at: updated,
    dias_sem_movimentacao: Number.isFinite(refMs)
      ? Math.max(0, Math.floor((agoraMs - refMs) / (24 * 60 * 60 * 1000)))
      : null,
    pedido_real: row.is_prd_aprovado === true && row.is_reproved !== true,
    em_arte: row.em_arte === true,
    is_avulso: row.is_avulso === true,
  };
}

/**
 * Pipeline comercial de UM vendedor com agregados prontos (Maestro Vendedor).
 * Espelha os filtros da tela /orcamentos: vendedor por TEXTO (ilike exato,
 * com fallback de prefixo p/ ruído tipo "Edison Jr" vs "Edison Jr."),
 * não canceladas, período por created_at.
 * "Aguardando retorno do cliente" = NOVO/NOVO EM ARTE (sem cobrança gerada);
 * AGUARDANDO* = aguardando PAGAMENTO; "parada" = aguardando retorno sem
 * movimentação INTERNA (updated_at) há N+ dias — o ERP não registra a data
 * do último contato com o cliente.
 */
export async function listarPipelineVendedor(
  supabase: SupabaseClient,
  vendedorNome: string,
  opts?: {
    desde?: string;
    ate?: string;
    periodoLabel?: string;
    /** Dias sem movimentação interna para considerar "parada" (default 2) */
    diasParada?: number;
    /** Tamanho das listas de itens (default 10, máx 20) */
    limite?: number;
    /** Início do dia-calendário de hoje (UTC ISO) para "criadas hoje" */
    inicioHojeUtcIso?: string;
  },
): Promise<PipelineVendedorResult> {
  const criterioVinculoBase = 'propostas.vendedor = nome comercial do usuário (match case-insensitive';
  const base = {
    vendedor: vendedorNome,
    escopo: 'proprio' as const,
    periodo: opts?.periodoLabel,
    source: 'public.propostas',
  };
  const vazio = (extra: Partial<PipelineVendedorResult>): PipelineVendedorResult => ({
    ...base,
    found: false,
    criterio_vinculo: criterioVinculoBase + ')',
    total_propostas: 0,
    valor_total_pipeline: 0,
    criadas_hoje: { quantidade: 0, soma_valor: 0 },
    contagem_por_status: {},
    soma_por_status: {},
    aguardando_retorno_cliente: { quantidade: 0, soma_valor: 0, criterio: '', items: [] },
    aguardando_pagamento: { quantidade: 0, soma_valor: 0, criterio: '' },
    na_fila_producao: { quantidade: 0, soma_valor: 0, criterio: '' },
    paradas: { quantidade: 0, soma_valor: 0, dias_sem_movimento: opts?.diasParada ?? 2, criterio: '', items: [] },
    maiores_propostas: { items: [] },
    prioridade_contato: { criterio: '', items: [] },
    truncado: false,
    ...extra,
  });

  const consultar = (padraoVendedor: string) => {
    let query = supabase
      .from('propostas')
      .select(PIPELINE_VENDEDOR_COLS, { count: 'exact' })
      .ilike('vendedor', padraoVendedor)
      .neq('status_interno', 'CANCELADO');
    if (opts?.desde) query = query.gte('created_at', opts.desde);
    if (opts?.ate) query = query.lt('created_at', opts.ate);
    return query
      .order('created_at', { ascending: false })
      .order('id_int', { ascending: false })
      .limit(PIPELINE_VENDEDOR_MAX_ROWS);
  };

  // 1ª tentativa: match exato (ilike sem curinga); fallback: prefixo
  //   (pega "Edison Jr." quando o cadastro traz "Edison Jr")
  const primeira = await consultar(vendedorNome);
  const error = primeira.error;
  let data = primeira.data;
  let count = primeira.count;
  let avisoVinculo: string | undefined;
  let criterioVinculo = criterioVinculoBase + ')';
  if (!error && (data ?? []).length === 0) {
    const fallback = await consultar(vendedorNome + '%');
    if (!fallback.error && (fallback.data ?? []).length > 0) {
      data = fallback.data;
      count = fallback.count;
      criterioVinculo = criterioVinculoBase + ', com fallback de prefixo)';
      avisoVinculo =
        `Nenhuma proposta com o nome exato "${vendedorNome}" — usando match por prefixo (variação de grafia no cadastro).`;
    }
  }

  if (error) {
    return vazio({ authError: isAuthError(error), error: error.message });
  }

  const agoraMs = Date.now();
  const todas = (data ?? []).map(r => mapPropostaVendedor(r as unknown as Record<string, unknown>, agoraMs));
  const diasParada = Math.min(Math.max(opts?.diasParada ?? 2, 1), 30);
  const limite = Math.min(Math.max(opts?.limite ?? 10, 1), 20);

  const contagemPorStatus: Record<string, number> = {};
  const somaPorStatus: Record<string, number> = {};
  let valorTotal = 0;
  const criadasHoje = { quantidade: 0, soma_valor: 0 };
  const aguardandoRetorno: PropostaVendedorItem[] = [];
  const aguardandoPagamento = { quantidade: 0, soma_valor: 0 };
  const naFilaProducao = { quantidade: 0, soma_valor: 0 };

  for (const p of todas) {
    const status = p.status_interno ?? 'SEM_STATUS';
    const valor = p.valor ?? 0;
    contagemPorStatus[status] = (contagemPorStatus[status] ?? 0) + 1;
    somaPorStatus[status] = Number(((somaPorStatus[status] ?? 0) + valor).toFixed(2));
    valorTotal += valor;
    if (opts?.inicioHojeUtcIso && p.created_at >= opts.inicioHojeUtcIso) {
      criadasHoje.quantidade++;
      criadasHoje.soma_valor = Number((criadasHoje.soma_valor + valor).toFixed(2));
    }
    if (STATUS_AGUARDANDO_RETORNO.includes(status)) aguardandoRetorno.push(p);
    if (status.startsWith('AGUARDANDO')) {
      aguardandoPagamento.quantidade++;
      aguardandoPagamento.soma_valor = Number((aguardandoPagamento.soma_valor + valor).toFixed(2));
    }
    if (p.pedido_real) {
      naFilaProducao.quantidade++;
      naFilaProducao.soma_valor = Number((naFilaProducao.soma_valor + valor).toFixed(2));
    }
  }

  const somaValores = (arr: PropostaVendedorItem[]) =>
    Number(arr.reduce((acc, p) => acc + (p.valor ?? 0), 0).toFixed(2));

  const paradasArr = aguardandoRetorno.filter(
    p => (p.dias_sem_movimentacao ?? 0) >= diasParada,
  );
  const porValorDesc = (a: PropostaVendedorItem, b: PropostaVendedorItem) =>
    (b.valor ?? 0) - (a.valor ?? 0) ||
    (b.dias_sem_movimentacao ?? 0) - (a.dias_sem_movimentacao ?? 0);

  return {
    ...base,
    found: todas.length > 0,
    criterio_vinculo: criterioVinculo,
    total_propostas: count ?? todas.length,
    valor_total_pipeline: Number(valorTotal.toFixed(2)),
    criadas_hoje: criadasHoje,
    contagem_por_status: contagemPorStatus,
    soma_por_status: somaPorStatus,
    aguardando_retorno_cliente: {
      quantidade: aguardandoRetorno.length,
      soma_valor: somaValores(aguardandoRetorno),
      criterio: 'status NOVO ou NOVO / EM ARTE — sem cobrança gerada; aguardando decisão do cliente',
      items: [...aguardandoRetorno].sort(porValorDesc).slice(0, limite),
    },
    aguardando_pagamento: {
      ...aguardandoPagamento,
      criterio: 'status AGUARDANDO* — cobrança ativa; aguardando PAGAMENTO, não retorno do cliente',
    },
    na_fila_producao: {
      ...naFilaProducao,
      criterio:
        'is_prd_aprovado=true e is_reproved=false — fila VIVA de produção (estado atual, não histórico); ' +
        '"quantos pedidos fechei" = pedidos_pagos de minha_performance (pagamentos confirmados)',
    },
    paradas: {
      quantidade: paradasArr.length,
      soma_valor: somaValores(paradasArr),
      dias_sem_movimento: diasParada,
      criterio:
        `NOVO/NOVO EM ARTE sem movimentação INTERNA (updated_at) há ${diasParada}+ dias — ` +
        'o ERP não registra a data do último contato com o cliente',
      items: [...paradasArr]
        .sort((a, b) => (b.dias_sem_movimentacao ?? 0) - (a.dias_sem_movimentacao ?? 0))
        .slice(0, limite),
    },
    maiores_propostas: { items: [...todas].sort(porValorDesc).slice(0, limite) },
    prioridade_contato: {
      criterio: 'aguardando retorno do cliente, ordenado por maior valor; desempate por mais dias sem movimentação',
      items: [...aguardandoRetorno].sort(porValorDesc).slice(0, limite),
    },
    truncado: todas.length >= PIPELINE_VENDEDOR_MAX_ROWS,
    ...(avisoVinculo ? { aviso_vinculo: avisoVinculo } : {}),
  };
}

// ─── Detalhe de proposta (itens/produtos) ─────────────────────────────────

export interface ItemProposta {
  nome_produto: string | null;
  modelo_descri: string | null;
  qtd: number | null;
  valor_unt: number | null;
  fixo: number | null;
  valor_sub_total: number | null;
  desconto_tipo: string | null;
  desconto_valor: number | null;
  status_item: string | null;
}

export interface DetalheProposta extends PedidoSimples {
  is_avulso: boolean;
  /** Campo texto `proposta` (avulsas costumam trazer apenas "A definir") */
  descricao: string | null;
  valor_frete: number | null;
  frete_escolhido: string | null;
  /** Situação operacional (lado seguro da Produção, direto de propostas) */
  status_pedido: string | null;
  etapa_operacional: string | null;
  prazo_operacional: string | null;
  em_arte: boolean;
}

export interface DetalhePropostaResult {
  found: boolean;
  proposta: DetalheProposta | null;
  itens: ItemProposta[];
  /**
   * false quando a proposta não possui itens em produtos_proposta — caso
   * normal das AVULSAS (o ERP não detalha produtos nelas).
   */
  itens_detalhados: boolean;
  source: string;
  authError?: boolean;
  error?: string;
}

const ITENS_PROPOSTA_COLS =
  'nome_produto, modelo_descri, qtd, valor_unt, fixo, valor_sub_total, desconto_tipo, desconto_valor, status_item';

function numOrNull(v: unknown): number | null {
  return v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
}

/**
 * Detalhe de UMA proposta do cliente, incluindo itens (produtos_proposta).
 * O filtro por id_cliente na própria consulta garante o isolamento — proposta
 * de outro cliente nunca é retornada, mesmo com número válido.
 */
export async function buscarDetalheProposta(
  supabase: SupabaseClient,
  idCliente: number,
  numeroProposta: number,
): Promise<DetalhePropostaResult> {
  const { data: propostaRow, error } = await supabase
    .from('propostas')
    .select(`${PROPOSTAS_COLS}, proposta, valor_frete, frete_escolhido, status_pedido, etapa_operacional, prazo_operacional, em_arte`)
    .eq('id_cliente', idCliente)
    .eq('id_int', numeroProposta)
    .maybeSingle();

  if (error) {
    return { found: false, proposta: null, itens: [], itens_detalhados: false, source: 'public.propostas', authError: isAuthError(error), error: error.message };
  }
  if (!propostaRow) {
    return { found: false, proposta: null, itens: [], itens_detalhados: false, source: 'public.propostas', error: 'Proposta não encontrada para este cliente.' };
  }

  const row = propostaRow as Record<string, unknown>;
  const descricaoRaw = typeof row.proposta === 'string' ? row.proposta.trim() : '';
  const proposta: DetalheProposta = {
    ...mapPedido(row),
    is_avulso:      row.is_avulso === true,
    descricao:      descricaoRaw ? descricaoRaw.slice(0, 400) : null,
    valor_frete:    numOrNull(row.valor_frete),
    frete_escolhido: typeof row.frete_escolhido === 'string' ? row.frete_escolhido : null,
    status_pedido:      typeof row.status_pedido === 'string' && row.status_pedido.trim() ? row.status_pedido.trim() : null,
    etapa_operacional:  typeof row.etapa_operacional === 'string' && row.etapa_operacional.trim() ? row.etapa_operacional.trim() : null,
    prazo_operacional:  typeof row.prazo_operacional === 'string' && String(row.prazo_operacional).trim() ? String(row.prazo_operacional) : null,
    em_arte:            row.em_arte === true,
  };

  const { data: itensData, error: itensError } = await supabase
    .from('produtos_proposta')
    .select(ITENS_PROPOSTA_COLS)
    .eq('id_int', numeroProposta)
    .order('id', { ascending: true })
    .limit(50);

  if (itensError) {
    return { found: true, proposta, itens: [], itens_detalhados: false, source: 'public.propostas + public.produtos_proposta', authError: isAuthError(itensError), error: itensError.message };
  }

  const itens: ItemProposta[] = (itensData ?? []).map(r => {
    const i = r as Record<string, unknown>;
    return {
      nome_produto:    typeof i.nome_produto === 'string' ? i.nome_produto : null,
      modelo_descri:   typeof i.modelo_descri === 'string' ? i.modelo_descri : null,
      qtd:             numOrNull(i.qtd),
      valor_unt:       numOrNull(i.valor_unt),
      fixo:            numOrNull(i.fixo),
      valor_sub_total: numOrNull(i.valor_sub_total),
      desconto_tipo:   typeof i.desconto_tipo === 'string' ? i.desconto_tipo : null,
      desconto_valor:  numOrNull(i.desconto_valor),
      status_item:     typeof i.status_item === 'string' ? i.status_item : null,
    };
  });

  return {
    found: true,
    proposta,
    itens,
    itens_detalhados: itens.length > 0,
    source: 'public.propostas + public.produtos_proposta',
  };
}

export type FiltroUltimoOrcamento = 'qualquer' | 'nao_aprovada_comercial' | 'nao_avulsa';

// Quantas propostas recentes varrer quando há filtro (determinístico no servidor)
const ULTIMO_ORCAMENTO_JANELA = 30;

/**
 * Último orçamento/proposta do cliente (independente de aprovação de produção).
 * Filtro base: is_reproved=false. Ordenação: created_at DESC.
 * Filtros opcionais (vocabulário da equipe):
 *   - nao_aprovada_comercial → último SEM aprovação comercial (status fora de APROVADO/LIBERADO);
 *   - nao_avulsa             → último com is_avulso=false (tem itens detalháveis).
 */
export async function buscarUltimoOrcamento(
  supabase: SupabaseClient,
  idCliente: number,
  filtro: FiltroUltimoOrcamento = 'qualquer',
): Promise<PropostasResult & { criterio?: string; varridas?: number; janela_esgotada?: boolean }> {
  const janela = filtro === 'qualquer' ? 1 : ULTIMO_ORCAMENTO_JANELA;

  const { data, error } = await supabase
    .from('propostas')
    .select(PROPOSTAS_COLS)
    .eq('id_cliente', idCliente)
    .eq('is_reproved', false)
    .order('created_at', { ascending: false })
    .order('id_int', { ascending: false })
    .limit(janela);

  if (error) {
    return { found: false, items: [], count: 0, source: 'public.propostas', authError: isAuthError(error), error: error.message };
  }

  const todas = (data ?? []).map(r => mapPedido(r as Record<string, unknown>));
  let candidatas = todas;
  let criterio = 'última proposta (qualquer status)';
  if (filtro === 'nao_aprovada_comercial') {
    candidatas = todas.filter(p => !/^(APROVADO|LIBERADO)/i.test(p.status_interno ?? ''));
    criterio = 'última proposta SEM aprovação comercial (status fora de APROVADO/LIBERADO)';
  } else if (filtro === 'nao_avulsa') {
    candidatas = todas.filter(p => p.is_avulso !== true);
    criterio = 'última proposta NÃO avulsa (com itens detalháveis)';
  }

  const items = candidatas.slice(0, 1);
  return {
    found: items.length > 0,
    items,
    count: items.length,
    source: 'public.propostas',
    criterio,
    varridas: todas.length,
    // sem match dentro da janela → pode existir mais antiga; sinalize em vez de afirmar que não existe
    janela_esgotada: filtro !== 'qualquer' && items.length === 0 && todas.length >= ULTIMO_ORCAMENTO_JANELA,
  };
}
