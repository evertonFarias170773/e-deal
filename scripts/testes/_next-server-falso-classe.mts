/**
 * `next/server` falso com `NextResponse` como CLASSE (16/10/2026).
 *
 * As rotas de NFS-e testam `sessao instanceof NextResponse` para saber se a
 * autenticação já devolveu a recusa pronta. O falso de `_next-server-falso.mts`
 * é um objeto e quebra esse `instanceof`; este é uma subclasse de `Response`.
 */
export class NextResponse extends Response {
  static json(corpo: unknown, init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return new NextResponse(JSON.stringify(corpo), { ...init, headers });
  }
}

export class NextRequest extends Request {}
