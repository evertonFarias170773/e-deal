import type { SupabaseClient } from "@supabase/supabase-js";

import { totaisDaProposta } from "@/features/orcamentos/lib/total-da-proposta";
import {
  TIPO_DESCONTO_TABELA_ESPECIAL,
  bonusDaProposta,
  percentualGravado
} from "@/features/orcamentos/lib/bonus-da-proposta";

/**
 * Totais da proposta no servidor — lendo as linhas do banco.
 *
 * NÃO TEM REGRA PRÓPRIA. A conta mora em `totaisDaProposta`
 * (lib/total-da-proposta.ts), a única do sistema, a mesma do "Salvar
 * alterações". Este arquivo só busca itens, bônus e desconto geral e entrega
 * para ela. O bônus é o gravado na proposta (TABELA_ESPECIAL) e, sem ele, 0 —
 * ver `bonusDaProposta`.
 *
 * Nasceu em 27/09/2026 na área do cliente (`/p/<token>`) e em 28/09 passou a
 * servir também a lista rápida (`/api/pedidos/lotes-em-massa`). Em 29/09 a
 * conta saiu daqui para a função única, que a lista de propostas e a API da
 * Lisiton também usam.
 *
 * Devolve centavos. Nulo quando a proposta não tem item ativo: nesse caso o
 * ERP cai em `valor_total`, e não há o que calcular.
 */

export type TotaisProposta = {
  /** `propostas.valor`: subtotal dos itens com o bônus, SEM o desconto geral. */
  subtotalProdutosCents: number;
  /** `propostas.valor_total`: subtotal - desconto geral + frete. */
  totalCents: number;
};

type PropostaParaTotais = {
  id_int: number;
  id_cliente: number | null;
  valor_frete: number | null;
};

const centavos = (valor: number): number => Math.round((Number(valor) || 0) * 100);

export async function calcularTotaisPelaRegraDaTela(
  client: SupabaseClient,
  proposta: PropostaParaTotais
): Promise<TotaisProposta | null> {
  const { data: itens, error: itensErr } = await client
    .from("produtos_proposta")
    .select("valor_unt, qtd, fixo, status_item")
    .eq("id_int", proposta.id_int);
  if (itensErr) {
    console.error(`[totais-proposta] itens da proposta ${proposta.id_int} nao lidos:`, itensErr.message);
    return null;
  }

  // O desconto geral e o bônus gravado na venda (TABELA_ESPECIAL) numa leitura só.
  const { data: descontos } = await client
    .from("desconto_proposta")
    .select("tipo_desconto, valor_percentual, valor_nominal")
    .eq("id_int", proposta.id_int)
    .in("tipo_desconto", ["DESCONTO_GERAL", TIPO_DESCONTO_TABELA_ESPECIAL]);
  const desconto = (descontos ?? []).find((d) => d.tipo_desconto === "DESCONTO_GERAL");
  const bonusPercent = bonusDaProposta(
    percentualGravado((descontos ?? []).find((d) => d.tipo_desconto === TIPO_DESCONTO_TABELA_ESPECIAL))
  );

  const totais = totaisDaProposta({
    // O carregador sempre calculou pelos itens, sem olhar se a proposta é
    // avulsa: o `isAvulso: false` mantém isso. Avulsa não tem item, e cai no
    // mesmo nulo de sempre.
    isAvulso: false,
    valorTotalGravado: null,
    valor: null,
    valorFrete: proposta.valor_frete,
    itens: itens ?? [],
    bonusPercent,
    descontoGeral: desconto ?? null
  });

  if (totais.origem !== "itens") return null;
  return { subtotalProdutosCents: centavos(totais.subtotalProdutos), totalCents: centavos(totais.total) };
}
