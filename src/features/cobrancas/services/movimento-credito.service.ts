/**
 * movimento-credito.service.ts
 *
 * Service oficial para leitura e escrita em public.movimento_credito.
 *
 * Regras de negócio:
 * - Saldo real = SUM(CREDITO) - SUM(CONSUMO) - SUM(DEVOLUCAO) dos registros não cancelados
 * - DEBITO e BONIFICACAO não afetam o saldo de crédito do cliente
 * - id_int identifica a proposta de origem (nullable — nem todo movimento vem de proposta)
 * - created_by deve ser sempre preenchido com o email/id do usuário operando
 * - NUNCA alterar registros já existentes — apenas cancelar (cancelado=true)
 *
 * Estrutura real da tabela (12 colunas, confirmada em diagnóstico 2026-07-16):
 *   id, id_cliente, id_int, valor, tipo, origem, created_at,
 *   observacao, created_by, cancelado, cancelado_em, cancelado_por
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import type { MovimentoCredito, MovimentoCreditoTipo } from "@/features/cobrancas/types";

// ---------------------------------------------------------------------------
// Tipos de parâmetros
// ---------------------------------------------------------------------------

export type RegistrarMovimentoParams = {
  /** FK para clientes.id_cliente */
  id_cliente: number;
  /** FK para propostas.id_int — pode ser null quando não originado de proposta */
  id_int: number | null;
  /** Valor do movimento — sempre positivo; o tipo determina o sinal semântico */
  valor: number;
  tipo: MovimentoCreditoTipo;
  /** Origem legível, ex: "PROPOSTA_ALTERADA", "CONSUMO_CREDITO", "MANUAL" */
  origem?: string;
  /** Observação livre para auditoria */
  observacao?: string;
  /** Email ou ID do usuário responsável — obrigatório */
  created_by: string;
};

export type RegistrarMovimentoResult = {
  success: boolean;
  id?: number;
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// Cálculo de saldo
// ---------------------------------------------------------------------------

/**
 * Calcula o saldo de crédito disponível de um cliente diretamente em movimento_credito.
 *
 * Semântica dos tipos:
 *   CREDITO    → soma positiva (cliente ganhou crédito)
 *   CONSUMO    → subtrai (cliente usou crédito)
 *   DEVOLUCAO  → subtrai (empresa devolveu em dinheiro)
 *   DEBITO     → NÃO afeta saldo de crédito
 *   BONIFICACAO → NÃO afeta saldo de crédito
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
    switch (row.tipo as MovimentoCreditoTipo) {
      case "CREDITO":
        saldo += v;
        break;
      case "CONSUMO":
      case "DEVOLUCAO":
        saldo -= v;
        break;
      // DEBITO e BONIFICACAO não afetam saldo de crédito
    }
  }

  return Math.max(0, Math.round(saldo * 100) / 100);
}

// ---------------------------------------------------------------------------
// Registro de movimentos
// ---------------------------------------------------------------------------

/**
 * Registra um movimento de crédito na tabela movimento_credito.
 *
 * Validações:
 * - valor deve ser > 0
 * - id_cliente obrigatório
 * - created_by obrigatório
 */
export async function registrarMovimento(
  params: RegistrarMovimentoParams
): Promise<RegistrarMovimentoResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase não configurado." };
  }

  if (!params.id_cliente || params.id_cliente <= 0) {
    return { success: false, errorMessage: "id_cliente inválido." };
  }

  if (!params.valor || params.valor <= 0) {
    return { success: false, errorMessage: "Valor do movimento deve ser maior que zero." };
  }

  if (!params.created_by) {
    return { success: false, errorMessage: "created_by é obrigatório para rastreabilidade." };
  }

  // ── Idempotência: janela de 5 minutos ──────────────────────────────────────
  // Evita duplicatas por duplo clique, retry ou reabertura do modal
  if (params.id_int != null) {
    const cincoMinAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: existente } = await client
      .from("movimento_credito")
      .select("id")
      .eq("id_int", params.id_int)
      .eq("id_cliente", params.id_cliente)
      .eq("tipo", params.tipo)
      .eq("cancelado", false)
      .gte("created_at", cincoMinAtras)
      .limit(1)
      .maybeSingle();

    if (existente) {
      console.info(`[MovimentoCreditoService] Movimento idempotente detectado (id=${existente.id}) para proposta #${params.id_int}.`);
      return { success: true, id: existente.id };
    }
  }

  const { data, error } = await client
    .from("movimento_credito")
    .insert({
      id_cliente: params.id_cliente,
      id_int: params.id_int ?? null,
      valor: params.valor,
      tipo: params.tipo,
      origem: params.origem ?? "SISTEMA",
      observacao: params.observacao ?? null,
      created_by: params.created_by,
      cancelado: false,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[MovimentoCreditoService] Erro ao registrar movimento:", error.message);
    return { success: false, errorMessage: error.message };
  }

  return { success: true, id: data?.id };
}

