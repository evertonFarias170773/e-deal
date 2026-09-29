/**
 * POST /api/admin/usuarios/perfil — troca o perfil (`usuarios.id_perfil`) de um
 * usuário. Unica porta para essa coluna desde 29/09/2026.
 *
 * POR QUE UMA ROTA
 *   A tela Configuracoes → Usuarios gravava `id_perfil` direto pelo PostgREST,
 *   e a policy `usuarios_upd` (true/true) deixava qualquer usuario logado
 *   alterar a linha de qualquer outro — inclusive se promover a Super Admin.
 *   A policy sai; a troca de perfil passa por aqui, com a checagem no servidor e
 *   a gravacao pela service role.
 *
 * AS REGRAS (decisao do dono, 29/09/2026)
 *   - exige `admin.usuarios.edit` (o Super Admin passa pelo curinga);
 *   - ninguem troca o proprio perfil;
 *   - so Super Admin da ou tira o perfil Super Administrador (o perfil com `*`)
 *     ou altera o perfil de quem ja e Super Admin.
 *   "Super Admin" e o mesmo criterio da tela (`usuarios.service.ts`): perfil
 *   ativo com `*`, ou `is_super_adm` para quem nao tem perfil.
 *
 * O AUTOR
 *   Gravando com a service role, o audit.logs_v2 registra a mudanca (antes e
 *   depois) com `actor_role = service_role`, mas sem o usuario. Quem fez vai no
 *   log do servidor e na resposta.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERMISSAO = "admin.usuarios.edit";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type UsuarioRow = {
  user_id: string;
  email: string | null;
  nome_usuario: string | null;
  id_perfil: number | null;
  is_super_adm: boolean | null;
};

type PerfilRow = { id: number; nome: string | null; ativo: boolean | null; permissoes: unknown };

function recusa(message: string, status: number, code: string) {
  return NextResponse.json({ success: false, code, message }, { status });
}

function permissoesDe(perfil: PerfilRow | null | undefined): string[] {
  return perfil && perfil.ativo && Array.isArray(perfil.permissoes)
    ? (perfil.permissoes as unknown[]).map((p) => String(p))
    : [];
}

function perfilEhSuperAdmin(perfil: PerfilRow | null | undefined): boolean {
  return permissoesDe(perfil).includes("*");
}

/** Mesmo criterio da tela: com perfil ativo decide o perfil; sem ele, `is_super_adm`. */
function usuarioEhSuperAdmin(usuario: UsuarioRow, perfil: PerfilRow | null | undefined): boolean {
  if (perfil && perfil.ativo) return perfilEhSuperAdmin(perfil);
  return usuario.is_super_adm === true;
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    console.error("[admin/usuarios/perfil] ENV AUSENTE");
    return recusa("Configuração de ambiente incompleta.", 500, "ENV");
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return recusa("Sessão não encontrada.", 401, "SEM_SESSAO");

  let corpo: { userId?: unknown; idPerfil?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return recusa("Corpo da requisição inválido.", 400, "PAYLOAD_INVALIDO");
  }
  const alvoId = String(corpo.userId ?? "").trim();
  if (!UUID_RE.test(alvoId)) return recusa("Usuário inválido.", 400, "PAYLOAD_INVALIDO");
  const idPerfilNovo =
    corpo.idPerfil === null || corpo.idPerfil === undefined || corpo.idPerfil === "" ? null : Number(corpo.idPerfil);
  if (idPerfilNovo !== null && (!Number.isInteger(idPerfilNovo) || idPerfilNovo <= 0)) {
    return recusa("Perfil inválido.", 400, "PAYLOAD_INVALIDO");
  }

  // Sessão de quem pede: valida o token.
  const clienteUsuario = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authData, error: authError } = await clienteUsuario.auth.getUser();
  if (authError || !authData.user) return recusa("Sessão inválida ou expirada.", 401, "SESSAO_INVALIDA");
  const autorId = authData.user.id;

  // Daqui em diante tudo é lido e gravado pela service role: a decisão não pode
  // depender do que a RLS deixa o próprio solicitante ver.
  const service = createSupabaseClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const idsUsuarios = autorId === alvoId ? [autorId] : [autorId, alvoId];
  const { data: usuariosData, error: usuariosErr } = await service
    .from("usuarios")
    .select("user_id, email, nome_usuario, id_perfil, is_super_adm")
    .in("user_id", idsUsuarios);
  if (usuariosErr) {
    console.error("[admin/usuarios/perfil] leitura de usuarios:", usuariosErr.message);
    return recusa("Não foi possível ler os usuários.", 500, "LEITURA");
  }
  const usuarios = (usuariosData ?? []) as UsuarioRow[];
  const autor = usuarios.find((u) => u.user_id === autorId);
  const alvo = usuarios.find((u) => u.user_id === alvoId);
  if (!autor) return recusa("Seu usuário não foi encontrado.", 403, "SEM_PERMISSAO");
  if (!alvo) return recusa("Usuário não encontrado.", 404, "ALVO_NAO_ENCONTRADO");

  const idsPerfis = Array.from(
    new Set([autor.id_perfil, alvo.id_perfil, idPerfilNovo].filter((id): id is number => typeof id === "number"))
  );
  const { data: perfisData, error: perfisErr } = idsPerfis.length
    ? await service.from("perfis").select("id, nome, ativo, permissoes").in("id", idsPerfis)
    : { data: [], error: null };
  if (perfisErr) {
    console.error("[admin/usuarios/perfil] leitura de perfis:", perfisErr.message);
    return recusa("Não foi possível ler os perfis.", 500, "LEITURA");
  }
  const perfis = new Map(((perfisData ?? []) as PerfilRow[]).map((p) => [p.id, p]));
  const perfilAutor = autor.id_perfil != null ? perfis.get(autor.id_perfil) : null;
  const perfilAtualAlvo = alvo.id_perfil != null ? perfis.get(alvo.id_perfil) : null;
  const perfilNovo = idPerfilNovo != null ? perfis.get(idPerfilNovo) : null;

  // 1. A permissão, pelo MESMO helper das outras rotas (super admin, perfil
  // ativo com `*` ou a chave, e `is_admin` só para quem não tem perfil).
  const autorSuper = usuarioEhSuperAdmin(autor, perfilAutor);
  const autorTemChave = await verificarPermissaoServerSide(service, autorId, PERMISSAO);
  if (!autorTemChave) {
    return recusa(`Sem permissão para trocar perfis (${PERMISSAO}).`, 403, "SEM_PERMISSAO");
  }

  // 2. Ninguém troca o próprio perfil.
  if (autorId === alvoId) {
    return recusa("Você não pode trocar o seu próprio perfil.", 403, "PROPRIO_PERFIL");
  }

  // 3. O perfil de destino precisa existir e estar ativo.
  if (idPerfilNovo !== null && (!perfilNovo || !perfilNovo.ativo)) {
    return recusa("Perfil não encontrado ou inativo.", 400, "PERFIL_INVALIDO");
  }

  // 4. Super Admin: só outro Super Admin dá, tira ou mexe.
  const alvoSuper = usuarioEhSuperAdmin(alvo, perfilAtualAlvo);
  const envolveSuper = alvoSuper || perfilEhSuperAdmin(perfilAtualAlvo) || perfilEhSuperAdmin(perfilNovo);
  if (envolveSuper && !autorSuper) {
    return recusa(
      "Só um Super Administrador pode dar ou tirar o perfil Super Administrador, ou alterar o perfil de um Super Administrador.",
      403,
      "SO_SUPER_ADMIN"
    );
  }

  if ((alvo.id_perfil ?? null) === idPerfilNovo) {
    return NextResponse.json({ success: true, alterado: false, idPerfil: idPerfilNovo });
  }

  const { data: gravado, error: gravarErr } = await service
    .from("usuarios")
    .update({ id_perfil: idPerfilNovo })
    .eq("user_id", alvoId)
    .select("user_id, id_perfil");
  if (gravarErr || !gravado || gravado.length !== 1) {
    console.error("[admin/usuarios/perfil] gravação:", gravarErr?.message ?? `linhas=${gravado?.length ?? 0}`);
    return recusa("Não foi possível gravar o perfil.", 500, "GRAVACAO");
  }

  const registro = {
    autor: { uid: autorId, email: authData.user.email ?? autor.email ?? null, nome: autor.nome_usuario ?? null },
    alvo: { uid: alvoId, email: alvo.email ?? null },
    perfilAnterior: alvo.id_perfil ?? null,
    perfilNovo: idPerfilNovo,
    em: new Date().toISOString()
  };
  console.info("[admin/usuarios/perfil] perfil alterado", JSON.stringify(registro));

  return NextResponse.json({ success: true, alterado: true, idPerfil: idPerfilNovo, registro });
}
