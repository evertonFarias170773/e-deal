import { NextResponse } from "next/server";

import { criarClientServiceRole, ipDaRequisicao } from "@/features/cadastros/services/cadastro-online.server";
import {
  areaClienteFlagAtiva,
  montarSituacaoAreaCliente,
  resolverTokenAreaCliente
} from "@/features/area-cliente/services/area-cliente.server";
import { rateLimitCheck } from "@/lib/security/rate-limit-memory";

/**
 * Situação do pedido para a área do cliente. A página chama ao abrir e, enquanto
 * houver cobrança aberta, a cada poucos segundos — é assim que "pago" aparece
 * sem recarregar.
 *
 * Token inválido, flag desligada e limite estourado respondem a mesma coisa:
 * quem sonda não aprende nada.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPOSTA_INDISPONIVEL = { ok: false, situacao: "LINK_INDISPONIVEL" } as const;

export async function POST(request: Request) {
  if (!areaClienteFlagAtiva()) {
    return NextResponse.json(RESPOSTA_INDISPONIVEL, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const ip = ipDaRequisicao(request);
  if (!rateLimitCheck(`area-cliente:situacao:${ip}`, 60, 60_000)) {
    return NextResponse.json(RESPOSTA_INDISPONIVEL, { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  let corpo: { token?: string };
  try {
    corpo = (await request.json()) as { token?: string };
  } catch {
    return NextResponse.json(RESPOSTA_INDISPONIVEL, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const idInt = resolverTokenAreaCliente(String(corpo.token ?? ""));
  if (!idInt) {
    return NextResponse.json(RESPOSTA_INDISPONIVEL, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const service = criarClientServiceRole();
  if (!service) {
    console.error("[area-cliente/situacao] service_role indisponivel.");
    return NextResponse.json(RESPOSTA_INDISPONIVEL, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  const situacao = await montarSituacaoAreaCliente(service, idInt);
  if (!situacao) {
    return NextResponse.json(RESPOSTA_INDISPONIVEL, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ ok: true, situacao }, { headers: { "Cache-Control": "no-store" } });
}
