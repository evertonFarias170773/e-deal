/**
 * maestro-simple-conta-corrente.server.ts
 *
 * Adapter server-side read-only para conta corrente e análise de crédito.
 *
 * Fontes:
 *   - public.conta_corrente_pendencias (RLS ativa) — pendências por direção
 *     (FAVOR_CLIENTE = saldo a favor do cliente; FAVOR_EMPRESA = a favor da
 *     empresa) e status (ABERTA carrega valor_saldo; RESOLVIDA/CANCELADA não);
 *   - public.movimento_credito (RLS ativa) — extrato de créditos/débitos;
 *   - RPC public.get_credito_cliente (security invoker) — saldo de crédito;
 *   - RPC public.fn_analise_credito_cliente — quadro completo de crédito.
 *     ⚠️ SECURITY DEFINER: roda como owner (bypassa RLS). Por isso a tool que
 *     a expõe DEVE manter o gate de permissão (cadastros.view_credito) além
 *     do isolamento por id_cliente resolvido na sessão.
 *
 * Modo: somente leitura — nunca INSERT, UPDATE, DELETE ou UPSERT.
 * ⚠️ Roda exclusivamente no servidor (via API route).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

function isAuthError(err: unknown): boolean {
  const e = err as Record<string, unknown>;
  const msg = String(e?.message ?? '').toLowerCase();
  return e?.code === 'PGRST301' || e?.code === '42501' || msg.includes('jwt') || msg.includes('permission');
}

// ─── Conta corrente (pendências + movimentos + saldo de crédito) ───────────

export interface PendenciaContaCorrente {
  id_int: number | null;
  direcao: string | null;
  motivo: string | null;
  status: string | null;
  valor_original: number | null;
  valor_saldo: number | null;
  valor_reservado: number | null;
  created_at: string;
  encerrado_em: string | null;
}

export interface MovimentoCredito {
  id_int: number | null;
  tipo: string | null;
  origem: string | null;
  tipo_evento: string | null;
  valor: number | null;
  created_at: string;
}

export interface ContaCorrenteResult {
  found: boolean;
  /** Saldo de crédito do cliente (RPC get_credito_cliente) */
  saldo_credito: number | null;
  pendencias_abertas: {
    favor_cliente: { quantidade: number; saldo: number };
    favor_empresa: { quantidade: number; saldo: number };
  };
  pendencias: PendenciaContaCorrente[];
  movimentos_recentes: MovimentoCredito[];
  semantica: string;
  source: string;
  authError?: boolean;
  error?: string;
}

function numOrNull(v: unknown): number | null {
  return v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
}

export async function buscarContaCorrenteCliente(
  supabase: SupabaseClient,
  idCliente: number,
): Promise<ContaCorrenteResult> {
  const [pendRes, movRes, saldoRes] = await Promise.all([
    supabase
      .from('conta_corrente_pendencias')
      .select('id_int, direcao, motivo, status, valor_original, valor_saldo, valor_reservado, created_at, encerrado_em')
      .eq('id_cliente', idCliente)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('movimento_credito')
      .select('id_int, tipo, origem, tipo_evento, valor, created_at, cancelado')
      .eq('id_cliente', idCliente)
      .not('cancelado', 'is', true)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.rpc('get_credito_cliente', { p_id_cliente: idCliente }),
  ]);

  const semantica =
    'direcao FAVOR_CLIENTE = saldo a favor do CLIENTE; FAVOR_EMPRESA = a favor da EMPRESA. ' +
    'Somente pendências ABERTAS carregam valor_saldo. movimento_credito: tipo CREDITO/DEBITO. ' +
    'saldo_credito = crédito disponível do cliente (RPC oficial).';
  const source = 'public.conta_corrente_pendencias + public.movimento_credito + rpc get_credito_cliente';

  if (pendRes.error) {
    return {
      found: false, saldo_credito: null,
      pendencias_abertas: { favor_cliente: { quantidade: 0, saldo: 0 }, favor_empresa: { quantidade: 0, saldo: 0 } },
      pendencias: [], movimentos_recentes: [], semantica, source,
      authError: isAuthError(pendRes.error), error: pendRes.error.message,
    };
  }

  const pendencias: PendenciaContaCorrente[] = (pendRes.data ?? []).map(raw => {
    const r = raw as Record<string, unknown>;
    return {
      id_int: numOrNull(r.id_int),
      direcao: typeof r.direcao === 'string' ? r.direcao : null,
      motivo: typeof r.motivo === 'string' ? r.motivo : null,
      status: typeof r.status === 'string' ? r.status : null,
      valor_original: numOrNull(r.valor_original),
      valor_saldo: numOrNull(r.valor_saldo),
      valor_reservado: numOrNull(r.valor_reservado),
      created_at: String(r.created_at),
      encerrado_em: typeof r.encerrado_em === 'string' ? r.encerrado_em : null,
    };
  });

  const abertas = {
    favor_cliente: { quantidade: 0, saldo: 0 },
    favor_empresa: { quantidade: 0, saldo: 0 },
  };
  for (const p of pendencias) {
    if (p.status !== 'ABERTA') continue;
    const alvo = p.direcao === 'FAVOR_CLIENTE' ? abertas.favor_cliente
               : p.direcao === 'FAVOR_EMPRESA' ? abertas.favor_empresa
               : null;
    if (!alvo) continue;
    alvo.quantidade++;
    alvo.saldo = Number((alvo.saldo + (p.valor_saldo ?? 0)).toFixed(2));
  }

  const movimentos: MovimentoCredito[] = (movRes.error ? [] : (movRes.data ?? [])).map(raw => {
    const r = raw as Record<string, unknown>;
    return {
      id_int: numOrNull(r.id_int),
      tipo: typeof r.tipo === 'string' ? r.tipo : null,
      origem: typeof r.origem === 'string' ? r.origem : null,
      tipo_evento: typeof r.tipo_evento === 'string' ? r.tipo_evento : null,
      valor: numOrNull(r.valor),
      created_at: String(r.created_at),
    };
  });

  return {
    found: pendencias.length > 0 || movimentos.length > 0 || saldoRes.data != null,
    saldo_credito: saldoRes.error ? null : numOrNull(saldoRes.data),
    pendencias_abertas: abertas,
    pendencias,
    movimentos_recentes: movimentos,
    semantica,
    source,
    ...(movRes.error ? { error: `movimentos indisponíveis: ${movRes.error.message}` } : {}),
  };
}

// ─── Análise de crédito (RPC oficial) ──────────────────────────────────────

export interface AnaliseCreditoResult {
  found: boolean;
  analise: Record<string, unknown> | null;
  semantica: string;
  source: string;
  authError?: boolean;
  error?: string;
}

export async function buscarAnaliseCredito(
  supabase: SupabaseClient,
  idCliente: number,
): Promise<AnaliseCreditoResult> {
  const semantica =
    'Quadro oficial de crédito: limite, utilizado, saldo em carteira, disponível, status/risco, ' +
    'histórico de atrasos e ticket médio. qtd_pedidos_aprovados e ticket_medio_aprovado seguem o ' +
    'critério da própria RPC (não recalcule nem misture com outros recortes).';
  const source = 'rpc fn_analise_credito_cliente';

  const { data, error } = await supabase.rpc('fn_analise_credito_cliente', { p_id_cliente: idCliente });

  if (error) {
    return { found: false, analise: null, semantica, source, authError: isAuthError(error), error: error.message };
  }

  const linha = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : (data as Record<string, unknown> | null);
  return { found: !!linha, analise: linha ?? null, semantica, source };
}
