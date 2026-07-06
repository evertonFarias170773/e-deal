/**
 * maestro-simple-boletos.server.ts
 *
 * Adapter server-side read-only para consultas de boletos.
 * Fase 2 — Inteligência Financeira por id_cliente.
 *
 * Fonte: public.boletos
 * NÃO usa: pagamentos_v2 (sistema de pagamentos — diferente de cobrança)
 *
 * Campos NUNCA retornados (dados sensíveis de cobrança):
 *   linha_digitavel, codigo_barras, id_boleto_c6, url_pdf, pdf_storage,
 *   nosso_numero, ext_reference, msg_whats, texto_whatsapp
 *
 * Regras de liquidação:
 *   paid_at IS NULL     → não liquidado
 *   paid_at IS NOT NULL → liquidado/pago
 *   dias_atraso > 0     → em atraso
 *   status = 'A_VENCER' → em aberto (ainda dentro do prazo)
 *
 * Modo: somente leitura — nunca INSERT, UPDATE, DELETE ou UPSERT.
 * ⚠️  Roda exclusivamente no servidor (via API route) — preserva RLS com auth.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// Colunas seguras — sem linha digitável, código de barras ou URLs de pagamento
const BOLETOS_COLS = 'id_int, vencimento, valor, valor_atualizado, status, dias_atraso, n_nf, paid_at';

// ─── Tipos Exportados ──────────────────────────────────────────────────────

export interface BoletoSimples {
  id_int: number;
  vencimento: string | null;
  valor: number | null;
  valor_atualizado: number | null;
  status: string | null;
  dias_atraso: number;
  n_nf: string | null;
  paid_at: string | null;
}

export interface BoletosResult {
  found: boolean;
  items: BoletoSimples[];
  count: number;
  /** Descrição do filtro aplicado para exibição */
  filtro: string;
  /** Fonte da consulta — sempre 'public.boletos' */
  source: string;
  authError?: boolean;
  error?: string;
}

// ─── Helpers Internos ─────────────────────────────────────────────────────

function mapBoleto(row: Record<string, unknown>): BoletoSimples {
  return {
    id_int:          Number(row.id_int),
    vencimento:      typeof row.vencimento === 'string' ? row.vencimento : null,
    valor:           row.valor != null ? Number(row.valor) : null,
    valor_atualizado: row.valor_atualizado != null ? Number(row.valor_atualizado) : null,
    status:          typeof row.status === 'string' ? row.status : null,
    dias_atraso:     Number(row.dias_atraso) || 0,
    n_nf:            typeof row.n_nf === 'string' ? row.n_nf : null,
    paid_at:         typeof row.paid_at === 'string' ? row.paid_at : null,
  };
}

function isAuthError(err: unknown): boolean {
  const e = err as Record<string, unknown>;
  const msg = String(e?.message ?? '').toLowerCase();
  return e?.code === 'PGRST301' || e?.code === '42501' || msg.includes('jwt') || msg.includes('permission');
}

// ─── Consultas Read-Only ──────────────────────────────────────────────────

/**
 * Boletos em aberto (não pagos, status = 'A_VENCER').
 */
export async function buscarBoletosEmAberto(
  supabase: SupabaseClient,
  idCliente: number,
): Promise<BoletosResult> {
  const { data, error } = await supabase
    .from('boletos')
    .select(BOLETOS_COLS)
    .eq('id_cliente', idCliente)
    .is('paid_at', null)
    .eq('status', 'A_VENCER')
    .order('vencimento', { ascending: true })
    .limit(20);

  if (error) {
    return { found: false, items: [], count: 0, filtro: 'em aberto', source: 'public.boletos', authError: isAuthError(error), error: error.message };
  }

  const items = (data ?? []).map(r => mapBoleto(r as Record<string, unknown>));
  return { found: items.length > 0, items, count: items.length, filtro: 'em aberto', source: 'public.boletos' };
}

/**
 * Boletos em atraso (não pagos, dias_atraso > 0).
 */
export async function buscarBoletosEmAtraso(
  supabase: SupabaseClient,
  idCliente: number,
): Promise<BoletosResult> {
  const { data, error } = await supabase
    .from('boletos')
    .select(BOLETOS_COLS)
    .eq('id_cliente', idCliente)
    .is('paid_at', null)
    .gt('dias_atraso', 0)
    .order('dias_atraso', { ascending: false })
    .limit(20);

  if (error) {
    return { found: false, items: [], count: 0, filtro: 'em atraso', source: 'public.boletos', authError: isAuthError(error), error: error.message };
  }

  const items = (data ?? []).map(r => mapBoleto(r as Record<string, unknown>));
  return { found: items.length > 0, items, count: items.length, filtro: 'em atraso', source: 'public.boletos' };
}

/**
 * Todos os boletos não liquidados (paid_at IS NULL), qualquer status.
 */
export async function buscarBoletosNaoLiquidados(
  supabase: SupabaseClient,
  idCliente: number,
): Promise<BoletosResult> {
  const { data, error } = await supabase
    .from('boletos')
    .select(BOLETOS_COLS)
    .eq('id_cliente', idCliente)
    .is('paid_at', null)
    .order('vencimento', { ascending: true })
    .limit(30);

  if (error) {
    return { found: false, items: [], count: 0, filtro: 'não liquidados', source: 'public.boletos', authError: isAuthError(error), error: error.message };
  }

  const items = (data ?? []).map(r => mapBoleto(r as Record<string, unknown>));
  return { found: items.length > 0, items, count: items.length, filtro: 'não liquidados', source: 'public.boletos' };
}

/**
 * Facade: despacha para a consulta correta baseada no filtro detectado.
 */
export async function buscarBoletosCliente(
  supabase: SupabaseClient,
  idCliente: number,
  filtro: 'aberto' | 'atraso' | 'nao_liquidado' | 'todos',
): Promise<BoletosResult> {
  switch (filtro) {
    case 'aberto':       return buscarBoletosEmAberto(supabase, idCliente);
    case 'atraso':       return buscarBoletosEmAtraso(supabase, idCliente);
    case 'nao_liquidado':
    case 'todos':
    default:             return buscarBoletosNaoLiquidados(supabase, idCliente);
  }
}
