import type { PedidoProducaoListItem } from "../types";

/**
 * Busca a lista de pedidos em produção.
 * Retorna array vazio nesta etapa para transição segura de mock para o Supabase.
 */
export async function listarPedidosProducao(): Promise<PedidoProducaoListItem[]> {
  return [];
}
