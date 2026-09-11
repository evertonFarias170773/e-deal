/**
 * O link de download do XML de uma NF-e, a partir da `ref`.
 *
 * NÃO é `notas_fiscais.url_xml`. Aquela coluna guarda o caminho do arquivo no
 * provedor, e é o que se copia com "Copiar link (XML)". O DOWNLOAD passa por
 * esta Edge Function, que é a forma como a tela de Notas Fiscais e o modal de
 * emissão já baixam o arquivo desde antes — `url_xml` serve ali só para saber
 * SE existe XML, e a `ref` é o que identifica a nota para a função.
 *
 * Este módulo nasceu em 11/09/2026 com a terceira chamada, quando a lista de
 * Pedidos passou a oferecer o download. As duas anteriores continuam com a URL
 * literal no corpo — `NotasFiscaisPage.tsx` e `EmissaoNfeModal.tsx` —, não por
 * esquecimento: são a Fila de Faturamento e o Histórico, que esta rodada tinha
 * ordem explícita de não tocar. Quem for mexer nelas, aponte para cá.
 */
const BASE_DOWNLOAD_XML = "https://pay.ai-ideal.com.br/functions/v1/download-nfe-xml";

export function urlDownloadXmlNfe(ref: string): string {
  return `${BASE_DOWNLOAD_XML}?ref=${encodeURIComponent(ref)}`;
}
