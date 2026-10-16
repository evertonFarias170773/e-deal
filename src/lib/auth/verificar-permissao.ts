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

/**
 * Super administrador ou administrador (`usuarios.is_super_adm` / `is_admin`),
 * conferido no servidor (16/10/2026, NBS editável da NFS-e). É o mesmo corte
 * de `cc__assert_permissao(uid, '__ADMIN__')` no banco: perfil com "*" não
 * conta como administrador aqui.
 */
export async function ehAdministradorServerSide(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("usuarios")
    .select("is_super_adm, is_admin")
    .eq("user_id", userId)
    .maybeSingle();
  const linha = data as { is_super_adm?: boolean | null; is_admin?: boolean | null } | null;
  return Boolean(linha?.is_super_adm || linha?.is_admin);
}
