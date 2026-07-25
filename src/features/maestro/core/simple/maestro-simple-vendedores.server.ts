/**
 * maestro-simple-vendedores.server.ts
 *
 * Suporte à visão por vendedor do Maestro.
 *
 * FATURAMENTO/VENDAS por vendedor NÃO vivem aqui: a fonte oficial é
 * calcularFaturamentoOficial (maestro-simple-pagamentos.server.ts) —
 * pagamentos_v2 confirmados (PAID/A_VENCER) por data_confirmacao, com
 * public.propostas usada apenas como dimensão (vendedor/cliente).
 *
 * Este módulo resolve apenas a identidade do chamador, usada pelo gate de
 * permissão da tool vendas_por_vendedor (sem propostas.view_all → o usuário
 * vê somente os próprios números).
 *
 * ⚠️ Roda exclusivamente no servidor (via API route) — preserva RLS com auth.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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
