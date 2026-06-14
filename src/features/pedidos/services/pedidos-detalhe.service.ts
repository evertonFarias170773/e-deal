import { getSupabaseClient } from "@/lib/supabase/client";
import type { PedidoProducaoListItem, PedidoStatus } from "../types";

/**
 * Busca um pedido operacional na tabela public.pedidos por UUID (id) ou id_int.
 * Enriquece opcionalmente com dados da proposta vinculada (cliente, vendedor, empresa).
 * Tolera falhas e bloqueios de RLS de propostas sem omitir o pedido.
 */
export async function obterPedidoOperacionalPorIdOuIdInt(param: string | number): Promise<PedidoProducaoListItem | null> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[pedidos-detalhe.service] Supabase client não inicializado.");
    return null;
  }

  let query = client.from("pedidos").select(`
    id,
    id_int,
    id_cliente,
    id_vendedor,
    id_endereco,
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
    link_pagamento,
    nota_fiscal_url,
    obs
  `);

  const paramStr = String(param).trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paramStr);

  if (isUuid) {
    query = query.eq("id", paramStr);
  } else {
    const cleanNumStr = paramStr.replace("#", "");
    const idInt = Number(cleanNumStr);
    if (!isNaN(idInt)) {
      query = query.eq("id_int", idInt);
    } else {
      console.warn("[pedidos-detalhe.service] Parâmetro de busca inválido:", param);
      return null;
    }
  }

  const { data: row, error } = await query.maybeSingle();

  if (error) {
    console.error("[pedidos-detalhe.service] Erro ao obter pedido operacional:", error);
    return null;
  }

  if (!row) {
    return null;
  }

  // Enriquecer, se possível, com public.propostas pelo id_int
  let clienteNome = row.descricao || `Pedido #${row.id_int}`;
  let vendedor = "Não atribuído";
  let empresa = "Ideal Gráfica";
  const dataPedido = row.data_pedido || new Date().toISOString();
  let idCliente = 0;

  if (row.id_int !== null && row.id_int !== undefined) {
    try {
      const { data: propostaRow, error: propostaError } = await client
        .from("propostas")
        .select("cliente, vendedor, empresa, id_cliente")
        .eq("id_int", row.id_int)
        .maybeSingle();

      if (propostaError) {
         console.warn("[pedidos-detalhe.service] Erro ao buscar proposta para enriquecimento (não-fatal):", propostaError.message);
      } else if (propostaRow) {
        clienteNome = propostaRow.cliente || clienteNome;
        vendedor = propostaRow.vendedor || vendedor;
        empresa = propostaRow.empresa || empresa;
        idCliente = propostaRow.id_cliente !== null ? Number(propostaRow.id_cliente) : 0;
      }
    } catch (e) {
      console.warn("[pedidos-detalhe.service] Falha ao enriquecer dados do pedido:", e);
    }
  }

  return {
    id: row.id,
    id_int: row.id_int !== null ? Number(row.id_int) : 0,
    clienteNome,
    contatoNome: "",
    idCliente,
    empresa,
    vendedor,
    dataPedido,
    dataPrevistaEntrega: row.data_termino || row.data_pedido || new Date().toISOString(),
    statusPedido: (row.status_pedido || "BOLETIM_FINALIZADO") as PedidoStatus,
    status_pedido: row.status_pedido || "BOLETIM_FINALIZADO",
    status_pagamento: row.status_pagamento || "APROVADO",
    status_arte: row.status_arte || "PENDENTE",
    status_producao: row.status_producao || "BLOQUEADO",
    status_expedicao: row.status_expedicao || "BLOQUEADO",
    urgente: false,
    formaPagamento: row.forma_pagamento || "",
    valorTotal: row.valor_total !== null ? Number(row.valor_total) : 0,
    pesoTeorico: 0,
    obs: row.obs || "",
    produtos: [],
    modelos: []
  } as PedidoProducaoListItem;
}
