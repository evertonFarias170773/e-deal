import { calculateItemSubtotal } from "@/features/orcamentos/orcamento-utils";

/**
 * O total da proposta — a ÚNICA regra, para todo o sistema.
 *
 * É a conta do "Salvar alterações": a mesma de `calculateResumo`
 * (orcamento-utils), que o `saveProposta` grava em `propostas.valor` e
 * `propostas.valor_total`. Aqui ela roda sobre as LINHAS do banco, para quem
 * não tem o formulário na mão:
 *
 *   subtotal = soma, nos itens NÃO cancelados, de
 *              quantidade × unitário + fixo, menos o bônus do cliente
 *   desconto = desconto geral (percentual sobre o subtotal, ou nominal),
 *              nunca negativo e nunca maior que o subtotal
 *   total    = max(0, subtotal − desconto + frete gravado)
 *
 * QUEM USA
 *   A lista de propostas, a lista rápida e a área do cliente (as duas pelo
 *   carregador `calcularTotaisPelaRegraDaTela`) e a API da Lisiton. Até
 *   29/09/2026 eram duas cópias: a da lista somava item cancelado e não
 *   limitava o desconto ao subtotal; a do servidor seguia o save. Ficou a do
 *   save, que é a oficial.
 *
 * SEM ITEM ATIVO
 *   Avulsa (valor digitado, sem itens) e proposta com todos os itens
 *   cancelados não têm o que somar: vale o `valor_total` gravado, ou `valor` +
 *   frete quando ele não existe. `origem` diz qual caminho foi usado — o
 *   carregador do servidor devolve nulo nesse caso, como sempre devolveu.
 *
 * O `valor_unt` gravado já inclui o acréscimo das variações, por isso os
 * itens entram aqui sem `variacoesEscolhidas`.
 */

const numero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

export type ItemParaTotal = {
  qtd: unknown;
  valor_unt: unknown;
  fixo: unknown;
  /** `produtos_proposta.status_item`. Item CANCELADO não entra na soma. */
  status_item?: unknown;
};

export type DescontoGeralParaTotal = { valor_percentual: unknown; valor_nominal: unknown };

export type EntradaTotalDaProposta = {
  isAvulso: boolean;
  /** `propostas.valor_total` como está gravado. */
  valorTotalGravado: unknown;
  /** `propostas.valor`. */
  valor: unknown;
  /** `propostas.valor_frete`. */
  valorFrete: unknown;
  /** Linhas de `produtos_proposta` da proposta. */
  itens: readonly ItemParaTotal[];
  /**
   * Bônus de tabela especial, em pontos percentuais — o da PROPOSTA: o gravado
   * na linha TABELA_ESPECIAL e, sem ela, o do cliente. Ver `bonusDaProposta`.
   */
  bonusPercent: number;
  /** `desconto_proposta` do tipo DESCONTO_GERAL, quando houver. */
  descontoGeral?: DescontoGeralParaTotal | null;
};

export type TotaisDaProposta = {
  /** Soma dos itens ativos com o bônus, SEM o desconto geral — é `propostas.valor`. */
  subtotalProdutos: number;
  /** O total — é `propostas.valor_total`. */
  total: number;
  /** `itens`: calculado pelos itens ativos. `gravado`: não havia item ativo. */
  origem: "itens" | "gravado";
};

/** Item que entra na conta: todo item que não está CANCELADO. */
export const itemAtivoNoTotal = (item: ItemParaTotal): boolean =>
  String(item.status_item ?? "").trim().toUpperCase() !== "CANCELADO";

export function totaisDaProposta(entrada: EntradaTotalDaProposta): TotaisDaProposta {
  const frete = numero(entrada.valorFrete);
  const ativos = entrada.itens.filter(itemAtivoNoTotal);

  if (entrada.isAvulso || ativos.length === 0) {
    return {
      subtotalProdutos: numero(entrada.valor),
      total: numero(entrada.valorTotalGravado ?? numero(entrada.valor) + frete),
      origem: "gravado"
    };
  }

  let subtotalProdutos = 0;
  for (const item of ativos) {
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
  // O mesmo teto de `calculateResumo`: nunca negativo, nunca acima do subtotal.
  desconto = Math.min(subtotalProdutos, Math.max(0, desconto));

  return {
    subtotalProdutos,
    total: Math.max(0, subtotalProdutos - desconto + frete),
    origem: "itens"
  };
}
