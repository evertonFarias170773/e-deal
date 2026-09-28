import type { SupabaseClient } from "@supabase/supabase-js";

import { calculateItemSubtotal, getClienteBonusPercent } from "@/features/orcamentos/orcamento-utils";

/**
 * Totais da proposta pela regra do "Salvar alteracoes" — no servidor.
 *
 * E a mesma conta de `calculateResumo` (orcamento-utils) que o `saveProposta`
 * grava em `propostas.valor` e `propostas.valor_total`, e que o detalhe e a
 * lista da proposta refazem em memoria em vez de ler a coluna:
 *
 *   subtotal = soma, nos itens NAO cancelados, de
 *              quantidade x unitario + fixo, menos o bonus do cliente
 *   total    = max(0, subtotal - desconto geral + frete gravado)
 *
 * Nasceu em 27/09/2026 dentro da area do cliente (`/p/<token>`), que
 * comparava esse total com a coluna para nao cobrar valor velho. Em 28/09
 * veio para ca porque a lista rapida (`/api/pedidos/lotes-em-massa`) passou
 * a consolidar a proposta com a mesma regra — uma copia so, para as duas
 * nunca divergirem.
 *
 * Devolve centavos. Nulo quando a proposta nao tem item ativo: nesse caso o
 * ERP cai em `valor_total`, e nao ha o que calcular.
 */

export type TotaisProposta = {
  /** `propostas.valor`: subtotal dos itens com o bonus, SEM o desconto geral. */
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

  // Item cancelado fica de fora, como em `calculateResumo` e no detalhe da
  // proposta. (O bloco da LISTA, orcamentos.service.ts:1440-1481, nao filtra;
  // a regra oficial e a do save, e e ela que vale aqui.)
  const lista = ((itens ?? []) as Array<{ valor_unt: number | null; qtd: number | null; fixo: number | null; status_item: string | null }>)
    .filter((item) => String(item.status_item ?? "").toUpperCase() !== "CANCELADO");
  if (lista.length === 0) return null;

  let bonusPercent = 0;
  if (proposta.id_cliente) {
    const { data: cli } = await client
      .from("clientes")
      .select("is_bonus, percentual_bunus, usa_preco_fixo")
      .eq("id_cliente", proposta.id_cliente)
      .maybeSingle<{ is_bonus: boolean | null; percentual_bunus: number | null; usa_preco_fixo: boolean | null }>();
    if (cli) {
      bonusPercent = getClienteBonusPercent({
        usaPrecoFixo: cli.usa_preco_fixo === true,
        is_bonus: cli.is_bonus === true,
        bonusAtivo: cli.is_bonus === true,
        percentualBonus: Number(cli.percentual_bunus ?? 0)
      } as Parameters<typeof getClienteBonusPercent>[0]);
    }
  }

  let subtotalProdutos = 0;
  for (const item of lista) {
    subtotalProdutos += calculateItemSubtotal(
      { quantidade: item.qtd || 0, valorUnitario: item.valor_unt || 0, valorFixo: item.fixo || 0, variacoesEscolhidas: [] },
      bonusPercent
    ).subtotal;
  }

  let descontoGeral = 0;
  const { data: desconto } = await client
    .from("desconto_proposta")
    .select("valor_percentual, valor_nominal")
    .eq("id_int", proposta.id_int)
    .eq("tipo_desconto", "DESCONTO_GERAL")
    .limit(1)
    .maybeSingle<{ valor_percentual: number | null; valor_nominal: number | null }>();
  if (desconto) {
    const pct = Number(desconto.valor_percentual ?? 0);
    descontoGeral = pct > 0 ? (subtotalProdutos * pct) / 100 : Number(desconto.valor_nominal ?? 0);
  }
  // Mesmo teto de `calculateResumo`: o desconto nunca passa do subtotal.
  descontoGeral = Math.min(subtotalProdutos, Math.max(0, descontoGeral));

  const total = Math.max(0, subtotalProdutos - descontoGeral + (Number(proposta.valor_frete) || 0));
  return { subtotalProdutosCents: centavos(subtotalProdutos), totalCents: centavos(total) };
}
