import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { ehAdmNoServidor } from "@/features/orcamentos/lib/marcar-entregue";
import { enviarPedidoParaFilaDeFaturamento } from "@/features/orcamentos/services/enviar-fila-faturamento.server";

/**
 * POST /api/orcamentos/enviar-fila-faturamento — "Enviar para Fila de Faturamento"
 * (13/10/2026).
 *
 * POST { id_int } -> liga SÓ `propostas.libera_nf` de um pedido em REVISAO ATENDENTE
 * que ainda não está na produção. O pedido entra na Fila de Faturamento sem entrar
 * no painel de Produção nem na Expedição. O que é, por que existe e como grava:
 * `lib/enviar-fila-faturamento.ts` e `services/enviar-fila-faturamento.server.ts`.
 *
 * PERMISSÃO: só ADM (`is_super_adm` ou `is_admin`, o mesmo teste do "Marcar como
 * entregue"), conferida AQUI, no servidor.
 *
 * IDEMPOTENTE: repetir no pedido já enviado responde 200 com `idempotente: true` e
 * não grava nada.
 *
 * A ROTA É A TRANCA DO APP — E SÓ DO APP: a RLS de `propostas` é aberta a
 * `authenticated`; a escrita sai com a SESSÃO do usuário, sem chave de serviço.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { id_int?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Corpo da requisição inválido." }, { status: 400 });
  }

  const idInt = Number(body?.id_int);
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int é obrigatório." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[API][EnviarFilaFaturamento] ENV AUSENTE");
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

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nome_usuario, is_super_adm, is_admin")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  // A permissão vale AQUI, no servidor. O menu só esconde o item.
  if (!ehAdmNoServidor(usuario)) {
    return NextResponse.json(
      { success: false, code: "SEM_PERMISSAO", message: "Só administrador pode enviar um pedido à Fila de Faturamento." },
      { status: 403 }
    );
  }

  const resultado = await enviarPedidoParaFilaDeFaturamento(supabase, {
    idInt,
    autor: {
      uid: authData.user.id,
      nome: String(usuario?.nome_usuario ?? "").trim() || authData.user.email || "Administrador"
    }
  });

  if (!resultado.success) {
    if (resultado.httpStatus >= 500) console.error("[API][EnviarFilaFaturamento]", resultado.code, resultado.message);
    return NextResponse.json(
      { success: false, code: resultado.code, message: resultado.message },
      { status: resultado.httpStatus }
    );
  }
  return NextResponse.json(resultado);
}
