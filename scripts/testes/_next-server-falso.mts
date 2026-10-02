/**
 * Substituto de `next/server` para testar ROTA direto pelo Node: só o
 * `NextResponse.json`, que é o que as rotas usam, sobre o `Response` padrão.
 */
export const NextResponse = {
  json(corpo: unknown, init?: { status?: number; headers?: Record<string, string> }) {
    return new Response(JSON.stringify(corpo), {
      status: init?.status ?? 200,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) }
    });
  }
};
