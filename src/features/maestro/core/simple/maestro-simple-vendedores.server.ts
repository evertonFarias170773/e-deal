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
 * Este módulo resolve apenas a IDENTIDADE do chamador:
 *   - nome           → usuarios.nome_usuario (exibição/saudação);
 *   - nomeComercial  → usuarios.meu_vendedor || nome_usuario — é o nome que
 *     casa com propostas.vendedor (pode diferir do nome de usuário, ex.:
 *     usuária "Edina Farias" atende como "Edison Jr.");
 *   - isVendedor     → usuarios.is_vendedor.
 *
 * Usada pelo gate da tool vendas_por_vendedor (sem propostas.view_all → o
 * usuário vê somente os próprios números) e pelas tools "minha_*" do
 * Maestro Vendedor (escopo SEMPRE o usuário logado).
 *
 * ⚠️ Roda exclusivamente no servidor (via API route) — preserva RLS com auth.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface IdentidadeVendedor {
  /** Nome de usuário (exibição/saudação). */
  nome: string | null;
  /** Nome COMERCIAL — é o que casa com propostas.vendedor. */
  nomeComercial: string | null;
  isVendedor: boolean;
}

/** Identidade comercial do chamador (para "minhas vendas/propostas"). */
export async function buscarNomeUsuario(
  supabase: SupabaseClient,
  userId: string,
): Promise<IdentidadeVendedor> {
  const { data } = await supabase
    .from('usuarios')
    .select('nome_usuario, meu_vendedor, is_vendedor')
    .eq('user_id', userId)
    .maybeSingle();
  const row = data as { nome_usuario?: unknown; meu_vendedor?: unknown; is_vendedor?: unknown } | null;
  const nome =
    typeof row?.nome_usuario === 'string' && row.nome_usuario.trim() ? row.nome_usuario.trim() : null;
  const meuVendedor =
    typeof row?.meu_vendedor === 'string' && row.meu_vendedor.trim() ? row.meu_vendedor.trim() : null;
  return {
    nome,
    nomeComercial: meuVendedor ?? nome,
    isVendedor: row?.is_vendedor === true,
  };
}
