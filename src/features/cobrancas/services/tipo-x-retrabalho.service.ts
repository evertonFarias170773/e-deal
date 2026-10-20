import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContextoRetrabalhoDoPedido } from "@/features/cobrancas/lib/tipo-x-retrabalho";

/**
 * Le o que a regra E-RETRABALHO x retrabalho precisa (lib/tipo-x-retrabalho.ts):
 * o motivo da copia do pedido e se ele ja teve alguma E-RETRABALHO. Serve ao
 * navegador e as rotas (recebe o cliente de quem chama). `null` quando a leitura
 * falha: quem chama segue, e o gatilho do banco decide.
 */
export async function lerContextoRetrabalhoDoPedido(
  client: SupabaseClient,
  idInt: number
): Promise<ContextoRetrabalhoDoPedido | null> {
  if (!idInt || idInt <= 0) return null;
  const [proposta, retrabalho] = await Promise.all([
    client.from("propostas").select("motivo_copia").eq("id_int", idInt).maybeSingle(),
    client.from("pagamentos_v2").select("id").eq("id_int", idInt).ilike("tipo_cobranca", "e-retrabalho").limit(1)
  ]);
  if (proposta.error || retrabalho.error || !proposta.data) return null;
  return {
    motivoCopia: (proposta.data as { motivo_copia: string | null }).motivo_copia ?? null,
    jaTeveRetrabalho: (retrabalho.data ?? []).length > 0
  };
}
