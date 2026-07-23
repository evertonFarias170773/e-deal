import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { osQrFlagAtiva, hashIpOsQr } from "@/features/pedidos/services/os-qr-token.server";
import { rateLimitCheck } from "@/lib/security/rate-limit-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Via pública de transição de status via QR v2 (token no BODY).
 * Toda a validação (token, revogação, destino permitido, motivo obrigatório,
 * lock, rate por token) acontece dentro da RPC os_qr_transicionar
 * (SECURITY DEFINER) — a lista de destinos do frontend nunca é confiada.
 * Nunca loga o token.
 */
export async function POST(request: Request) {
  if (!osQrFlagAtiva()) {
    return NextResponse.json({ ok: false, motivo: "INDISPONIVEL" }, { status: 404, headers: NO_STORE });
  }

  const ip = (request.headers.get("x-forwarded-for") || "desconhecido").split(",")[0].trim();
  if (!rateLimitCheck(`osqr:transicionar:${ip}`, 15, 60_000)) {
    return NextResponse.json({ ok: false, motivo: "RATE_LIMITED" }, { status: 429, headers: NO_STORE });
  }

  let token = "";
  let statusEsperado = "";
  let statusDestino = "";
  let motivo = "";
  try {
    const body = await request.json();
    token = typeof body?.token === "string" ? body.token.trim() : "";
    statusEsperado = typeof body?.statusEsperado === "string" ? body.statusEsperado.trim() : "";
    statusDestino = typeof body?.statusDestino === "string" ? body.statusDestino.trim() : "";
    motivo = typeof body?.motivo === "string" ? body.motivo.trim().slice(0, 300) : "";
  } catch {
    // body inválido → tratado abaixo
  }
  if (!token || token.length < 32 || token.length > 128 || !statusEsperado || statusEsperado.length > 40) {
    return NextResponse.json({ ok: false, motivo: "TOKEN_INVALIDO" }, { status: 200, headers: NO_STORE });
  }
  if (!statusDestino || statusDestino.length > 40) {
    return NextResponse.json({ ok: false, motivo: "DESTINO_INVALIDO" }, { status: 200, headers: NO_STORE });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ ok: false, motivo: "ERRO_INTERNO" }, { status: 500, headers: NO_STORE });
  }

  const supabase = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data, error } = await supabase.rpc("os_qr_transicionar", {
    p_token: token,
    p_status_atual_esperado: statusEsperado,
    p_status_destino: statusDestino,
    p_motivo: motivo || null,
    p_ip_hash: hashIpOsQr(ip),
    p_user_agent: (request.headers.get("user-agent") || "").slice(0, 200) || null
  });

  if (error) {
    console.error("[os-qr/transicionar] RPC falhou:", error.code, error.message);
    return NextResponse.json({ ok: false, motivo: "ERRO_INTERNO" }, { status: 500, headers: NO_STORE });
  }

  const status = (data as { motivo?: string } | null)?.motivo === "RATE_LIMITED" ? 429 : 200;
  return NextResponse.json(data, { status, headers: NO_STORE });
}
