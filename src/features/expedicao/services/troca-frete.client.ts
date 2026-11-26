import { getSupabaseClient } from "@/lib/supabase/client";
import type { FormaCobrancaTroca } from "../lib/abono-frete";
import { lerSituacaoDasTrocas, textoDoErroDaTroca, type SituacaoTrocaFrete } from "../lib/troca-frete";

/**
 * Cliente da diferença de frete da troca de transportadora cobrando
 * (26/11/2026). As três funções são do banco: quem decide é ele.
 */

export async function lerSituacaoDasTrocasDeFrete(idInt: number): Promise<SituacaoTrocaFrete[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client.rpc("exp_troca_frete_situacao", { p_id_int: idInt });
  if (error) {
    console.warn("[troca-frete] Falha ao ler a diferença de frete das trocas:", error.message);
    return [];
  }
  return lerSituacaoDasTrocas(data);
}

/** Cria a próxima cobrança da troca (a anterior foi cancelada), pela forma escolhida. */
export async function cobrarDeNovoATroca(
  idRecotacao: number,
  tipo: FormaCobrancaTroca
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };
  const { data, error } = await client.rpc("exp_troca_frete_cobrar", { p_id_recotacao: idRecotacao, p_tipo_cobranca: tipo });
  if (error) {
    if (/^PERM:/.test(error.message)) return { success: false, error: "Você não tem a permissão de criar cobrança (cobrancas.create)." };
    return { success: false, error: textoDoErroDaTroca(error.message) };
  }
  const id = (data as { id?: string } | null)?.id;
  return id ? { success: true, id } : { success: false, error: "O banco não devolveu a cobrança criada." };
}

/** Abono da diferença (só administrador, sem cobrança viva). */
export async function abonarDiferencaDaTroca(
  idRecotacao: number,
  motivo: string
): Promise<{ success: true } | { success: false; error: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase não inicializado." };
  const { error } = await client.rpc("exp_troca_frete_abonar", { p_id_recotacao: idRecotacao, p_motivo: motivo });
  if (error) return { success: false, error: textoDoErroDaTroca(error.message) };
  return { success: true };
}
