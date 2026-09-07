/**
 * GET de JSON com timeout, para APIs externas.
 *
 * DE ONDE VEIO: era uma funcao privada dentro de
 * `api/cadastros/consultar-documento/route.ts`, com o timeout FIXO em 12000 ms.
 * Foi extraida para ca quando o cadastro online passou a precisar do mesmo
 * comportamento com um teto MENOR (4 s), porque a rota publica tem orcamento de
 * tempo e a autenticada nao.
 *
 * O default de 12000 ms e o valor antigo, de proposito: quem ja chamava sem
 * informar o timeout continua com o comportamento exato de antes.
 *
 * Nunca lanca. Falha de rede, timeout, status != 2xx e JSON invalido caem todos
 * em `{ ok: false }` — a diferenca entre eles nao interessa a quem chama, e
 * tratar por excecao espalharia try/catch pelas rotas.
 */
export type FetchJsonResultado<T> = { ok: true; data: T } | { ok: false; status?: number };

export async function fetchJsonWithTimeout<T>(
  url: string,
  headers?: HeadersInit,
  timeoutMs = 12000
): Promise<FetchJsonResultado<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      return { ok: false, status: response.status };
    }

    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}
