/**
 * PEDIDO ENTREGUE NÃO PODE SER ALTERADO (02/11/2026, decisão do dono).
 *
 * Em status ENTREGUE ficam recusados, sem exceção para ADM nem para quem tem
 * Editar Proposta Paga: adicionar ou alterar item, o Salvar da proposta, a rota
 * editar-paga, gerar cobrança nova (aba Pagamentos, rotas de cobrança, link de
 * pagamento externo) e o Valor negociado. Para alterar, a pessoa volta o status
 * na Expedição até a Revisão Atendente, o que só é possível antes da NF.
 *
 * Duplicar e Retrabalho continuam: criam pedido novo. O registro bancário de um
 * título faturado que já existia (registrar-boleto-faturado) também continua: é
 * a cobrança normal do faturado, que vence depois da entrega, não cobrança nova.
 *
 * O status vale sempre o LIDO DO BANCO, nunca o que a tela mandou. Falha de
 * leitura nunca vira "liberado": sem conseguir conferir, recusa.
 *
 * Sem import de servidor: o Salvar e a criação de cobrança rodam no navegador e
 * usam a mesma função.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const MENSAGEM_PEDIDO_ENTREGUE =
  "Pedido entregue não pode ser alterado. Para alterar, volte o status na Expedição até a Revisão Atendente (só é possível antes da NF).";

export const CODIGO_PEDIDO_ENTREGUE = "PEDIDO_ENTREGUE";

/** O status é ENTREGUE? Compara sem maiúsculas nem espaços sobrando. */
export function statusEhEntregue(status: string | null | undefined): boolean {
  return String(status ?? "").trim().toUpperCase() === "ENTREGUE";
}

export type RecusaPedidoEntregue = { httpStatus: number; code: string; message: string };

/** `null` = pode seguir; senão, a recusa pronta. Lê `propostas.status_interno` agora. */
export async function recusaPorPedidoEntregue(
  supabase: Pick<SupabaseClient, "from"> | null,
  idInt: number
): Promise<RecusaPedidoEntregue | null> {
  if (!supabase || !Number.isFinite(idInt) || idInt <= 0) {
    return { httpStatus: 500, code: "STATUS_NAO_CONFERIDO", message: "Não foi possível conferir o status do pedido. Nada foi alterado." };
  }
  const { data, error } = await supabase.from("propostas").select("status_interno").eq("id_int", idInt).maybeSingle();
  if (error) {
    return {
      httpStatus: 500,
      code: "STATUS_NAO_CONFERIDO",
      message: `Não foi possível conferir o status do pedido (${error.message}). Nada foi alterado.`
    };
  }
  if (statusEhEntregue((data as { status_interno?: string | null } | null)?.status_interno)) {
    return { httpStatus: 409, code: CODIGO_PEDIDO_ENTREGUE, message: MENSAGEM_PEDIDO_ENTREGUE };
  }
  return null;
}

/** A mesma recusa, a partir do id da cobrança (`pagamentos_v2.id`): lê o pedido dela no banco. */
export async function recusaPorPedidoEntreguePelaCobranca(
  supabase: Pick<SupabaseClient, "from"> | null,
  cobrancaId: string
): Promise<RecusaPedidoEntregue | null> {
  if (!supabase) return recusaPorPedidoEntregue(null, 0);
  const { data, error } = await supabase.from("pagamentos_v2").select("id_int").eq("id", cobrancaId).maybeSingle();
  if (error) {
    return {
      httpStatus: 500,
      code: "STATUS_NAO_CONFERIDO",
      message: `Não foi possível conferir o pedido da cobrança (${error.message}). Nada foi alterado.`
    };
  }
  const idInt = Number((data as { id_int?: number | null } | null)?.id_int);
  // Cobrança sem pedido (ou não encontrada): a rota segue e responde como hoje.
  if (!Number.isFinite(idInt) || idInt <= 0) return null;
  return recusaPorPedidoEntregue(supabase, idInt);
}
