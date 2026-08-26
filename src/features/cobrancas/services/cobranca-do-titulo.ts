/**
 * De qual cobrança de `pagamentos_v2` é este título?
 *
 * Vive num módulo próprio porque a resposta é a MESMA nos dois lados: a rota
 * `cancelar-boleto-faturado` precisa dela para consultar o veredito, e a tela
 * de Contas a Receber precisa dela para devolver a cobrança ao Registro de
 * Recebíveis (`boleto_enviadoo = false`) depois de cancelar o título. Duas
 * cópias divergiriam, e a divergência aqui é silenciosa: a cobrança
 * simplesmente não volta para a lista.
 *
 * Recebe o `SupabaseClient` de quem chama — funciona tanto com o client do
 * navegador quanto com o autenticado por JWT dentro de uma rota.
 *
 * Spec: docs/superpowers/specs/2026-08-25-cancelamento-cobranca-refaturamento-design.md
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFamiliaFaturado } from "@/features/cobrancas/cancelamento-elegibilidade";

export type TituloParaVinculo = {
  id_pagamento: string | null;
  id_int: number | null;
  is_faturado: boolean | null;
};

/**
 * `AMBIGUO` = há título legado sem `id_pagamento` e a proposta tem mais de uma
 * cobrança faturada. Não dá para afirmar de quem é o título, e o custo de
 * errar é mexer na cobrança errada.
 *
 * `null` = não há cobrança-mãe identificável. O título existe sozinho.
 */
export type VinculoCobranca = string | "AMBIGUO" | null;

export async function resolverCobrancaDoTitulo(
  supabase: SupabaseClient,
  titulo: TituloParaVinculo
): Promise<VinculoCobranca> {
  // Via primária: o título aponta para a cobrança.
  if (titulo.id_pagamento) {
    const { data } = await supabase
      .from("pagamentos_v2")
      .select("id")
      .eq("id_pagamento", titulo.id_pagamento)
      .maybeSingle<{ id: string }>();
    if (data?.id) return data.id;
  }

  // Fallback legado: 266 títulos faturados foram gravados sem `id_pagamento`.
  // Sem este ramo, a cobrança deles nunca volta ao Registro de Recebíveis —
  // 11 estão em aberto hoje (25/08/2026).
  if (titulo.is_faturado !== true || titulo.id_int == null) return null;

  const { data: candidatas } = await supabase
    .from("pagamentos_v2")
    .select("id, tipo_cobranca")
    .eq("id_int", titulo.id_int)
    .returns<{ id: string; tipo_cobranca: string | null }[]>();

  const faturadas = (candidatas || []).filter((row) => isFamiliaFaturado(row.tipo_cobranca));
  if (faturadas.length === 1) return faturadas[0].id;
  if (faturadas.length > 1) return "AMBIGUO";
  return null;
}
