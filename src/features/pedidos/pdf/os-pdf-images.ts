/**
 * Pré-fetch server-side de imagens (miniaturas de arte) para o PDF da OS.
 * Sempre tolerante a falha: qualquer erro retorna null e o PDF usa referência textual.
 */

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Teto de espera por imagem. Sem ele, um arquivo lento no storage segurava a
 * geração inteira até o timeout da plataforma — era a causa do PDF "demorar
 * demais" e às vezes falhar. Estourado o tempo, o card cai no placeholder.
 *
 * O valor sai de medição, não de palpite: percorrendo TODOS os objetos de arte
 * do banco, o pior download real levou 2.448 ms. Um teto de 2.500 ms deixaria
 * 52 ms de folga para um objeto em rede — pouco. 3.000 ms cobre o pior caso
 * observado com margem e não devolve nada do ganho do paralelismo, que veio de
 * buscar as candidatas juntas, e não de cortar o tempo de cada uma.
 */
const TIMEOUT_MS = 3000;

export async function carregarImagemComoDataUrl(
  url: string,
  maxBytes: number = DEFAULT_MAX_BYTES
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
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
  } finally {
    clearTimeout(timer);
  }
}
