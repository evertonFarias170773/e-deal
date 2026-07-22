/**
 * Pré-fetch server-side de imagens (miniaturas de arte) para o PDF da OS.
 * Sempre tolerante a falha: qualquer erro retorna null e o PDF usa referência textual.
 */

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB

export async function carregarImagemComoDataUrl(
  url: string,
  maxBytes: number = DEFAULT_MAX_BYTES
): Promise<string | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return null;

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxBytes) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) return null;

    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}
