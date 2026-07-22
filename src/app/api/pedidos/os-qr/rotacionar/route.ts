import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { verificarEscopoPropostaServerSide } from "@/lib/auth/verificar-escopo-proposta";
import { osQrFlagAtiva, rotacionarTokenOsQr } from "@/features/pedidos/services/os-qr-token.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Revoga o QR ativo da OS e emite nova versão (rotação).
 * Autenticada (Bearer) + permissão específica pedidos.qr_rotacionar + escopo.
 * A RPC os_qr_finalizar revalida permissão/escopo do ator (fonte da verdade).
 */
export async function POST(request: Request) {
  if (!osQrFlagAtiva()) {
    return NextResponse.json({ success: false, message: "Fluxo de QR público desabilitado." }, { status: 404 });
  }

  let idInt = 0;
  try {
    const body = await request.json();
    idInt = Number(body?.id_int);
  } catch {
    // tratado abaixo
  }
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "Parâmetro id_int inválido." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ success: false, message: "Erro interno no servidor de banco de dados." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
  }

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
  }

  // Permissão específica, sem fallback.
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "pedidos.qr_rotacionar");
  if (!temPermissao) {
    return NextResponse.json(
      { success: false, message: "Sem permissão para rotacionar QR (pedidos.qr_rotacionar)." },
      { status: 403 }
    );
  }

  const { data: proposta, error: propostaErr } = await supabase
    .from("propostas")
    .select("id_int, empresa, vendedor")
    .eq("id_int", idInt)
    .maybeSingle();

  if (propostaErr || !proposta) {
    return NextResponse.json({ success: false, message: "Proposta não encontrada." }, { status: 404 });
  }

  const escopoOk = await verificarEscopoPropostaServerSide(supabase, authData.user.id, {
    empresa: proposta.empresa,
    vendedor: proposta.vendedor,
  });
  if (!escopoOk) {
    return NextResponse.json({ success: false, message: "Acesso negado a esta proposta." }, { status: 403 });
  }

  const resultado = await rotacionarTokenOsQr(token, authData.user.id, idInt);
  if (!resultado.success) {
    return NextResponse.json({ success: false, message: resultado.error }, { status: 409 });
  }

  return NextResponse.json({
    success: true,
    versao: resultado.versao,
    message: `Novo QR gerado (v${resultado.versao}). Reimprima a OS — o QR anterior foi invalidado.`,
  });
}
