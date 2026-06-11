import { getSupabaseClient } from "@/lib/supabase/client";
import type { PerfilDoCatalogo, UsuarioComPerfil } from "../types";

/**
 * Busca a listagem de usuários do banco de dados `public.usuarios`
 * realizando um join com a tabela de catálogo `public.perfis`.
 * 
 * ⚠️ Segura: Ordenação feita por 'email' para contornar problemas de 'nome_usuario' nulos no banco.
 */
export async function listUsuariosComPerfil(): Promise<UsuarioComPerfil[]> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Cliente Supabase não configurado no ambiente.");
  }

  const { data, error } = await client
    .from("usuarios")
    .select(`
      user_id,
      email,
      nome_usuario,
      is_admin,
      is_super_adm,
      is_vendedor,
      id_empresa,
      setor,
      id_perfil,
      perfis:id_perfil (
        id,
        slug,
        nome
      )
    `)
    .order("email"); // Ordenação segura por email (nunca é nulo no banco)

  if (error) {
    console.error("[UsuariosPerfisService] Erro ao buscar listUsuariosComPerfil:", error.message);
    throw new Error(`Erro ao carregar usuários: ${error.message}`);
  }

  return (data || []) as unknown as UsuarioComPerfil[];
}

/**
 * Busca a lista de perfis do catálogo ativos em `public.perfis`
 * para preencher o formulário/select de alteração de perfil.
 */
export async function listPerfisDoCatalogo(): Promise<PerfilDoCatalogo[]> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Cliente Supabase não configurado no ambiente.");
  }

  const { data, error } = await client
    .from("perfis")
    .select("id, slug, nome, descricao, permissoes, ativo")
    .eq("ativo", true)
    .order("nome");

  if (error) {
    console.error("[UsuariosPerfisService] Erro ao buscar listPerfisDoCatalogo:", error.message);
    throw new Error(`Erro ao carregar catálogo de perfis: ${error.message}`);
  }

  return data || [];
}

/**
 * Atualiza unicamente a coluna `id_perfil` na tabela `public.usuarios`.
 * 
 * ⚠️ Rígida segurança de escrita: O payload de gravação contém estritamente o campo 'id_perfil'.
 * Nenhuma outra coluna é aceita ou enviada nesta camada, mitigando riscos em produção.
 */
export async function updatePerfilUsuario(
  userId: string,
  idPerfil: number | null
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Cliente Supabase não configurado no ambiente.");
  }

  // Whitelist explícita de campos a serem modificados: apenas id_perfil.
  // Evita que modificações em outros atributos sejam injetadas.
  const payload = {
    id_perfil: idPerfil
  };

  const { error } = await client
    .from("usuarios")
    .update(payload)
    .eq("user_id", userId);

  if (error) {
    console.error("[UsuariosPerfisService] Erro ao atualizar perfil do usuário:", error.message);
    throw new Error(`Não foi possível salvar a alteração: ${error.message}`);
  }
}
