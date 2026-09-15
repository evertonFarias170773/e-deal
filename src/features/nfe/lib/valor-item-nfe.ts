/**
 * Valor e unitário de cada item da NF-e, a partir dos itens da proposta.
 *
 * BÔNUS DE TABELA ESPECIAL É PREÇO, NÃO DESCONTO
 *   O cliente com bônus (`clientes.is_bonus` + `percentual_bunus`) compra pela
 *   tabela dele. A proposta aplica isso em memória, item a item
 *   (`calculateItemSubtotal`), e `propostas.valor_total` já sai com o bônus —
 *   mas `produtos_proposta.valor_sub_total` guarda o BRUTO, porque o trigger
 *   `trg_calcular_valor_sub_total` o reescreve. Até 14/09/2026 a nota partia do
 *   bruto e fechava acima da proposta: na NFE-22066-002, R$ 162,63 contra
 *   R$ 147,53 — os 10% de bônus da cliente 14.
 *
 *   Agora o item da nota já nasce com o bônus aplicado no valor. Sem `vDesc` por
 *   item e sem desconto de nota: o preço do item é o preço com bônus. O desconto
 *   GERAL da proposta é outra coisa (negociação daquela venda) e continua no
 *   cabeçalho, em `valor_desconto`, calculado sobre o subtotal já com bônus —
 *   exatamente como a proposta calcula.
 *
 * CENTAVOS
 *   Cada item é arredondado no centavo e a diferença residual — se houver — vai
 *   para o item de maior valor, para que a soma dos itens seja sempre o subtotal
 *   com bônus arredondado. É rede de segurança: medido em 14/09/2026, nas 123
 *   propostas de clientes com bônus, arredondar item a item nunca divergiu de
 *   arredondar só a soma.
 *
 * SEM BÔNUS, NADA MUDA
 *   Com percentual zero o cálculo é o de antes, sem arredondamento novo: total do
 *   item = `subtotalBruto` (ou `subtotal`, ou `qtd x unitário`), unitário = total
 *   dividido pela quantidade em 10 casas.
 */

export type ItemDaPropostaParaNota = {
  quantidade?: number | null;
  subtotalBruto?: number | null;
  subtotal?: number | null;
  valorUnitario?: number | null;
};

export type ValorDoItemDaNota = {
  /** Total do item na nota (`notas_fiscais_itens.valor_bruto`). */
  valorBruto: number;
  /**
   * `valor_unitario`, em 10 casas: a coluna é `numeric(16,10)` desde 11/09/2026 e
   * o layout 4.00 aceita vUnCom em 11v0-10. Com 10 casas, o
   * `round(quantidade * valor_unitario, 2)` do trigger devolve o mesmo centavo.
   */
  valorUnitario: number;
};

/** Total do item como sempre foi lido: o bruto da proposta. */
function totalBrutoDoItem(item: ItemDaPropostaParaNota): number {
  const quantidade = Number(item.quantidade) || 0;
  return Number(item.subtotalBruto ?? item.subtotal ?? quantidade * Number(item.valorUnitario ?? 0));
}

function unitario(total: number, quantidade: number): number {
  return quantidade > 0 ? Number((total / quantidade).toFixed(10)) : 0;
}

/**
 * Centavos inteiros, meio para cima. O `toFixed(6)` antes do `Math.round` tira o
 * ruído binário (88 x 0,9 = 79,20000000000001; 1,005 x 100 = 100,49999999999999).
 */
function emCentavos(valor: number): number {
  return Math.round(Number((valor * 100).toFixed(6)));
}

export function valoresDosItensDaNota(
  itens: readonly ItemDaPropostaParaNota[],
  percentualBonus: number
): ValorDoItemDaNota[] {
  const brutos = itens.map(totalBrutoDoItem);

  if (!(percentualBonus > 0)) {
    return itens.map((item, i) => ({
      valorBruto: brutos[i],
      valorUnitario: unitario(brutos[i], Number(item.quantidade) || 0)
    }));
  }

  const fator = 1 - percentualBonus / 100;
  const exatos = brutos.map((bruto) => bruto * fator);
  const centavos = exatos.map(emCentavos);

  const alvo = emCentavos(exatos.reduce((soma, v) => soma + v, 0));
  const residuo = alvo - centavos.reduce((soma, c) => soma + c, 0);
  if (residuo !== 0 && centavos.length > 0) {
    const maior = centavos.indexOf(Math.max(...centavos));
    centavos[maior] += residuo;
  }

  return itens.map((item, i) => {
    const valorBruto = centavos[i] / 100;
    return { valorBruto, valorUnitario: unitario(valorBruto, Number(item.quantidade) || 0) };
  });
}
