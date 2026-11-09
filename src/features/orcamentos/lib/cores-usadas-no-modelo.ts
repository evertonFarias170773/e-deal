/**
 * Cor do papel que não se repete — SÓ EM PRODUTO DE PRATELEIRA.
 *
 * 05/11/2026 (ce1f4402, pedido 24806): a lista de cor de cada lote escondia as
 * cores que os outros lotes do mesmo Modelo já usavam, em qualquer produto.
 * 09/11/2026: o dono restringiu à prateleira (`produtos.is_estoque`, copiado em
 * `produtos_proposta.is_estoque`, lido por `isItemPrateleira`). Na prateleira o
 * Modelo é o próprio produto, então a cor usada some de TODOS os outros lotes
 * dele. Nos demais produtos a lista volta a mostrar todas as cores do formato,
 * e dois lotes podem levar a mesma cor, inclusive com o mesmo Modelo.
 *
 * Só a tela filtra. Pedido gravado com cor repetida abre e grava como antes:
 * a cor do próprio lote continua sempre na lista dele, e o servidor não confere.
 */

const NENHUMA: ReadonlySet<string> = new Set<string>();

/**
 * As cores que os OUTROS lotes do produto já usam e que somem da lista deste
 * lote. Fora da prateleira, nenhuma. `outros` não inclui o próprio lote.
 */
export function coresUsadasNosOutrosLotes(
  prateleira: boolean,
  outros: ReadonlyArray<{ padrao: string | null | undefined }>
): ReadonlySet<string> {
  if (!prateleira) return NENHUMA;
  const usadas = new Set<string>();
  for (const o of outros) {
    const cor = o.padrao?.trim();
    if (cor) usadas.add(cor);
  }
  return usadas;
}
