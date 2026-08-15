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
 * Extrato COMPLETO da conta corrente — todo `movimento_credito` não cancelado,
 * sem recorte por origem.
 *
 * POR QUE EXISTE: `listAjustesManuais` e `listUsosDeCredito` filtram cada uma
 * a sua fatia, e a tela mostrava só a união das duas. Medido em 15/08/2026:
 * 52 dos 71 lançamentos apareciam — ficavam de fora 12 débitos manuais, 3
 * créditos manuais, 3 lançamentos de sistema e 1 ESTORNO. A lista não fechava
 * com os cards, que sempre leram a razão inteira.
 */
export type TipoLancamentoConta = "AJUSTE" | "USO" | "PENDENCIA" | "ESTORNO" | "LEGADO";

export const ROTULO_TIPO_LANCAMENTO: Record<TipoLancamentoConta, string> = {
  AJUSTE: "Ajuste manual",
  USO: "Uso de crédito",
  PENDENCIA: "Pendência",
  ESTORNO: "Estorno",
  LEGADO: "Lançamento legado",
};

export type LancamentoContaCorrente = {
  id: number;
  id_cliente: number;
  tipo: "CREDITO" | "DEBITO";
  valor: number;
  /** Crédito positivo, débito negativo — pronto para somar. */
  valorComSinal: number;
  categoria: TipoLancamentoConta;
  observacao: string | null;
  created_at: string;
  created_by: string | null;
  /** Proposta de origem do lançamento. */
  id_int: number | null;
  /** Proposta onde o crédito foi aplicado (uso). */
  id_int_destino: number | null;
  id_pendencia: number | null;
};

/**
 * Ordem importa: ESTORNO antes de tudo (é um evento próprio), uso avulso
 * antes de pendência, e o que sobrar com origem AJUSTE é ajuste manual.
 * O resto é legado — anterior às RPCs, sem `tipo_evento`.
 */
function classificarLancamento(row: {
  origem: string | null;
  tipo_evento: string | null;
  id_pendencia: number | null;
}): TipoLancamentoConta {
  if (row.tipo_evento === "ESTORNO") return "ESTORNO";
  if (row.tipo_evento === "USO_PEDIDO" && row.id_pendencia === null) return "USO";
  if (row.id_pendencia !== null) return "PENDENCIA";
  if (row.origem === "AJUSTE") return "AJUSTE";
  return "LEGADO";
}

export async function listExtratoContaCorrente(options?: { limit?: number }): Promise<LancamentoContaCorrente[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("movimento_credito")
    .select("id, id_cliente, valor, tipo, origem, tipo_evento, observacao, created_at, created_by, id_int, id_int_destino, id_pendencia")
    .eq("cancelado", false)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 5000);

  if (error) {
    console.warn("[ContaCorrenteService] Erro ao listar o extrato:", error.message);
    return [];
  }

  return (data || []).map((r) => {
    const valor = Number(r.valor) || 0;
    const tipo: "CREDITO" | "DEBITO" = r.tipo === "DEBITO" ? "DEBITO" : "CREDITO";
    const idPendencia = r.id_pendencia === null || r.id_pendencia === undefined ? null : Number(r.id_pendencia);
    return {
      id: Number(r.id),
      id_cliente: Number(r.id_cliente),
      tipo,
      valor,
      valorComSinal: tipo === "CREDITO" ? valor : -valor,
      categoria: classificarLancamento({ origem: r.origem, tipo_evento: r.tipo_evento, id_pendencia: idPendencia }),
      observacao: r.observacao ?? null,
      created_at: r.created_at,
      created_by: r.created_by ?? null,
      id_int: r.id_int === null || r.id_int === undefined ? null : Number(r.id_int),
      id_int_destino: r.id_int_destino === null || r.id_int_destino === undefined ? null : Number(r.id_int_destino),
      id_pendencia: idPendencia,
    };
  });
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
