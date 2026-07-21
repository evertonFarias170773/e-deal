/**
 * conta-corrente.service.ts
 *
 * Leitura de public.conta_corrente_pendencias (fonte operacional do saldo por
 * pendência da nova Conta Corrente — ver docs/business/CONTA-CORRENTE-FASE-1-PREPARACAO.md).
 *
 * Escrita não ocorre aqui: toda mudança de estado passa pelas RPCs
 * cc_abrir_pendencia / cc_usar_pendencia / cc_encerrar_pendencia, chamadas a
 * partir das rotas server-side (src/app/api/conta-corrente/*, editar-paga,
 * resolver-diferenca, usar-credito, pagamento-combinado, confirmar,
 * cancelar-boleto, cancelar-externo).
 */

import { getSupabaseClient } from "@/lib/supabase/client";

export type ContaCorrentePendenciaDirecao = "FAVOR_CLIENTE" | "FAVOR_EMPRESA";
export type ContaCorrentePendenciaMotivo =
  | "FRETE" | "PRODUTO_INCLUIDO" | "PRODUTO_REMOVIDO" | "PRODUTO_TROCADO" | "SERVICO_ALTERADO" | "OUTRO";
export type ContaCorrentePendenciaStatus =
  | "ABERTA" | "PARCIALMENTE_RESOLVIDA" | "RESOLVIDA" | "CANCELADA";

export type ContaCorrentePendencia = {
  id: number;
  id_int: number;
  id_cliente: number;
  direcao: ContaCorrentePendenciaDirecao;
  motivo: ContaCorrentePendenciaMotivo;
  valor_original: number;
  valor_saldo: number;
  valor_reservado: number;
  status: ContaCorrentePendenciaStatus;
  chave_evento: string;
  observacao: string | null;
  created_at: string;
  created_by: string;
  atualizado_em: string | null;
  encerrado_em: string | null;
  encerrado_por: string | null;
  motivo_encerramento: string | null;
};

const STATUS_UTILIZAVEL: ContaCorrentePendenciaStatus[] = ["ABERTA", "PARCIALMENTE_RESOLVIDA"];

/** Pendências (qualquer status) de uma proposta específica. */
export async function listPendenciasByProposta(idInt: number): Promise<ContaCorrentePendencia[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("conta_corrente_pendencias")
    .select("*")
    .eq("id_int", idInt)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[ContaCorrenteService] Erro ao listar pendências da proposta:", error.message);
    return [];
  }
  return (data || []) as ContaCorrentePendencia[];
}

/** Pendências utilizáveis (ABERTA/PARCIALMENTE_RESOLVIDA) de um cliente, mais antigas primeiro (FIFO). */
export async function listPendenciasUtilizaveis(
  idCliente: number,
  direcao: ContaCorrentePendenciaDirecao
): Promise<ContaCorrentePendencia[]> {
  const client = getSupabaseClient();
  if (!client || !idCliente) return [];
  const { data, error } = await client
    .from("conta_corrente_pendencias")
    .select("*")
    .eq("id_cliente", idCliente)
    .eq("direcao", direcao)
    .in("status", STATUS_UTILIZAVEL)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[ContaCorrenteService] Erro ao listar pendências utilizáveis:", error.message);
    return [];
  }
  return (data || []) as ContaCorrentePendencia[];
}

/** Todas as pendências de um cliente (extrato — qualquer status). */
export async function listPendenciasCliente(idCliente: number): Promise<ContaCorrentePendencia[]> {
  const client = getSupabaseClient();
  if (!client || !idCliente) return [];
  const { data, error } = await client
    .from("conta_corrente_pendencias")
    .select("*")
    .eq("id_cliente", idCliente)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[ContaCorrenteService] Erro ao listar pendências do cliente:", error.message);
    return [];
  }
  return (data || []) as ContaCorrentePendencia[];
}

/**
 * Ajuste manual avulso da Conta Corrente (origem=AJUSTE em movimento_credito,
 * sem proposta e sem pendência vinculada — lançado pelo modal do cadastro via
 * mc_ajuste_avulso_criar). NÃO é uma pendência: é um lançamento direto no saldo.
 *
 * Lê da MESMA fonte oficial do saldo (public.movimento_credito) — não cria
 * estrutura paralela nem duplica saldo. Só materializa, para exibição, os
 * lançamentos manuais que hoje entram no saldo mas não apareciam na listagem
 * de pendências (que lê apenas conta_corrente_pendencias).
 */
export type AjusteManualConta = {
  id: number;
  id_cliente: number;
  valor: number;
  tipo: "CREDITO" | "DEBITO";
  observacao: string | null;
  created_at: string;
  created_by: string | null;
  cancelado: boolean;
};

/** Lançamentos manuais avulsos (origem=AJUSTE, sem pendência), não cancelados. */
export async function listAjustesManuais(options?: { limit?: number }): Promise<AjusteManualConta[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  let query = client
    .from("movimento_credito")
    .select("id, id_cliente, valor, tipo, observacao, created_at, created_by, cancelado")
    .eq("origem", "AJUSTE")
    .is("id_pendencia", null)
    .eq("cancelado", false)
    .order("created_at", { ascending: false });
  if (options?.limit !== undefined) {
    query = query.limit(options.limit);
  }
  const { data, error } = await query;
  if (error) {
    console.warn("[ContaCorrenteService] Erro ao listar ajustes manuais:", error.message);
    return [];
  }
  return (data || []).map((r) => ({
    id: Number(r.id),
    id_cliente: Number(r.id_cliente),
    valor: Number(r.valor) || 0,
    tipo: r.tipo === "DEBITO" ? "DEBITO" : "CREDITO",
    observacao: r.observacao ?? null,
    created_at: r.created_at,
    created_by: r.created_by ?? null,
    cancelado: Boolean(r.cancelado),
  }));
}

/** Fila financeira: todas as pendências (para a tela dedicada de Conta Corrente). */
export async function listAllPendencias(options?: { limit?: number; offset?: number }): Promise<{
  data: ContaCorrentePendencia[];
  count: number;
}> {
  const client = getSupabaseClient();
  if (!client) return { data: [], count: 0 };
  let query = client
    .from("conta_corrente_pendencias")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });
  if (options?.limit !== undefined) {
    const offset = options.offset ?? 0;
    query = query.range(offset, offset + options.limit - 1);
  }
  const { data, error, count } = await query;
  if (error) {
    console.warn("[ContaCorrenteService] Erro ao listar todas as pendências:", error.message);
    return { data: [], count: 0 };
  }
  return { data: (data || []) as ContaCorrentePendencia[], count: count ?? 0 };
}
