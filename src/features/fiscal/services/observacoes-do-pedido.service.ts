import { getSupabaseClient } from "@/lib/supabase/client";
import { observacaoLimpa } from "@/features/fiscal/lib/observacao-nota-fiscal";

/**
 * As duas observações do pedido para quem fatura (11/11/2026). SÓ `select`.
 *
 *   paraNota  `propostas.obs_nota_fiscal` - vai para as Informações Complementares.
 *   interna   `propostas.obs_proposta` - bloco "10. Observações e Condições",
 *             interno: NÃO vai para a nota, só é mostrado (selo) para a Edina
 *             não precisar abrir cada orçamento.
 *
 * Leitura à parte, em lote, como o aviso de remessa: a consulta que monta a Fila
 * não muda. Devolve `null` se não der para ler; quem chama esconde os selos.
 */
export type ObservacoesDoPedido = { paraNota: string; interna: string };

const TAMANHO_DO_LOTE = 200;

export async function lerObservacoesDosPedidos(idsInt: readonly number[]): Promise<Map<number, ObservacoesDoPedido> | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const ids = Array.from(new Set(idsInt.filter((id) => Number.isFinite(id) && id > 0)));
  const porPedido = new Map<number, ObservacoesDoPedido>();
  for (let i = 0; i < ids.length; i += TAMANHO_DO_LOTE) {
    const fatia = ids.slice(i, i + TAMANHO_DO_LOTE);
    const { data, error } = await supabase.from("propostas").select("id_int, obs_nota_fiscal, obs_proposta").in("id_int", fatia);
    if (error) {
      console.warn("[observacoes-do-pedido] Não foi possível ler as observações:", error.message);
      return null;
    }
    for (const linha of (data ?? []) as { id_int: number; obs_nota_fiscal: string | null; obs_proposta: string | null }[]) {
      const obs = { paraNota: observacaoLimpa(linha.obs_nota_fiscal), interna: observacaoLimpa(linha.obs_proposta) };
      if (obs.paraNota || obs.interna) porPedido.set(Number(linha.id_int), obs);
    }
  }
  return porPedido;
}
