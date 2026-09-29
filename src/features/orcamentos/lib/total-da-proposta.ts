import { calculateItemSubtotal } from "@/features/orcamentos/orcamento-utils";

/**
 * O valor total de uma proposta, pela MESMA regra que a lista de propostas usa.
 *
 * POR QUE EXISTE
 *   A regra morava dentro do laço de `getOrcamentosReadOnlyData`. Em 29/09/2026
 *   a API da Lisiton passou a precisar do mesmo número, e copiar o laço criaria
 *   duas regras que um dia divergem. Agora a lista e a API chamam esta função.
 *
 * A REGRA
 *   - Avulsa, ou sem itens: o `valor_total` gravado; se ele não existir,
 *     `valor` + frete.
 *   - Com itens: soma dos subtotais dos itens (quantidade × unitário + fixo,
 *     menos o bônus do cliente), mais o frete, menos o desconto geral
 *     (percentual sobre os produtos, ou o valor nominal). Nunca abaixo de zero.
 *
 * Os números chegam do PostgREST já como `number`; a conversão aqui só existe
 * para que um valor ausente conte como zero em vez de virar `NaN`.
 */

type Numerico = number | string | null | undefined;

const numero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

export type ItemParaTotal = { qtd: Numerico; valor_unt: Numerico; fixo: Numerico };

export type DescontoGeralParaTotal = { valor_percentual: Numerico; valor_nominal: Numerico };

export type EntradaTotalDaProposta = {
  isAvulso: boolean;
  /** `propostas.valor_total` como está gravado. Vem tipado largo do PostgREST: por isso `unknown`. */
  valorTotalGravado: unknown;
  /** `propostas.valor`. */
  valor: unknown;
  /** `propostas.valor_frete`. */
  valorFrete: unknown;
  /** Linhas de `produtos_proposta` da proposta. */
  itens: readonly ItemParaTotal[];
  /** Bônus do cliente, em pontos percentuais — ver `getClienteBonusPercent`. */
  bonusPercent: number;
  /** `desconto_proposta` do tipo DESCONTO_GERAL, quando houver. */
  descontoGeral?: DescontoGeralParaTotal | null;
};

export function totalDaProposta(entrada: EntradaTotalDaProposta): number {
  const frete = numero(entrada.valorFrete);

  if (entrada.isAvulso || entrada.itens.length === 0) {
    return numero(entrada.valorTotalGravado ?? numero(entrada.valor) + frete);
  }

  let subtotalProdutos = 0;
  for (const item of entrada.itens) {
    subtotalProdutos += calculateItemSubtotal(
      {
        quantidade: numero(item.qtd),
        valorUnitario: numero(item.valor_unt),
        valorFixo: numero(item.fixo),
        variacoesEscolhidas: []
      },
      entrada.bonusPercent
    ).subtotal;
  }

  let desconto = 0;
  if (entrada.descontoGeral) {
    const percentual = numero(entrada.descontoGeral.valor_percentual);
    desconto =
      percentual > 0 ? (subtotalProdutos * percentual) / 100 : numero(entrada.descontoGeral.valor_nominal);
  }

  return Math.max(0, subtotalProdutos + frete - desconto);
}
