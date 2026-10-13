import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CODIGO_LEITURA_NOTAS_FALHOU,
  CODIGO_NOTA_EMITIDA,
  mensagemNotaImpedeDevolucao,
  type NotaDoPedido
} from "@/features/orcamentos/lib/nota-impede-devolucao";

/**
 * A checagem de nota emitida, no SERVIDOR (13/10/2026). UM helper, chamado pelas duas
 * portas que devolvem o pedido ao atendente: a rota `retirar-producao` e a rota
 * `devolver-atendente`. A regra esta em `lib/nota-impede-devolucao.ts`.
 *
 * So LE `notas_fiscais` (NF-e) e `notas_servico` (NFS-e), pelo `id_int` do pedido.
 * Falha de leitura NUNCA vira "nao ha nota": sem conseguir conferir, recusa.
 */

export type RecusaPorNota = { success: false; httpStatus: number; code: string; message: string };

type LinhaNfe = { numero_nf: string | number | null; status: string | null; ambiente: string | null };
type LinhaNfse = { numero_nfse: string | number | null; status: string | null; ambiente: string | null };

const texto = (v: string | number | null) => (v === null || v === undefined ? null : String(v));

/** `null` = nenhuma nota trava; senao, a recusa pronta para a rota devolver. */
export async function recusaPorNotaEmitida(supabase: SupabaseClient, idInt: number): Promise<RecusaPorNota | null> {
  const [nfe, nfse] = await Promise.all([
    supabase.from("notas_fiscais").select("numero_nf, status, ambiente").eq("id_int", idInt),
    supabase.from("notas_servico").select("numero_nfse, status, ambiente").eq("id_int", idInt)
  ]);

  const erro = nfe.error ?? nfse.error;
  if (erro) {
    return {
      success: false,
      httpStatus: 500,
      code: CODIGO_LEITURA_NOTAS_FALHOU,
      message: `Não foi possível conferir as notas fiscais do pedido (${erro.message}). Nada foi alterado.`
    };
  }

  const notas: NotaDoPedido[] = [
    ...((nfe.data ?? []) as LinhaNfe[]).map((l): NotaDoPedido => ({ tipo: "NFE", numero: texto(l.numero_nf), status: l.status, ambiente: l.ambiente })),
    ...((nfse.data ?? []) as LinhaNfse[]).map((l): NotaDoPedido => ({ tipo: "NFSE", numero: texto(l.numero_nfse), status: l.status, ambiente: l.ambiente }))
  ];

  const message = mensagemNotaImpedeDevolucao(notas);
  return message ? { success: false, httpStatus: 409, code: CODIGO_NOTA_EMITIDA, message } : null;
}
