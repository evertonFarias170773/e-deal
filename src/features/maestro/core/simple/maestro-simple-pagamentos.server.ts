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
  } catch (err: any) {
    console.error('[compararRecebimentoClienteMeses] Erro:', err);
    return {
      found: false,
      idCliente,
      items: [],
      source: 'public.pagamentos_v2',
      error: err.message || String(err),
    };
  }
}

