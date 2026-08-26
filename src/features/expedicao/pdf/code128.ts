/**
 * Code 128 (conjunto B) — codificador puro, sem dependência externa.
 *
 * POR QUE ESCRITO A MAO
 *   A etiqueta 10x15 e renderizada por `@react-pdf/renderer`, que desenha
 *   retangulos nativamente. Um encoder devolvendo larguras de modulo dispensa
 *   biblioteca de imagem, canvas ou binario nativo: as barras viram `<View>`
 *   com largura proporcional, nitidas em qualquer DPI de impressora termica.
 *   Uma lib (bwip-js e afins) traria dependencia nova so para produzir um PNG
 *   que ficaria pior no papel.
 *
 * CONJUNTO B, e so ele
 *   Cobre ASCII 32..126 — o suficiente para codigo de rastreio alfanumerico.
 *   O conjunto C comprimiria pares de digitos, mas exigiria troca de conjunto
 *   no meio do simbolo e nao ha ganho de espaco que justifique aqui.
 *
 * COMO LER O RETORNO
 *   `modulos` alterna BARRA e ESPACO, sempre comecando por BARRA. Cada numero e
 *   a largura em modulos (1 a 4). Quem desenha multiplica pela largura de um
 *   modulo e alterna a cor.
 */

/**
 * Os 107 padroes do Code 128. Cada string tem as larguras alternadas
 * barra/espaco do simbolo (6 digitos; o STOP tem 7). Indice = valor do simbolo.
 */
const PADROES = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112"
];

const START_B = 104;
const STOP = 106;

/** Largura total do simbolo, em modulos — util para dimensionar antes de desenhar. */
export type Code128 = {
  /** Larguras alternadas, comecando SEMPRE por barra. */
  modulos: number[];
  /** Soma de `modulos`: quantos modulos o simbolo inteiro ocupa. */
  totalModulos: number;
};

/**
 * Codifica `texto` em Code 128B.
 *
 * Caractere fora de ASCII 32..126 e descartado — o simbolo tem de ser legivel
 * pelo leitor, e acento ou controle nao existem no conjunto B. Texto vazio (ou
 * que fique vazio depois do filtro) devolve `null`: melhor a etiqueta sair sem
 * codigo do que com um simbolo invalido que o scanner recusa na doca.
 */
export function codificarCode128B(texto: string): Code128 | null {
  const limpo = Array.from(String(texto ?? "")).filter((c) => {
    const code = c.charCodeAt(0);
    return code >= 32 && code <= 126;
  });
  if (limpo.length === 0) return null;

  const valores = limpo.map((c) => c.charCodeAt(0) - 32);

  // Checksum: START + soma dos valores ponderados pela posicao (1-based), mod 103.
  let soma = START_B;
  valores.forEach((v, i) => {
    soma += v * (i + 1);
  });
  const checksum = soma % 103;

  const simbolos = [START_B, ...valores, checksum, STOP];
  const modulos = simbolos.flatMap((s) => Array.from(PADROES[s]).map(Number));

  return { modulos, totalModulos: modulos.reduce((a, b) => a + b, 0) };
}
