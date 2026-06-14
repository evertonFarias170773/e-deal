import { getSupabaseClient } from "@/lib/supabase/client";
import type { PedidoProducaoListItem, PedidoStatus } from "../types";

/**
 * Busca a lista de pedidos em produção.
 * Retorna array vazio nesta etapa para transição segura de mock para o Supabase.
 */
export async function listarPedidosProducao(): Promise<PedidoProducaoListItem[]> {
  return [];
}

/**
 * Busca a lista de pedidos operacionais reais do Supabase (public.pedidos).
 * Enriquece opcionalmente com dados da tabela public.propostas (cliente, vendedor, empresa).
 * Não quebra caso a consulta de propostas falhe ou seja bloqueada por RLS.
 */
export async function listarPedidosOperacionais(): Promise<PedidoProducaoListItem[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[pedidos-producao.service] Supabase client não inicializado.");
    return [];
  }

  // 1. Buscar todos os registros em public.pedidos ordenados por data_pedido desc nulls last
  const { data: pedidosRows, error: pedidosError } = await client
    .from("pedidos")
    .select(`
      id,
      id_int,
      id_cliente,
      id_vendedor,
      status_pedido,
      status_pagamento,
      status_arte,
      status_producao,
      status_expedicao,
      descricao,
      valor_total,
      forma_pagamento,
      data_pedido,
      data_aprovacao_arte,
      data_termino,
      codigo_rastreamento,
      obs
    `)
    .order("data_pedido", { ascending: false, nullsFirst: false });

  if (pedidosError || !pedidosRows) {
    console.error("[pedidos-producao.service] Erro ao buscar pedidos operacionais:", pedidosError);
    return [];
  }

  if (pedidosRows.length === 0) {
    return [];
  }

  // 2. Extrair os id_int válidos
  const idInts = pedidosRows
    .map(p => p.id_int)
    .filter((id): id is number => id !== null && id !== undefined);

  // 3. Buscar os dados das propostas vinculadas para preencher clienteNome, vendedor, empresa
  const propostasMap = new Map<number, { cliente: string; vendedor: string; empresa: string; id_cliente: number | null }>();
  if (idInts.length > 0) {
    try {
      const { data: propostasRows, error: propostasError } = await client
        .from("propostas")
        .select("id_int, cliente, vendedor, empresa, id_cliente")
        .in("id_int", idInts);

      if (propostasError) {
        console.warn("[pedidos-producao.service] Aviso ao buscar propostas vinculadas (possível restrição RLS):", propostasError.message);
      } else if (propostasRows) {
        propostasRows.forEach(prop => {
          if (prop.id_int !== null && prop.id_int !== undefined) {
            propostasMap.set(Number(prop.id_int), {
              cliente: prop.cliente || "",
              vendedor: prop.vendedor || "",
              empresa: prop.empresa || "",
              id_cliente: prop.id_cliente !== null ? Number(prop.id_cliente) : null
            });
          }
        });
      }
    } catch (e) {
      console.warn("[pedidos-producao.service] Falha silenciosa ao obter propostas vinculadas:", e);
    }
  }

  // 4. Mapear os pedidos no formato PedidoProducaoListItem esperado pelo frontend
  return pedidosRows.map(row => {
    const idInt = row.id_int !== null && row.id_int !== undefined ? Number(row.id_int) : 0;
    const proposta = propostasMap.get(idInt);

    return {
      id: row.id,
      id_int: idInt,
      clienteNome: proposta?.cliente || row.descricao || `Pedido #${idInt}`,
      contatoNome: "",
      idCliente: proposta?.id_cliente !== null && proposta?.id_cliente !== undefined ? proposta.id_cliente : 0,
      empresa: proposta?.empresa || "Ideal Gráfica",
      vendedor: proposta?.vendedor || "Não atribuído",
      dataPedido: row.data_pedido || new Date().toISOString(),
      dataPrevistaEntrega: row.data_termino || row.data_pedido || new Date().toISOString(),
      statusPedido: (row.status_pedido || "BOLETIM_FINALIZADO") as PedidoStatus,
      status_pedido: row.status_pedido || "BOLETIM_FINALIZADO",
      status_pagamento: row.status_pagamento || "APROVADO",
      status_arte: row.status_arte || "PENDENTE",
      status_producao: row.status_producao || "BLOQUEADO",
      status_expedicao: row.status_expedicao || "BLOQUEADO",
      urgente: false,
      formaPagamento: row.forma_pagamento || "",
      valorTotal: row.valor_total !== null && row.valor_total !== undefined ? Number(row.valor_total) : 0,
      pesoTeorico: 0,
      obs: row.obs || "",
      produtos: [],
      modelos: []
    } as PedidoProducaoListItem;
  });
}
