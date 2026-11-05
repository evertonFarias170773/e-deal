/**
 * Cor do papel que não se repete (05/11/2026, pedido 24806).
 *
 * Dentro do mesmo produto, dois lotes com o MESMO Modelo não levam a mesma cor:
 * a lista de cor de cada lote esconde as cores que os outros lotes desse Modelo
 * já usam. Lotes de Modelo diferente repetem a cor à vontade (ex.: 24808, Branca
 * em AFTER / LOUNGE / NA RODA / SUBSOLO) — escolha do dono.
 *
 * Só a tela filtra. Pedido antigo com cor repetida abre e grava como antes:
 * a cor do próprio lote continua sempre na lista dele, e o servidor não confere.
 */

/** Chave de comparação do Modelo: sem espaços nas pontas e sem caixa. */
function chaveDoModelo(nome: string | null | undefined): string {
  return (nome ?? "").trim().toLocaleLowerCase("pt-BR");
}

/**
 * As cores que os OUTROS lotes do produto, com o mesmo Modelo, já usam.
 * `outros` não inclui o próprio lote.
 */
export function coresUsadasNoMesmoModelo(
  nomeDoLote: string | null | undefined,
  outros: ReadonlyArray<{ nome_modelo: string | null | undefined; padrao: string | null | undefined }>
): Set<string> {
  const chave = chaveDoModelo(nomeDoLote);
  const usadas = new Set<string>();
  for (const o of outros) {
    const cor = o.padrao?.trim();
    if (cor && chaveDoModelo(o.nome_modelo) === chave) usadas.add(cor);
  }
  return usadas;
}
