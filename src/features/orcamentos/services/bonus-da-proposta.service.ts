import type { SupabaseClient } from "@supabase/supabase-js";

import {
  TIPO_DESCONTO_TABELA_ESPECIAL,
  percentualGravado,
  temPagamentoConfirmado
} from "@/features/orcamentos/lib/bonus-da-proposta";

/**
 * O bônus gravado de uma proposta e se ele já está congelado — as duas leituras
 * de que o formulário e o salvar precisam para aplicar `bonusDaEdicao`.
 *
 * Erro de leitura SOBE: sem saber se a proposta está congelada, o salvar
 * poderia reescrever o bônus de uma venda já paga.
 */
export async function lerBonusGravado(
  client: SupabaseClient,
  idInt: number
): Promise<{ percentualDaLinha: number | null; congelada: boolean }> {
  const [linhaRes, cobrancasRes] = await Promise.all([
    client
      .from("desconto_proposta")
      .select("valor_percentual")
      .eq("id_int", idInt)
      .eq("tipo_desconto", TIPO_DESCONTO_TABELA_ESPECIAL)
      .maybeSingle(),
    client.from("pagamentos_v2").select("status, confirmado, valor, obs_v2").eq("id_int", idInt)
  ]);

  if (linhaRes.error) {
    throw new Error(`Não foi possível ler o bônus gravado da proposta #${idInt}: ${linhaRes.error.message}`);
  }
  if (cobrancasRes.error) {
    throw new Error(`Não foi possível ler os pagamentos da proposta #${idInt}: ${cobrancasRes.error.message}`);
  }

  return {
    percentualDaLinha: percentualGravado(linhaRes.data),
    congelada: temPagamentoConfirmado(cobrancasRes.data)
  };
}

/**
 * Grava o bônus vigente na linha TABELA_ESPECIAL de uma proposta ABERTA.
 *
 * Quem chama garante que ela não está congelada (`lerBonusGravado`). Percentual
 * acima de zero: cria ou atualiza a linha (uma só por proposta — índice único).
 * Zero: apaga a linha, se houver, porque sem linha o bônus já é 0%. Linha que já
 * tem o mesmo percentual não é reescrita.
 */
export async function gravarBonusDaVenda(client: SupabaseClient, idInt: number, percentual: number): Promise<void> {
  const { data: atual, error: erroLeitura } = await client
    .from("desconto_proposta")
    .select("id, valor_percentual")
    .eq("id_int", idInt)
    .eq("tipo_desconto", TIPO_DESCONTO_TABELA_ESPECIAL)
    .maybeSingle();
  if (erroLeitura) {
    throw new Error(`Não foi possível ler o bônus gravado da proposta #${idInt}: ${erroLeitura.message}`);
  }

  if (percentual > 0) {
    if (atual && percentualGravado(atual) === percentual) return;
    const { error } = atual
      ? await client
          .from("desconto_proposta")
          .update({ valor_percentual: percentual, valor_nominal: 0 })
          .eq("id", atual.id)
      : await client.from("desconto_proposta").insert({
          id_int: idInt,
          tipo_desconto: TIPO_DESCONTO_TABELA_ESPECIAL,
          valor_percentual: percentual,
          valor_nominal: 0,
          descricao: "Bonus de tabela especial vigente do cliente, gravado ao salvar"
        });
    if (error) throw new Error(`Não foi possível gravar o bônus da proposta #${idInt}: ${error.message}`);
    return;
  }

  if (atual) {
    const { error } = await client.from("desconto_proposta").delete().eq("id", atual.id);
    if (error) throw new Error(`Não foi possível apagar o bônus da proposta #${idInt}: ${error.message}`);
  }
}
