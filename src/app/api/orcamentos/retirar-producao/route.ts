import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { retirarPedidoDaProducao } from "@/features/orcamentos/services/retirar-producao.server";

/**
 * POST /api/orcamentos/retirar-producao — tira a proposta da fila da produção.
 *
 * Até 02/10/2026 a gravação saía direto do navegador, e a permissão existia só no
 * menu. Aqui a sessão e a chave "Liberar para Produção" — a mesma que libera — são
 * conferidas no servidor.
 *
 * DESDE 13/10/2026 retirar é DEVOLVER AO ATENDENTE: grava `is_prd_aprovado = false`
 * E `status_interno = 'REVISAO ATENDENTE'` juntos (a mesma gravação do "Devolver
 * para o atendente"). Antes só a flag caía, e o pedido ficava em REVISAO PRODUCAO
 * sem saída pela tela. Só vale em REVISAO PRODUCAO e sem OS: de EM PRODUCAO em
 * diante, ou com OS/setores, a devolução é da produção e a rota recusa (409). É
 * idempotente: com o pedido já em REVISAO ATENDENTE não grava nada. A regra está em
 * `lib/retirar-producao.ts` e a gravação em `services/retirar-producao.server.ts`.
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

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nome_usuario")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  const resultado = await retirarPedidoDaProducao(supabase, {
    idInt,
    autor: {
      uid: authData.user.id,
      nome: String(usuario?.nome_usuario ?? "").trim() || authData.user.email || "Usuário"
    }
  });

  if (!resultado.success) {
    if (resultado.httpStatus >= 500) console.error("[API][RetirarProducao]", resultado.code, resultado.message);
    return NextResponse.json(
      { success: false, code: resultado.code, message: resultado.message },
      { status: resultado.httpStatus }
    );
  }
  return NextResponse.json(resultado);
}
