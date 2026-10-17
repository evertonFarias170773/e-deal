/**
 * RETRABALHO (17/10/2026) — a regra, em um lugar so.
 *
 * Pedido e RETRABALHO quando tem cobranca `E-RETRABALHO` (`pagamentos_v2.tipo_cobranca`)
 * VIVA: status diferente de CANCELADO, EXTORNADO e RECUSADO. Nao ha coluna propria na
 * proposta: a marca e derivada da cobranca. E-AMOSTRA e E-PERMUTA NAO sao retrabalho.
 *
 * O destaque nunca depende so da cor: contorno, numero do pedido na cor e o selo de
 * texto `ROTULO_RETRABALHO`.
 */

export const FORMA_RETRABALHO = "E-RETRABALHO";

/** Status de cobranca que NAO contam (a cobranca morreu). */
export const STATUS_DE_COBRANCA_QUE_NAO_CONTAM: readonly string[] = ["CANCELADO", "EXTORNADO", "RECUSADO"];

/** O texto do selo. */
export const ROTULO_RETRABALHO = "Retrabalho";

/** A cor nas telas: SEMPRE pelo token (claro e escuro em `globals.css`). */
export const COR_RETRABALHO = "var(--retrabalho)";

/**
 * Os MESMOS valores do token `--retrabalho` de `src/app/globals.css`, para onde CSS
 * nao chega (o PDF do boletim, em `@react-pdf`). Mudou o token, muda aqui tambem.
 */
export const COR_RETRABALHO_CLARO = "#b91c1c";
export const COR_RETRABALHO_ESCURO = "#f87171";

const normalizar = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase();

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
