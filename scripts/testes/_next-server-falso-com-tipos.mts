/**
 * Igual a `_next-server-falso.mts`, mais `NextRequest`, que algumas rotas
 * importam como valor quando é só o tipo do parâmetro.
 */
export { NextResponse } from "./_next-server-falso.mts";

export class NextRequest extends Request {}
