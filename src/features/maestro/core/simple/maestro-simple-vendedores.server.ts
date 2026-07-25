/**
 * maestro-simple-vendedores.server.ts
 *
 * Adapter server-side read-only para vendas por vendedor (visão gerencial).
 *
 * MODELO DE PERMISSÃO (decisão de produto, 2026-07-25):
 *   - quem tem `propostas.view_all` (gestores) consulta qualquer vendedor e o ranking;
 *   - quem NÃO tem vê somente os próprios números (propostas.vendedor = seu nome_usuario);
 *   O gate é aplicado pela TOOL (vendas_por_vendedor) — este adapter só executa
 *   a consulta já restringida.
 *
 * CHAVE DE AGRUPAMENTO: propostas.vendedor (texto, 100% preenchido).
 *   ⚠️ propostas.id_vendedor NÃO é confiável — a maioria dos UUIDs não
 *   corresponde a usuarios.user_id nem a usuarios.id_vendedor.
 *
 * Fonte: public.propostas — somente leitura.
 * ⚠️ Roda exclusivamente no servidor (via API route) — preserva RLS com auth.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const VENDEDOR_COLS = 'id_int, vendedor, status_interno, valor_total, valor, created_at, is_prd_aprovado, is_reproved';

// Teto de leitura para agregados da empresa inteira num período
const VENDEDOR_MAX_ROWS = 3000;

export interface VendasVendedorAgregado {
  vendedor: string;
  total_propostas: number;
  aprovadas_comercial: { quantidade: number; somaValor: number };
  pedidos_producao: { quantidade: number; somaValor: number };
  maior_aprovada: { id_int: number; valor: number | null; status_interno: string | null; created_at: string } | null;
}

export interface VendasPorVendedorResult {
  found: boolean;
  periodo: string;
  vendedores: VendasVendedorAgregado[];
  total_propostas_periodo: number;
  truncado: boolean;
  source: string;
  authError?: boolean;
  error?: string;
}

function isAuthError(err: unknown): boolean {
  const e = err as Record<string, unknown>;
  const msg = String(e?.message ?? '').toLowerCase();
  return e?.code === 'PGRST301' || e?.code === '42501' || msg.includes('jwt') || msg.includes('permission');
}

/**
 * Agrega propostas do período por vendedor (contagens e somas no SERVIDOR).
 * `filtroVendedorNome` limita a um vendedor (match parcial, case-insensitive).
 */
export async function calcularVendasPorVendedor(
  supabase: SupabaseClient,
  opts: { desde: string; ate?: string; periodoLabel: string; filtroVendedorNome?: string },
): Promise<VendasPorVendedorResult> {
  let query = supabase
    .from('propostas')
    .select(VENDEDOR_COLS)
    .eq('is_reproved', false)
    .gte('created_at', opts.desde);

  if (opts.ate) query = query.lt('created_at', opts.ate);
  if (opts.filtroVendedorNome) {
    // % e vírgula quebrariam o padrão do ilike/PostgREST
    const nome = opts.filtroVendedorNome.replace(/[%,()]/g, ' ').trim();
    if (nome) query = query.ilike('vendedor', `%${nome}%`);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(VENDEDOR_MAX_ROWS);

  if (error) {
    return {
      found: false, periodo: opts.periodoLabel, vendedores: [], total_propostas_periodo: 0,
      truncado: false, source: 'public.propostas', authError: isAuthError(error), error: error.message,
    };
  }

  const porVendedor = new Map<string, VendasVendedorAgregado>();
  for (const raw of data ?? []) {
    const r = raw as Record<string, unknown>;
    const nome = typeof r.vendedor === 'string' && r.vendedor.trim() ? r.vendedor.trim() : 'SEM_VENDEDOR';
    const valor = r.valor_total != null ? Number(r.valor_total) : (r.valor != null ? Number(r.valor) : 0);
    const status = typeof r.status_interno === 'string' ? r.status_interno : '';

    const agg = porVendedor.get(nome) ?? {
      vendedor: nome,
      total_propostas: 0,
      aprovadas_comercial: { quantidade: 0, somaValor: 0 },
      pedidos_producao: { quantidade: 0, somaValor: 0 },
      maior_aprovada: null,
    };

    agg.total_propostas++;
    if (/^(APROVADO|LIBERADO)/i.test(status)) {
      agg.aprovadas_comercial.quantidade++;
      agg.aprovadas_comercial.somaValor = Number((agg.aprovadas_comercial.somaValor + valor).toFixed(2));
      if (!agg.maior_aprovada || valor > (agg.maior_aprovada.valor ?? 0)) {
        agg.maior_aprovada = {
          id_int: Number(r.id_int),
          valor,
          status_interno: status || null,
          created_at: String(r.created_at),
        };
      }
    }
    if (r.is_prd_aprovado === true && r.is_reproved !== true) {
      agg.pedidos_producao.quantidade++;
      agg.pedidos_producao.somaValor = Number((agg.pedidos_producao.somaValor + valor).toFixed(2));
    }
    porVendedor.set(nome, agg);
  }

  const vendedores = [...porVendedor.values()]
    .sort((a, b) => b.aprovadas_comercial.somaValor - a.aprovadas_comercial.somaValor);
  const total = (data ?? []).length;

  return {
    found: total > 0,
    periodo: opts.periodoLabel,
    vendedores,
    total_propostas_periodo: total,
    truncado: total >= VENDEDOR_MAX_ROWS,
    source: 'public.propostas',
  };
}

/** Nome de usuário do chamador (para restringir "minhas vendas"). */
export async function buscarNomeUsuario(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ nome: string | null; isVendedor: boolean }> {
  const { data } = await supabase
    .from('usuarios')
    .select('nome_usuario, is_vendedor')
    .eq('user_id', userId)
    .maybeSingle();
  const row = data as { nome_usuario?: unknown; is_vendedor?: unknown } | null;
  return {
    nome: typeof row?.nome_usuario === 'string' && row.nome_usuario.trim() ? row.nome_usuario.trim() : null,
    isVendedor: row?.is_vendedor === true,
  };
}
