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
const PROPOSTAS_COLS = 'id_int, status_interno, valor_total, valor, created_at, vendedor';

// ─── Tipos Exportados ──────────────────────────────────────────────────────

export interface PedidoSimples {
  id_int: number;
  status_interno: string | null;
  /** valor_total ?? valor — null somente se ambos ausentes */
  valor: number | null;
  created_at: string;
  vendedor: string | null;
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
    id_int:         Number(row.id_int),
    status_interno: typeof row.status_interno === 'string' ? row.status_interno : null,
    valor:          coalesceValor(row),
    created_at:     String(row.created_at),
    vendedor:       typeof row.vendedor === 'string' ? row.vendedor : null,
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

/**
 * Último orçamento/proposta do cliente (independente de aprovação de produção).
 * Filtro: is_reproved=false.
 * Ordenação: created_at DESC.
 */
export async function buscarUltimoOrcamento(
  supabase: SupabaseClient,
  idCliente: number,
): Promise<PropostasResult> {
  const { data, error } = await supabase
    .from('propostas')
    .select(PROPOSTAS_COLS)
    .eq('id_cliente', idCliente)
    .eq('is_reproved', false)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    return { found: false, items: [], count: 0, source: 'public.propostas', authError: isAuthError(error), error: error.message };
  }

  const items = (data ?? []).map(r => mapPedido(r as Record<string, unknown>));
  return { found: items.length > 0, items, count: items.length, source: 'public.propostas' };
}
