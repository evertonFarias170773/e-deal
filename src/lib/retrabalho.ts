/**
 * RETRABALHO (17/10/2026) — a regra, em um lugar so.
 *
 * Pedido e RETRABALHO (o DESTAQUE das telas e do PDF, `marcaDeRetrabalho`) quando:
 *   - `propostas.motivo_copia = RETRABALHO` (o vinculo da duplicacao, desde 19/10/2026), OU
 *   - tem cobranca `E-RETRABALHO` (`pagamentos_v2.tipo_cobranca`) VIVA: status diferente
 *     de CANCELADO, EXTORNADO e RECUSADO. E assim que os retrabalhos antigos, sem motivo
 *     gravado, continuam reconhecidos. E-AMOSTRA e E-PERMUTA NAO sao retrabalho.
 * Com `id_int_origem_copia`, o selo diz de qual pedido ele nasceu ("Retrabalho de #X").
 *
 * A COBRANCA continua decidindo sozinha o que e dela: a lista "Retrabalhos" da
 * Conferencia, o quadro do Dashboard e o filtro Cobranca (`cobrancaEhRetrabalho`,
 * `retrabalhoPelosTiposVivos`, `retrabalhoConfirmadoParaLista`).
 *
 * O destaque nunca depende so da cor: contorno, numero do pedido na cor e o selo de
 * texto `ROTULO_RETRABALHO`.
 */

export const FORMA_RETRABALHO = "E-RETRABALHO";

/** Status de cobranca que NAO contam (a cobranca morreu). */
export const STATUS_DE_COBRANCA_QUE_NAO_CONTAM: readonly string[] = ["CANCELADO", "EXTORNADO", "RECUSADO"];

/** O texto do selo. */
export const ROTULO_RETRABALHO = "Retrabalho";

/** `propostas.motivo_copia` do pedido criado como retrabalho (Duplicar proposta). */
export const MOTIVO_COPIA_RETRABALHO = "RETRABALHO";

/** A cor nas telas: SEMPRE pelo token (claro e escuro em `globals.css`). */
export const COR_RETRABALHO = "var(--retrabalho)";

/**
 * Os MESMOS valores do token `--retrabalho` de `src/app/globals.css`, para onde CSS
 * nao chega (o PDF do boletim, em `@react-pdf`). Mudou o token, muda aqui tambem.
 */
export const COR_RETRABALHO_CLARO = "#b91c1c";
export const COR_RETRABALHO_ESCURO = "#f87171";

const normalizar = (s: unknown) => String(s ?? "").trim().toUpperCase();

/** UMA cobranca e retrabalho vivo? */
export function cobrancaEhRetrabalho(cobranca: { tipo_cobranca?: string | null; status?: string | null } | null | undefined): boolean {
  if (!cobranca) return false;
  return normalizar(cobranca.tipo_cobranca) === FORMA_RETRABALHO && !STATUS_DE_COBRANCA_QUE_NAO_CONTAM.includes(normalizar(cobranca.status));
}

/** O pedido e retrabalho? Basta UMA cobranca de retrabalho viva. */
export function pedidoEhRetrabalho(cobrancas: readonly { tipo_cobranca?: string | null; status?: string | null }[] | null | undefined): boolean {
  return (cobrancas ?? []).some(cobrancaEhRetrabalho);
}

/**
 * Para quem ja recebe so os TIPOS das cobrancas vivas (a lista de Pedidos monta
 * `tipos_cobranca` sem CANCELADO, EXTORNADO e RECUSADO): ha E-RETRABALHO entre eles?
 */
export function retrabalhoPelosTiposVivos(tiposVivos: readonly (string | null | undefined)[] | null | undefined): boolean {
  return (tiposVivos ?? []).some((t) => normalizar(t) === FORMA_RETRABALHO);
}

/**
 * Cobranca de retrabalho para a LISTA da aba Cobrancas Confirmadas, tipo "Retrabalhos"
 * (19/10/2026): viva, confirmada, PAID ou A_VENCER. Base propria da lista: nao passa
 * pelo corte de faturamento (`contaNoFaturamento`), que continua valendo para os totais.
 */
export function retrabalhoConfirmadoParaLista(cobranca: { tipo_cobranca?: string | null; status?: string | null; confirmado?: boolean | null } | null | undefined): boolean {
  if (!cobranca || !cobrancaEhRetrabalho(cobranca)) return false;
  const status = normalizar(cobranca.status);
  return (status === "PAID" || status === "A_VENCER") && cobranca.confirmado === true;
}

/** O vinculo da copia, como a proposta o grava (19/10/2026). */
export type VinculoDaCopia = {
  /** DUPLICACAO, RETRABALHO ou nulo (texto do banco; qualquer outro valor nao conta). */
  motivo_copia?: unknown;
  /** O `id_int` do pedido duplicado; so inteiro positivo conta. */
  id_int_origem_copia?: unknown;
};

/** Pedido destacado como retrabalho; `idIntOriginal` nulo = retrabalho antigo sem original. */
export type MarcaDeRetrabalho = { idIntOriginal: number | null };

/**
 * A REGRA DO DESTAQUE (20/10/2026): o vinculo (`motivo_copia = RETRABALHO`) ou a
 * cobranca E-RETRABALHO viva. `null` = nao e retrabalho. Quem le a proposta passa as
 * duas colunas da MESMA consulta; quem le a cobranca passa o resultado da regra dela.
 */
export function marcaDeRetrabalho(
  vinculo: VinculoDaCopia | null | undefined,
  temCobrancaDeRetrabalhoViva: boolean
): MarcaDeRetrabalho | null {
  const peloVinculo = normalizar(vinculo?.motivo_copia) === MOTIVO_COPIA_RETRABALHO;
  if (!peloVinculo && !temCobrancaDeRetrabalhoViva) return null;
  const original = Number(vinculo?.id_int_origem_copia);
  return { idIntOriginal: Number.isInteger(original) && original > 0 ? original : null };
}

/** O texto do selo: "Retrabalho de #X" com original; so "Retrabalho" sem. */
export function rotuloDoSeloRetrabalho(idIntOriginal: number | null | undefined): string {
  return idIntOriginal ? `${ROTULO_RETRABALHO} de #${idIntOriginal}` : ROTULO_RETRABALHO;
}
