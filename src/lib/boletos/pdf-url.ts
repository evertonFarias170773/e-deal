/**
 * Resolve o link do PDF de um boleto a partir de `public.boletos.url_pdf` e
 * `public.boletos.pdf_storage`.
 *
 * Os dois campos convivem com formatos diferentes, conforme quem gravou:
 *
 * | Origem                                   | url_pdf                          | pdf_storage                       |
 * |------------------------------------------|----------------------------------|-----------------------------------|
 * | Registro/consulta C6 (link público)      | null                             | URL absoluta (`https://pay...`)   |
 * | Edge Function `gerar-boleto-pdf`         | URL absoluta do Storage          | caminho RELATIVO `<id_int>/parcela_N.pdf` |
 *
 * O caminho relativo não traz o bucket: ele é sempre `boletos`, o mesmo que
 * aparece dentro da url_pdf correspondente
 * (`/storage/v1/object/public/boletos/<id_int>/parcela_N.pdf`).
 *
 * Por isso a ordem é: url_pdf absoluta, depois pdf_storage absoluta e, só então,
 * o caminho relativo montado sobre o bucket `boletos`. Entregar o caminho
 * relativo cru como href gera link quebrado.
 *
 * Sem dependência do client do Supabase: monta a URL pública a partir da env, o
 * que funciona igual no browser e no servidor.
 */

const BUCKET_BOLETOS = "boletos";

function ehAbsoluta(valor: string): boolean {
  return /^https?:\/\//i.test(valor);
}

function urlPublicaDoStorage(caminho: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return caminho;

  const limpo = caminho.replace(/^\/+/, "");
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET_BOLETOS}/${limpo}`;
}

/** Link utilizável do PDF, ou string vazia quando não há PDF. */
export function resolverUrlPdfBoleto(
  urlPdf?: string | null,
  pdfStorage?: string | null
): string {
  const url = String(urlPdf || "").trim();
  const storage = String(pdfStorage || "").trim();

  if (ehAbsoluta(url)) return url;
  if (ehAbsoluta(storage)) return storage;

  const relativo = storage || url;
  if (!relativo) return "";

  return urlPublicaDoStorage(relativo);
}
