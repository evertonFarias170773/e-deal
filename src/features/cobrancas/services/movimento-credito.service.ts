/**
 * movimento-credito.service.ts
 *
 * Service de LEITURA de public.movimento_credito (saldo e consultas). Este
 * service NÃO grava mais na tabela — toda escrita (criação, estorno) ocorre
 * exclusivamente via RPC SECURITY DEFINER:
 *   - Vinculada a pendência (id_pendencia preenchido): `cc_usar_pendencia` /
 *     `cc_encerrar_pendencia` (ver conta-corrente.service.ts e as rotas em
 *     /api/conta-corrente/*).
 *   - Avulsa (origem=AJUSTE, sem proposta): `mc_ajuste_avulso_criar` /
 *     `mc_ajuste_avulso_estornar` (ver /api/cobrancas/ajuste-credito e
 *     /estorno-credito).
 *   - Fallback legado de abatimento de débito: `mc_confirmar_abatimento_legado`
 *     (ver /api/cobrancas/confirmar).
 * A partir do cutover (Fase 1b), INSERT/UPDATE/DELETE diretos em
 * movimento_credito são revogados de `authenticated` — só as RPCs (rodando
 * como owner) conseguem escrever.
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import type { MovimentoCredito } from "@/features/cobrancas/types";

// ---------------------------------------------------------------------------
// Cálculo de saldo
// ---------------------------------------------------------------------------

/**
 * Calcula o saldo de crédito disponível de um cliente diretamente em movimento_credito.
 *
 * Semântica real (constraint aceita somente CREDITO e DEBITO):
 *   CREDITO → soma positiva (cliente ganhou crédito)
 *   DEBITO  → subtrai (cliente consumiu/devolveu crédito ou débito administrativo)
 *
 * Retorna 0 em caso de erro para não bloquear a UI.
 */
export async function getSaldoCredito(idCliente: number): Promise<number> {
  const client = getSupabaseClient();
  if (!client || !idCliente) return 0;

  const { data, error } = await client
    .from("movimento_credito")
    .select("valor, tipo")
    .eq("id_cliente", idCliente)
    .eq("cancelado", false);

  if (error) {
    console.warn("[MovimentoCreditoService] Erro ao calcular saldo:", error.message);
    return 0;
  }

  let saldo = 0;
  for (const row of data || []) {
    const v = Number(row.valor) || 0;
    if (row.tipo === "CREDITO") {
      saldo += v;
    } else if (row.tipo === "DEBITO") {
      saldo -= v;
    }
  }

  return Math.max(0, Math.round(saldo * 100) / 100);
}

/**
 * Saldo real da conta corrente do cliente (COM sinal, SEM piso em zero).
 *
 * Diferente de `getSaldoCredito` (que retorna apenas o crédito disponível para
 * aplicar em pagamentos e por isso nunca fica negativo), esta função devolve o
 * saldo líquido verdadeiro: negativo quando o cliente está devedor
 * (Σ DEBITO > Σ CREDITO). É a base do extrato/modal de Conta Corrente.
 *
 * Retorna 0 em caso de erro para não bloquear a UI.
 */
export async function getSaldoContaCorrente(idCliente: number): Promise<number> {
  const client = getSupabaseClient();
  if (!client || !idCliente) return 0;

  const { data, error } = await client
    .from("movimento_credito")
    .select("valor, tipo")
    .eq("id_cliente", idCliente)
    .eq("cancelado", false);

  if (error) {
    console.warn("[MovimentoCreditoService] Erro ao calcular saldo da conta corrente:", error.message);
    return 0;
  }

  let saldo = 0;
  for (const row of data || []) {
    const v = Number(row.valor) || 0;
    if (row.tipo === "CREDITO") {
      saldo += v;
    } else if (row.tipo === "DEBITO") {
      saldo -= v;
    }
  }

  return Math.round(saldo * 100) / 100;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/** Busca todos os movimentos de um cliente (não cancelados). */
export async function getMovimentosByCliente(
  idCliente: number
): Promise<MovimentoCredito[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("movimento_credito")
    .select("*")
    .eq("id_cliente", idCliente)
    .eq("cancelado", false)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[MovimentoCreditoService] Erro ao buscar movimentos do cliente:", error.message);
    return [];
  }

  return (data || []) as MovimentoCredito[];
}

/** Busca movimentos vinculados a uma proposta específica. */
export async function getMovimentosByProposta(
  idInt: number
): Promise<MovimentoCredito[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("movimento_credito")
    .select("*")
    .eq("id_int", idInt)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[MovimentoCreditoService] Erro ao buscar movimentos da proposta:", error.message);
    return [];
  }

  return (data || []) as MovimentoCredito[];
}

export async function listarHistoricoCredito(
  idCliente: number,
  supabaseClient?: ReturnType<typeof getSupabaseClient>
): Promise<MovimentoCredito[]> {
  const client = supabaseClient || getSupabaseClient();
  if (!client || !idCliente) return [];

  const { data, error } = await client
    .from("movimento_credito")
    .select("*")
    .eq("id_cliente", idCliente)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[MovimentoCreditoService] Erro listarHistoricoCredito:", error.message);
    return [];
  }
  return (data || []) as MovimentoCredito[];
}

// Estorno de movimento avulso: ver RPC `mc_ajuste_avulso_estornar`
// (chamada por /api/cobrancas/estorno-credito). Estorno de movimento
// vinculado a pendência: ver RPC `cc_encerrar_pendencia` (modo ESTORNO,
// chamada por /api/conta-corrente/encerrar). Nenhum dos dois grava mais por
// INSERT direto neste service — movimento_credito não aceita escrita do
// cliente fora de RPC SECURITY DEFINER a partir do cutover (Fase 1b).
