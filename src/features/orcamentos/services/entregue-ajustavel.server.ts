import type { SupabaseClient } from "@supabase/supabase-js";
import { lerNotasDoPedido } from "@/features/orcamentos/services/nota-impede-devolucao.server";
import {
  avaliarAjusteEntregue,
  type AvaliacaoAjusteEntregue,
  type CobrancaParaAjusteEntregue,
  type TituloParaAjusteEntregue
} from "@/features/orcamentos/lib/entregue-ajustavel";

/**
 * Coletor do banco para `lib/entregue-ajustavel.ts` (23/11/2026). Só LÊ:
 * `notas_fiscais` e `notas_servico` (por `lerNotasDoPedido`), `boletos` e
 * `pagamentos_v2`, todos pelo `id_int` do pedido. Falha de leitura NUNCA vira
 * "pode ajustar": devolve erro e quem chama recusa.
 */
export async function avaliarAjusteEntregueNoBanco(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  idInt: number
): Promise<{ ok: true; avaliacao: AvaliacaoAjusteEntregue } | { ok: false; erro: string }> {
  const [notas, titulos, cobrancas] = await Promise.all([
    lerNotasDoPedido(supabase as SupabaseClient, idInt),
    supabase.from("boletos").select("status, parcela, total_parcelas, deposito_conta").eq("id_int", idInt),
    supabase.from("pagamentos_v2").select("id_pagamento, tipo_cobranca, status, paid_at").eq("id_int", idInt)
  ]);

  if (!notas.ok) return { ok: false, erro: `notas fiscais: ${notas.erro}` };
  if (titulos.error) return { ok: false, erro: `títulos: ${titulos.error.message}` };
  if (cobrancas.error) return { ok: false, erro: `cobranças: ${cobrancas.error.message}` };

  return {
    ok: true,
    avaliacao: avaliarAjusteEntregue({
      notas: notas.notas,
      titulos: (titulos.data ?? []) as TituloParaAjusteEntregue[],
      cobrancas: (cobrancas.data ?? []) as CobrancaParaAjusteEntregue[]
    })
  };
}
