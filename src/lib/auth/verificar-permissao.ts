import type { SupabaseClient } from "@supabase/supabase-js";

type UsuarioMinRow = {
  id_perfil: number | null;
  is_super_adm: boolean;
  is_admin: boolean;
};

type PerfilMinRow = {
  permissoes: string[];
};

/**
 * Verifica se o usuário autenticado possui a permissão especificada.
 * Consulta public.usuarios e public.perfis no banco.
 *
 * Lógica:
 * 1. Busca usuario por user_id (auth.uid)
 * 2. Se is_super_adm → true
 * 3. Se tem id_perfil → consulta perfis.permissoes → verifica wildcard "*" ou match exato
 * 4. Fallback: is_admin
 */
export async function verificarPermissaoServerSide(
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  permissao: string
): Promise<boolean> {
  const { data: usuarioData } = await supabase
    .from("usuarios")
    .select("id_perfil, is_super_adm, is_admin")
    .eq("user_id", userId)
    .maybeSingle();

  if (!usuarioData) return false;

  const row = usuarioData as UsuarioMinRow;

  if (row.is_super_adm) return true;

  if (row.id_perfil != null) {
    const { data: perfilData } = await supabase
      .from("perfis")
      .select("permissoes")
      .eq("id", row.id_perfil)
      .eq("ativo", true)
      .maybeSingle();

    if (perfilData) {
      const perfil = perfilData as PerfilMinRow;
      const permissoes: string[] = Array.isArray(perfil.permissoes)
        ? perfil.permissoes
        : [];
      return permissoes.includes("*") || permissoes.includes(permissao);
    }
  }

  return row.is_admin;
}
