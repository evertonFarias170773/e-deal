/**
 * Nome do arquivo do PDF da OS: `os_{id_int}_{setor}.pdf`.
 *
 * Usado nos dois lados — no `Content-Disposition` da rota e no nome sugerido ao
 * salvar pelo navegador —, por isso mora num módulo puro, sem imports.
 * Sem setor (OS legada, ou impressão a partir da lista) sai `os_{id_int}.pdf`.
 */
export function nomeArquivoOs(idInt: number | string, setor?: string | null): string {
  const setorNormalizado = (setor || "")
    .normalize("NFD")
    // Remove os diacríticos separados pelo NFD: "IMPRESSÃO" → "IMPRESSAO".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return setorNormalizado ? `os_${idInt}_${setorNormalizado}.pdf` : `os_${idInt}.pdf`;
}