// ---------------------------------------------------------------------------
// Helpers semânticos (wrappers sobre registrarMovimento)
// ---------------------------------------------------------------------------

/** Registra crédito ao cliente quando novo total da proposta é menor que o valor pago. */
export async function registrarCredito(
  idCliente: number,
  idInt: number,
  valor: number,
  createdBy: string,
  obs?: string
): Promise<RegistrarMovimentoResult> {
  return registrarMovimento({
    id_cliente: idCliente,
    id_int: idInt,
    valor,
    tipo: "CREDITO",
    origem: "PROPOSTA_ALTERADA",
    observacao: obs ?? `Crédito gerado por alteração da proposta #${idInt}`,
    created_by: createdBy,
  });
}

/** Registra consumo de crédito quando cliente usa E-Credito como pagamento. */
export async function registrarConsumo(
  idCliente: number,
  idInt: number | null,
  valor: number,
  createdBy: string,
  obs?: string
): Promise<RegistrarMovimentoResult> {
  return registrarMovimento({
    id_cliente: idCliente,
    id_int: idInt,
    valor,
    tipo: "CONSUMO",
    origem: "CONSUMO_CREDITO",
    observacao: obs ?? `Crédito consumido como pagamento${idInt ? ` da proposta #${idInt}` : ""}`,
    created_by: createdBy,
  });
}

/** Registra devolução ao cliente (sem efeito financeiro direto, apenas registro). */
export async function registrarDevolucao(
  idCliente: number,
  idInt: number,
  valor: number,
  createdBy: string,
  obs?: string
): Promise<RegistrarMovimentoResult> {
  return registrarMovimento({
    id_cliente: idCliente,
    id_int: idInt,
    valor,
    tipo: "DEVOLUCAO",
    origem: "PROPOSTA_ALTERADA",
    observacao: obs ?? `Devolução ao cliente referente à proposta #${idInt}`,
    created_by: createdBy,
  });
}

/** Registra bonificação (absorção comercial — não afeta saldo). */
export async function registrarBonificacao(
  idCliente: number,
  idInt: number,
  valor: number,
  createdBy: string,
  obs?: string
): Promise<RegistrarMovimentoResult> {
  return registrarMovimento({
    id_cliente: idCliente,
    id_int: idInt,
    valor,
    tipo: "BONIFICACAO",
    origem: "PROPOSTA_ALTERADA",
    observacao: obs ?? `Bonificação comercial referente à proposta #${idInt}`,
    created_by: createdBy,
  });
}

/** Registra débito futuro quando novo total é maior e não será cobrado agora. */
export async function registrarDebitoFuturo(
  idCliente: number,
  idInt: number,
  valor: number,
  createdBy: string,
  obs?: string
): Promise<RegistrarMovimentoResult> {
  return registrarMovimento({
    id_cliente: idCliente,
    id_int: idInt,
    valor,
    tipo: "DEBITO",
    origem: "PROPOSTA_ALTERADA",
    observacao: obs ?? `Débito futuro referente à proposta #${idInt}`,
    created_by: createdBy,
  });
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
