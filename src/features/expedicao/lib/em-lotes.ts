/**
 * Divide uma lista em lotes de no maximo `tamanho` itens.
 *
 * POR QUE EXISTE (21/10/2026): um `.in("id", ids)` vira UMA url, e o gateway do Supabase recusa com
 * 400 Bad Request uma url acima de ~16 KB. Com ids uuid (36 caracteres + virgula) o limite fica perto de
 * 400 ids; o painel da Expedicao pedia ~640 enderecos de uma vez, a consulta falhava, o mapa de enderecos
 * ficava vazio e TODO pedido aparecia como "sem endereco de entrega". Lotes de 100 ids dao ~4 KB de url.
 */
export function emLotes<T>(lista: readonly T[], tamanho: number): T[][] {
  if (!Number.isInteger(tamanho) || tamanho < 1) throw new Error("emLotes: tamanho deve ser um inteiro >= 1");
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}
