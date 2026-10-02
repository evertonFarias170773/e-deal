import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";

/**
 * POST /api/orcamentos/retirar-producao — tira a proposta da fila da produção.
 *
 * Até 02/10/2026 a gravação saía direto do navegador (`propostas.is_prd_aprovado
 * = false`), e a permissão existia só no menu. Aqui a sessão e a chave
 * "Liberar para Produção" — a mesma que libera — são conferidas no servidor.
 *
 * A gravação é a de sempre: só `is_prd_aprovado` vira falso. Nada mais muda.
 */

const PERMISSAO = "propostas.release_producao";

export async function POST(request: Request) {
  let body: { id_int?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Corpo da requisição inválido." }, { status: 400 });
  }

  const idInt = Number(body.id_int);
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int é obrigatório." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[API][RetirarProducao] ENV AUSENTE");
    return NextResponse.json({ success: false, message: "Erro interno no servidor." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
  }

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
  }

  // A permissão vale AQUI, no servidor. O menu só esconde o item.
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, PERMISSAO);
  if (!temPermissao) {
    return NextResponse.json(
      { success: false, code: "SEM_PERMISSAO", message: `Sem permissão para retirar da produção (${PERMISSAO}).` },
      { status: 403 }
    );
  }

  const { data: alteradas, error: updateErr } = await supabase
    .from("propostas")
    .update({ is_prd_aprovado: false })
    .eq("id_int", idInt)
    .select("id_int");

  if (updateErr) {
    console.error("[API][RetirarProducao] Falha ao gravar:", updateErr.message);
    return NextResponse.json({ success: false, message: "Erro ao retirar proposta da produção." }, { status: 500 });
  }
  if (!alteradas || alteradas.length === 0) {
    return NextResponse.json({ success: false, code: "NAO_ENCONTRADA", message: "Proposta não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
