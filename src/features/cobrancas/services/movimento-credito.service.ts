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

export type SaldoGlobalContaCorrente = {
  /** Σ dos saldos POSITIVOS, cliente a cliente. */
  totalCredito: number;
  /** Σ dos saldos NEGATIVOS (em módulo), cliente a cliente. */
  totalDebito: number;
  clientesComCredito: number;
  clientesComDebito: number;
  /** Crédito avulso já consumido como pagamento (USO_PEDIDO sem pendência). */
  totalUsos: number;
  qtdUsos: number;
  /** true quando o teto de linhas foi atingido e o total pode estar incompleto. */
  truncado: boolean;
};

/**
 * Saldo agregado da conta corrente de TODOS os clientes, pela mesma conta do
 * `getSaldoContaCorrente` — só que rodada por cliente e depois somada.
 *
 * POR QUE POR CLIENTE, E NÃO UM SOMATÓRIO ÚNICO: crédito de um cliente não
 * abate débito de outro. Somar a razão inteira de uma vez daria um número
 * sem significado financeiro (devedores cancelando credores). Aqui cada
 * cliente fecha o próprio saldo e só então os positivos e os negativos são
 * totalizados em separado.
 *
 * COBERTURA: `movimento_credito` é a razão COMPLETA da conta corrente, não
 * uma fonte paralela. Toda pendência grava seu movimento de ABERTURA em
 * `cc_abrir_pendencia` (FAVOR_CLIENTE→CREDITO, FAVOR_EMPRESA→DEBITO), e as
 * resoluções/cancelamentos gravam a contrapartida. Somado a ajustes manuais
 * e usos, o saldo daqui já contempla tudo — por isso ele pode alimentar os
 * cards sem contar nada duas vezes com `conta_corrente_pendencias`.
 */
export async function getSaldoGlobalContaCorrente(options?: { limit?: number }): Promise<SaldoGlobalContaCorrente> {
  const vazio: SaldoGlobalContaCorrente = {
    totalCredito: 0, totalDebito: 0, clientesComCredito: 0, clientesComDebito: 0,
    totalUsos: 0, qtdUsos: 0, truncado: false,
  };
  const client = getSupabaseClient();
  if (!client) return vazio;

  const limite = options?.limit ?? 20000;
  const { data, error } = await client
    .from("movimento_credito")
    .select("id_cliente, valor, tipo, tipo_evento, id_pendencia")
    .eq("cancelado", false)
    .limit(limite);

  if (error) {
    console.warn("[MovimentoCreditoService] Erro ao calcular saldo global:", error.message);
    return vazio;
  }

  const porCliente = new Map<number, number>();
  let totalUsos = 0;
  let qtdUsos = 0;
  for (const row of data || []) {
    const idCliente = Number(row.id_cliente);
    if (!idCliente) continue;
    const v = Number(row.valor) || 0;
    const atual = porCliente.get(idCliente) ?? 0;
    porCliente.set(idCliente, row.tipo === "CREDITO" ? atual + v : row.tipo === "DEBITO" ? atual - v : atual);

    // Mesmo recorte de listUsosDeCredito: uso vindo de pendência fica de fora
    // porque a própria pendência já o representa.
    if (row.tipo_evento === "USO_PEDIDO" && row.tipo === "DEBITO" && row.id_pendencia === null) {
      totalUsos += v;
      qtdUsos += 1;
    }
  }

  let totalCredito = 0;
  let totalDebito = 0;
  let clientesComCredito = 0;
  let clientesComDebito = 0;
  for (const saldo of porCliente.values()) {
    const arredondado = Math.round(saldo * 100) / 100;
    if (arredondado > 0) { totalCredito += arredondado; clientesComCredito += 1; }
    else if (arredondado < 0) { totalDebito += -arredondado; clientesComDebito += 1; }
  }

  return {
    totalCredito: Math.round(totalCredito * 100) / 100,
    totalDebito: Math.round(totalDebito * 100) / 100,
    clientesComCredito,
    clientesComDebito,
    totalUsos: Math.round(totalUsos * 100) / 100,
    qtdUsos,
    truncado: (data || []).length >= limite,
  };
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
