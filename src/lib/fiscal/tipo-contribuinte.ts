/**
 * Vocabulario UNICO do tipo de contribuinte.
 *
 * O QUE E
 *   O codigo `indIEDest` da NF-e: como a SEFAZ enxerga a inscricao estadual do
 *   DESTINATARIO. Tres valores, e so tres:
 *
 *     1 = Contribuinte ICMS      (tem IE, destaca ICMS)
 *     2 = Contribuinte Isento    (contribuinte isento de inscricao estadual)
 *     9 = Nao Contribuinte       (o caso normal de CPF e de PJ nao contribuinte)
 *
 * POR QUE EXISTE ESTE ARQUIVO
 *   Ate 25/08/2026 o cadastro do cliente e a nota falavam linguas diferentes. O
 *   drop do cadastro oferecia CONTRIBUINTE / ISENTO (dois estados, texto livre)
 *   e o drop da NF oferecia 1 / 2 / 9 (tres estados, codigo). Nao havia
 *   correspondencia um-para-um: o `9` nao existia no cadastro, e o `ISENTO` do
 *   cadastro era ambiguo — podia ser o 2 ou o 9. Pior, `clientes.tipo_contribuinte`
 *   acumulou 11 formatos distintos em 65.929 linhas (`ISENTO`, `2`,
 *   `2 = Contribuinte isento`, `Nao Contribuinte`, `1 = Contribuinte ICMS`,
 *   vazio, NULL...), porque a coluna e `text` livre.
 *
 *   A partir daqui os dois lados gravam o codigo. Este modulo e a UNICA
 *   tradutora — a normalizacao em SQL
 *   (supabase/manutencao/20260825_tipo_contribuinte_sefaz_e_nota_padrao.sql)
 *   repete exatamente a mesma tabela e a mesma ORDEM de decisao.
 *
 * POR QUE A TRADUCAO CONTINUA VIVA DEPOIS DO SQL
 *   Porque a coluna segue sendo `text` sem CHECK: qualquer importacao antiga,
 *   rotina externa ou linha que escape da normalizacao volta a cair aqui. Ler
 *   sempre pela tradutora e mais barato do que confiar que o banco esta limpo.
 */

/** Os tres codigos da SEFAZ. Nao existe um quarto. */
export type CodigoTipoContribuinte = "1" | "2" | "9";

/** Opcoes do drop — as MESMAS no cadastro do cliente e na aba Destinatario da NF. */
export const OPCOES_TIPO_CONTRIBUINTE: ReadonlyArray<{
  valor: CodigoTipoContribuinte;
  rotulo: string;
}> = [
  { valor: "1", rotulo: "1 - Contribuinte ICMS" },
  { valor: "2", rotulo: "2 - Contribuinte Isento" },
  { valor: "9", rotulo: "9 - Não Contribuinte" }
];

/** Caixa alta, sem acento e sem espaco duplicado — para o match textual abaixo. */
function achatar(bruto: string): string {
  return bruto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Traduz QUALQUER grafia historica para o codigo da SEFAZ.
 *
 * Devolve `null` quando nao ha o que traduzir (vazio, NULL) ou quando o texto
 * nao e reconhecido — nunca chuta. Quem chama decide o que fazer com o `null`:
 * o SQL manda para `9`, o formulario deixa "Selecione..." e a NF cai no palpite
 * por documento.
 *
 * A ORDEM DAS REGRAS IMPORTA e nao pode ser reorganizada por estetica:
 *   - "Nao Contribuinte" CONTEM "CONTRIBUINTE";
 *   - "2 = Contribuinte isento de inscricao estadual" CONTEM "CONTRIBUINTE ISENTO";
 *   - "1 = Contribuinte ICMS" CONTEM "CONTRIBUINTE".
 * Testar o mais especifico primeiro e o que impede um `9` de virar `1`.
 */
export function normalizarTipoContribuinte(
  bruto: string | number | null | undefined
): CodigoTipoContribuinte | null {
  if (bruto === null || bruto === undefined) return null;

  const texto = achatar(String(bruto));
  if (!texto) return null;

  // 1. Ja e o codigo.
  if (texto === "1" || texto === "2" || texto === "9") return texto;

  // 2. Do mais especifico para o mais generico.
  if (texto.includes("NAO CONTRIBUINTE")) return "9";
  if (texto.includes("CONTRIBUINTE ISENTO")) return "2";
  if (texto.includes("CONTRIBUINTE ICMS")) return "1";

  // 3. Os dois rotulos do drop antigo do cadastro.
  //    `ISENTO` sozinho vira 9, nao 2: no cadastro ele sempre significou "sem
  //    inscricao estadual", e 64.748 das 65.929 linhas estao nesse balde — a
  //    esmagadora maioria e pessoa fisica e PJ nao contribuinte. Marcar tudo
  //    como 2 declararia contribuinte quem nao e.
  if (texto === "CONTRIBUINTE") return "1";
  if (texto === "ISENTO") return "9";

  return null;
}

/**
 * O palpite por documento — o que a NF fazia sozinha antes de olhar o cadastro.
 * CNPJ presume contribuinte de ICMS; CPF nunca e contribuinte.
 *
 * Continua sendo o fallback da emissao quando o cadastro do pagador nao tem
 * valor traduzivel. Nao substitui o cadastro: so cobre o buraco.
 */
export function tipoContribuintePorDocumento(
  documento: string | null | undefined
): CodigoTipoContribuinte {
  const digitos = String(documento ?? "").replace(/\D/g, "");
  return digitos.length > 11 ? "1" : "9";
}
