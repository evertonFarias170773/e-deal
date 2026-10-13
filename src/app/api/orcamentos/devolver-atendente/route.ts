import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PERMISSAO_DEVOLVER_AO_ATENDENTE, podeDevolverAoAtendente } from "@/features/orcamentos/lib/devolver-atendente";
import { devolverPedidoAoAtendente } from "@/features/orcamentos/services/devolver-atendente.server";

/**
 * POST /api/orcamentos/devolver-atendente — o "Voltar para Revisão Atendente" da tela
 * Produção (13/10/2026).
 *
 * Até aqui a gravação saía direto do navegador, e a permissão existia só no botão.
 * A rota confere a sessão e QUEM PODE (exatamente quem já via o botão: admin, super
 * admin ou `pedidos.admin` — ver `lib/devolver-atendente.ts`), recusa pedido com nota
 * fiscal emitida (409 `NOTA_EMITIDA`, dizendo qual nota) e registra quem devolveu em
 * `os_status_log`. A gravação em si não mudou; está em
 * `services/devolver-atendente.server.ts`. É idempotente: com o pedido já em REVISAO
 * ATENDENTE não grava nada.
 */

type UsuarioRow = { id_perfil: number | null; is_super_adm: boolean | null; is_admin: boolean | null; nome_usuario: string | null };

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
    console.error("[API][DevolverAtendente] ENV AUSENTE");
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

  // A permissão vale AQUI, no servidor. O botão da tela só esconde a ação.
  const semPermissao = NextResponse.json(
    { success: false, code: "SEM_PERMISSAO", message: `Sem permissão para devolver o pedido ao atendente (${PERMISSAO_DEVOLVER_AO_ATENDENTE}).` },
    { status: 403 }
  );

  const { data: usuario, error: erroUsuario } = await supabase
    .from("usuarios")
    .select("id_perfil, is_super_adm, is_admin, nome_usuario")
    .eq("user_id", authData.user.id)
    .maybeSingle<UsuarioRow>();
  if (erroUsuario || !usuario) return semPermissao;

  // Perfil ATIVO, como a tela resolve. Sem conseguir ler o perfil, não libera.
  let permissoesDoPerfil: string[] | null = null;
  if (usuario.id_perfil != null) {
    const { data: perfil, error: erroPerfil } = await supabase
      .from("perfis")
      .select("permissoes")
      .eq("id", usuario.id_perfil)
      .eq("ativo", true)
      .maybeSingle<{ permissoes: unknown }>();
    if (erroPerfil) return semPermissao;
    if (perfil) permissoesDoPerfil = Array.isArray(perfil.permissoes) ? (perfil.permissoes as string[]) : [];
  }

  if (!podeDevolverAoAtendente({ permissoesDoPerfil, isAdmin: usuario.is_admin, isSuperAdm: usuario.is_super_adm })) {
    return semPermissao;
  }

  const resultado = await devolverPedidoAoAtendente(supabase, {
    idInt,
    autor: {
      uid: authData.user.id,
      nome: String(usuario.nome_usuario ?? "").trim() || authData.user.email || "Usuário"
    }
  });

  if (!resultado.success) {
    if (resultado.httpStatus >= 500) console.error("[API][DevolverAtendente]", resultado.code, resultado.message);
    return NextResponse.json(
      { success: false, code: resultado.code, message: resultado.message },
      { status: resultado.httpStatus }
    );
  }
  return NextResponse.json(resultado);
}
