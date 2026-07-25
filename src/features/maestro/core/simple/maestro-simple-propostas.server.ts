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
    .select(`${PROPOSTAS_COLS}, proposta, valor_frete, frete_escolhido`)
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
