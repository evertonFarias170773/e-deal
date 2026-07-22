import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { osQrFlagAtiva } from "@/features/pedidos/services/os-qr-token.server";
import { rateLimitCheck } from "@/lib/security/rate-limit-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Consulta pública do estado da OS pelo token do QR (token no BODY — nunca em URL).
 * Somente leitura: nunca altera status. Nunca loga o token.
 */
export async function POST(request: Request) {
  if (!osQrFlagAtiva()) {
    return NextResponse.json({ ok: false, motivo: "INDISPONIVEL" }, { status: 404, headers: NO_STORE });
  }

  const ip = (request.headers.get("x-forwarded-for") || "desconhecido").split(",")[0].trim();
  if (!rateLimitCheck(`osqr:consultar:${ip}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, motivo: "RATE_LIMITED" }, { status: 429, headers: NO_STORE });
  }

  let token = "";
  try {
    const body = await request.json();
    token = typeof body?.token === "string" ? body.token.trim() : "";
  } catch {
    // body inválido → tratado abaixo
  }
  if (!token || token.length < 32 || token.length > 128) {
    return NextResponse.json({ ok: false, motivo: "TOKEN_INVALIDO" }, { status: 200, headers: NO_STORE });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ ok: false, motivo: "ERRO_INTERNO" }, { status: 500, headers: NO_STORE });
  }

  const supabase = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data, error } = await supabase.rpc("os_qr_consultar", { p_token: token });
  if (error) {
    console.error("[os-qr/consultar] RPC falhou:", error.code, error.message);
    return NextResponse.json({ ok: false, motivo: "ERRO_INTERNO" }, { status: 500, headers: NO_STORE });
  }

  return NextResponse.json(data, { status: 200, headers: NO_STORE });
}
