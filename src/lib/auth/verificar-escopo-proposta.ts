import type { SupabaseClient } from "@supabase/supabase-js";

type UsuarioEscopoRow = {
  id_perfil: number | null;
  is_super_adm: boolean;
  id_empresa: number | null;
  nome_usuario: string | null;
};

type PerfilPermissoesRow = {
  permissoes: string[];
};

type PropostaEscopo = {
  empresa: string | null;
  vendedor: string | null;
};

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Verifica se o usuário autenticado pode agir sobre a proposta informada,
 * replicando no servidor a mesma hierarquia de escopo do frontend
 * (getDataScope em usuarios.service.ts), com uma diferença deliberada:
 * aqui a AUSÊNCIA de qualquer permissão de escopo NEGA o acesso — não há
 * fallback para "all" (diferente do getDataScope, que é permissivo por
 * retrocompatibilidade). Escopo global só é concedido a super_admin ou a
 * quem tiver explicitamente "propostas.view_all".
 */
export async function verificarEscopoPropostaServerSide(
  supabase: SupabaseClient,
  userId: string,
  proposta: PropostaEscopo
): Promise<boolean> {
  const { data: usuarioData } = await supabase
    .from("usuarios")
    .select("id_perfil, is_super_adm, id_empresa, nome_usuario")
    .eq("user_id", userId)
    .maybeSingle();

  if (!usuarioData) return false;

  const usuario = usuarioData as UsuarioEscopoRow;

  if (usuario.is_super_adm) return true;

  let permissoes: string[] = [];
  if (usuario.id_perfil != null) {
    const { data: perfilData } = await supabase
      .from("perfis")
      .select("permissoes")
      .eq("id", usuario.id_perfil)
      .eq("ativo", true)
      .maybeSingle();

    if (perfilData) {
      const perfil = perfilData as PerfilPermissoesRow;
      permissoes = Array.isArray(perfil.permissoes) ? perfil.permissoes : [];
    }
  }

  if (permissoes.includes("*") || permissoes.includes("propostas.view_all")) {
    return true;
  }

  if (permissoes.includes("propostas.view_company")) {
    if (!proposta.empresa || usuario.id_empresa == null) return false;

    const { data: empresaData } = await supabase
      .from("empresas")
      .select("empresa")
      .eq("id", usuario.id_empresa)
      .maybeSingle();

    if (!empresaData?.empresa) return false;
    return normalize(proposta.empresa) === normalize(empresaData.empresa);
  }

  // "team" não tem modelo de dados no banco (sem tabela de equipes) — degrada
  // para "own", o comportamento mais restritivo e seguro disponível hoje.
  if (permissoes.includes("propostas.view_team") || permissoes.includes("propostas.view_own")) {
    if (!proposta.vendedor || !usuario.nome_usuario) return false;
    return normalize(proposta.vendedor) === normalize(usuario.nome_usuario);
  }

  // Sem nenhuma permissão de escopo definida: nega. Diferente de getDataScope
  // (frontend), que aqui faria fallback para "all" por retrocompatibilidade —
  // para uma ação destrutiva como cancelar, a ausência de escopo é negação.
  return false;
}
