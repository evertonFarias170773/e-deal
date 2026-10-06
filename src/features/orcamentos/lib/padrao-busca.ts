/**
 * Padrão de busca que ignora acento, caixa e espaço sobrando (06/10/2026).
 *
 * POR QUE EXPRESSÃO REGULAR
 *   A busca da lista de Pedidos roda no banco (`imatch` do PostgREST, que é o
 *   `~*` do Postgres), porque precisa alcançar a base inteira e não só a página
 *   carregada. O `ilike` de antes ignorava a caixa, mas não o acento: "grafica"
 *   não achava "GRÁFICA", e o contrário também não. Tirar acento no banco pede
 *   função, coluna ou índice novo; aqui cada letra que pode levar acento vira
 *   uma classe com as variantes dela, e o banco compara sem nada novo.
 *
 * O QUE O PADRÃO FAZ
 *   - letra que aceita acento vira classe: "a" -> [aáàâãä...];
 *   - espaço (um ou vários) casa com um ou vários espaços;
 *   - qualquer outro sinal é comparado ao pé da letra;
 *   - nada é ancorado: o termo casa em qualquer parte do texto.
 *
 * Não sai barra invertida nem aspas do padrão, de propósito: ele viaja dentro
 * de aspas no `.or()` do PostgREST, onde os dois teriam de ser escapados.
 */
const VARIANTES: Record<string, string> = {
  a: "aáàâãäAÁÀÂÃÄ",
  e: "eéèêëEÉÈÊË",
  i: "iíìîïIÍÌÎÏ",
  o: "oóòôõöOÓÒÔÕÖ",
  u: "uúùûüUÚÙÛÜ",
  c: "cçCÇ",
  n: "nñNÑ"
};

/** Sinais que não cabem numa classe sem escape: viram "qualquer caractere". */
const SEM_CLASSE = new Set(["]", "^", "\\", '"']);

/** Minúsculas, sem acento, sem espaço nas pontas e com espaço simples no meio. */
export function normalizarTermoDeBusca(termo: string): string {
  return String(termo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Expressão regular para `imatch`; `null` quando o termo não tem nada a buscar. */
export function padraoBuscaSemAcento(termo: string): string | null {
  const limpo = normalizarTermoDeBusca(termo);
  if (!limpo) return null;

  let padrao = "";
  for (const letra of limpo) {
    if (letra === " ") padrao += " +";
    else if (VARIANTES[letra]) padrao += `[${VARIANTES[letra]}]`;
    else if (/[a-z0-9]/.test(letra)) padrao += letra;
    else if (SEM_CLASSE.has(letra)) padrao += ".";
    else padrao += `[${letra}]`;
  }
  return padrao;
}

/**
 * O padrão como valor de um filtro dentro de `.or()`. As aspas impedem que a
 * vírgula, o ponto e os parênteses do padrão sejam lidos como sintaxe do filtro.
 */
export function valorParaOr(padrao: string): string {
  return `"${padrao}"`;
}
