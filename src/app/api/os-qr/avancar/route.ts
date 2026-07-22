import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { osQrFlagAtiva, hashIpOsQr } from "@/features/pedidos/services/os-qr-token.server";
import { rateLimitCheck } from "@/lib/security/rate-limit-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Única via pública de avanço de status via QR (token no BODY).
 * Toda a validação (token, revogação, transição, lock, rate por token) acontece
 * dentro da RPC os_qr_avancar (SECURITY DEFINER). Nunca loga o token.
 */
export async function POST(request: Request) {
  if (!osQrFlagAtiva()) {
    return NextResponse.json({ ok: false, motivo: "INDISPONIVEL" }, { status: 404, headers: NO_STORE });
  }

  const ip = (request.headers.get("x-forwarded-for") || "desconhecido").split(",")[0].trim();
  if (!rateLimitCheck(`osqr:avancar:${ip}`, 15, 60_000)) {
    return NextResponse.json({ ok: false, motivo: "RATE_LIMITED" }, { status: 429, headers: NO_STORE });
  }

  let token = "";
  let statusEsperado = "";
  try {
    const body = await request.json();
    token = typeof body?.token === "string" ? body.token.trim() : "";
    statusEsperado = typeof body?.statusEsperado === "string" ? body.statusEsperado.trim() : "";
  } catch {
    // body inválido → tratado abaixo
  }
  if (!token || token.length < 32 || token.length > 128 || !statusEsperado || statusEsperado.length > 40) {
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

  const { data, error } = await supabase.rpc("os_qr_avancar", {
    p_token: token,
    p_status_atual_esperado: statusEsperado,
    p_ip_hash: hashIpOsQr(ip),
    p_user_agent: (request.headers.get("user-agent") || "").slice(0, 200) || null
  });

  if (error) {
    console.error("[os-qr/avancar] RPC falhou:", error.code, error.message);
    return NextResponse.json({ ok: false, motivo: "ERRO_INTERNO" }, { status: 500, headers: NO_STORE });
  }

  const status = (data as { motivo?: string } | null)?.motivo === "RATE_LIMITED" ? 429 : 200;
  return NextResponse.json(data, { status, headers: NO_STORE });
}
