import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { gravarNotaAntecipada } from "@/features/orcamentos/services/nota-antecipada.server";

/**
 * POST /api/orcamentos/nota-antecipada — "Liberar nota antecipada" (29/10/2026).
 *
 * POST { id_int, liberar: true }  -> liga SÓ `propostas.libera_nf` de um pedido em
 *                                   AGUARDANDO: ele entra na Fila de Faturamento
 *                                   antes do pagamento, e a nota sai pelo Faturar.
 * POST { id_int, liberar: false } -> desfaz (desliga `libera_nf`), só em AGUARDANDO
 *                                   e sem NF-e de venda viva.
 *
 * A regra está em `lib/nota-antecipada.ts`; a gravação, em
 * `services/nota-antecipada.server.ts`.
 *
 * PERMISSÃO: `propostas.release_nf` ("Liberar para Nota Fiscal"), conferida AQUI.
 * É a mesma da marca "Nota emitida no sistema antigo".
 *
 * A ROTA É A TRANCA DO APP — E SÓ DO APP: a RLS de `propostas` é aberta a
 * `authenticated`; a escrita sai com a SESSÃO do usuário, sem chave de serviço.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { id_int?: number; liberar?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Corpo da requisição inválido." }, { status: 400 });
  }

  const idInt = Number(body?.id_int);
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int é obrigatório." }, { status: 400 });
  }
  if (typeof body?.liberar !== "boolean") {
    return NextResponse.json({ success: false, message: "Informe liberar: true ou false." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[API][NotaAntecipada] ENV AUSENTE");
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

  const pode = await verificarPermissaoServerSide(supabase, authData.user.id, "propostas.release_nf");
  if (!pode) {
    return NextResponse.json(
      { success: false, code: "SEM_PERMISSAO", message: "Sem permissão para liberar o pedido para nota fiscal (propostas.release_nf)." },
      { status: 403 }
    );
  }

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nome_usuario")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  const resultado = await gravarNotaAntecipada(supabase, {
    idInt,
    liberar: body.liberar,
    autor: {
      uid: authData.user.id,
      nome: String(usuario?.nome_usuario ?? "").trim() || authData.user.email || "Usuário",
      email: authData.user.email ?? null
    }
  });

  if (!resultado.success) {
    if (resultado.httpStatus >= 500) console.error("[API][NotaAntecipada]", resultado.code, resultado.message);
    return NextResponse.json({ success: false, code: resultado.code, message: resultado.message }, { status: resultado.httpStatus });
  }
  return NextResponse.json(resultado);
}
