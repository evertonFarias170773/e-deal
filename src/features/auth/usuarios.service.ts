/**
 * usuarios.service.ts
 *
 * Serviço responsável por buscar e enriquecer dados do usuário autenticado
 * a partir de public.usuarios e public.perfis.
 *
 * Fase 1 — Perfis e Permissões
 * - Busca dados reais de public.usuarios após login
 * - Resolve perfil via id_perfil → public.perfis (quando disponível)
 * - Fallback obrigatório via campos legados: is_super_adm, is_admin, is_vendedor, setor
 * - NUNCA lança exceção que possa bloquear o login — retorna null em caso de falha
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import type { MockUser, PerfilData, PerfilSlug, UserSector } from "@/lib/types";

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

type UsuarioRow = {
  user_id: string;
  email: string;
  nome_usuario: string;
  is_admin: boolean;
  is_super_adm: boolean;
  is_vendedor: boolean;
  id_empresa: number | null;
  setor: string | null;
  avatar: string | null;
  id_perfil: number | null;
};

type PerfilRow = {
  id: number;
  slug: string;
  nome: string;
  descricao: string | null;
  permissoes: string[];
  ativo: boolean;
};

// ---------------------------------------------------------------------------
// Permissões de fallback por flags legadas
// Usadas quando id_perfil IS NULL
// ---------------------------------------------------------------------------

const PERMISSOES_SUPER_ADMIN: string[] = ["*"];

const PERMISSOES_ADMIN: string[] = [
  "propostas.view", "propostas.create", "propostas.edit", "propostas.aprovar",
  "cobrancas.view", "cobrancas.aprovar", "cobrancas.emitir_boleto",
  "financeiro.view", "financeiro.aprovar",
  "pedidos.view", "pedidos.create", "pedidos.edit",
  "cadastros.view", "cadastros.edit",
  "fiscal.view", "fiscal.emitir",
  "admin.usuarios.view", "admin.usuarios.edit"
];

const PERMISSOES_VENDEDOR: string[] = [
  "propostas.view", "propostas.create", "propostas.edit",
  "pedidos.view", "pedidos.create",
  "cadastros.view", "cadastros.edit",
  "cobrancas.view"
];

const PERMISSOES_FINANCEIRO: string[] = [
  "cobrancas.view", "cobrancas.aprovar", "cobrancas.emitir_boleto",
  "financeiro.view", "financeiro.aprovar",
  "propostas.view", "pedidos.view", "cadastros.view"
];

const PERMISSOES_FISCAL: string[] = [
  "fiscal.view", "fiscal.emitir",
  "propostas.view", "pedidos.view", "cadastros.view"
];

const PERMISSOES_PRODUCAO: string[] = [
  "pedidos.view", "pedidos.edit",
  "propostas.view", "cadastros.view"
];

const PERMISSOES_OPERADOR: string[] = [
  "propostas.view", "pedidos.view", "cadastros.view"
];

const PERMISSOES_POR_SETOR: Record<string, string[]> = {
  FINANCEIRO: PERMISSOES_FINANCEIRO,
  FISCAL: PERMISSOES_FISCAL,
  PRODUCAO: PERMISSOES_PRODUCAO,
  COMERCIAL: PERMISSOES_VENDEDOR,
  ADMIN: PERMISSOES_ADMIN
};

// ---------------------------------------------------------------------------
// Resolução de fallback legado → permissões
// ---------------------------------------------------------------------------

function resolvePermissoesFallback(row: UsuarioRow): {
  perfilSlug: PerfilSlug;
  permissoes: string[];
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isSeller: boolean;
} {
  if (row.is_super_adm) {
    return {
      perfilSlug: "super_admin",
      permissoes: PERMISSOES_SUPER_ADMIN,
      isAdmin: true,
      isSuperAdmin: true,
      isSeller: row.is_vendedor
    };
  }

  if (row.is_admin) {
    return {
      perfilSlug: "admin",
      permissoes: PERMISSOES_ADMIN,
      isAdmin: true,
      isSuperAdmin: false,
      isSeller: row.is_vendedor
    };
  }

  if (row.is_vendedor) {
    return {
      perfilSlug: "vendedor",
      permissoes: PERMISSOES_VENDEDOR,
      isAdmin: false,
      isSuperAdmin: false,
      isSeller: true
    };
  }

  const setor = row.setor?.toUpperCase() ?? "";
  const permissoes = PERMISSOES_POR_SETOR[setor] ?? PERMISSOES_OPERADOR;
  const perfilSlug = (setor.toLowerCase() as PerfilSlug) || "operador";

  return {
    perfilSlug,
    permissoes,
    isAdmin: false,
    isSuperAdmin: false,
    isSeller: false
  };
}

// ---------------------------------------------------------------------------
// Normalizar setor legado → UserSector
// ---------------------------------------------------------------------------

function normalizeSetor(setor: string | null): UserSector {
  const upper = setor?.toUpperCase() ?? "";
  const validSetores: UserSector[] = ["COMERCIAL", "FINANCEIRO", "FISCAL", "PRODUCAO", "ADMIN"];
  return validSetores.includes(upper as UserSector) ? (upper as UserSector) : "ADMIN";
}

// ---------------------------------------------------------------------------
// Função principal: buscar e enriquecer usuário
// ---------------------------------------------------------------------------

/**
 * Busca dados reais de public.usuarios + public.perfis para o usuário autenticado.
 * Retorna um objeto `MockUser` enriquecido com perfilSlug e permissoes.
 *
 * Em caso de qualquer falha (RLS, rede, tabela inexistente), retorna null.
 * O AuthProvider deve usar isso como enriquecimento opcional — nunca bloquear o login.
 */
export async function fetchUsuarioEnriquecido(
  authUserId: string,
  authEmail: string | undefined,
  authDisplayName: string | undefined
): Promise<Partial<MockUser> | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    // 1. Buscar dados de public.usuarios
    const { data: usuarioData, error: usuarioError } = await client
      .from("usuarios")
      .select("user_id, email, nome_usuario, is_admin, is_super_adm, is_vendedor, id_empresa, setor, avatar, id_perfil")
      .eq("user_id", authUserId)
      .maybeSingle();

    if (usuarioError) {
      console.warn("[UsuariosService] Erro ao buscar public.usuarios:", usuarioError.message);
      return null;
    }

    if (!usuarioData) {
      console.warn("[UsuariosService] Usuário não encontrado em public.usuarios:", authUserId);
      return null;
    }

    const row = usuarioData as UsuarioRow;

    // 2. Se tem id_perfil, buscar dados do perfil
    let perfilResolvido: { perfilSlug: string; permissoes: string[] } | null = null;

    if (row.id_perfil != null) {
      const { data: perfilData, error: perfilError } = await client
        .from("perfis")
        .select("id, slug, nome, descricao, permissoes, ativo")
        .eq("id", row.id_perfil)
        .eq("ativo", true)
        .maybeSingle();

      if (perfilError) {
        console.warn("[UsuariosService] Erro ao buscar public.perfis:", perfilError.message);
        // Não bloquear — cai no fallback abaixo
      } else if (perfilData) {
        const perfil = perfilData as PerfilRow;
        perfilResolvido = {
          perfilSlug: perfil.slug,
          permissoes: Array.isArray(perfil.permissoes) ? perfil.permissoes : []
        };
      }
    }

    // 3. Se não resolveu via perfil, usar fallback legado
    const fallback = resolvePermissoesFallback(row);

    const perfilSlug = perfilResolvido?.perfilSlug ?? fallback.perfilSlug;
    const permissoes = perfilResolvido?.permissoes ?? fallback.permissoes;

    // 4. Montar objeto enriquecido
    const enriched: Partial<MockUser> = {
      name: row.nome_usuario || authDisplayName || (authEmail?.split("@")[0] ?? "Usuário"),
      email: row.email || authEmail || "",
      avatarUrl: row.avatar ?? undefined,
      sector: normalizeSetor(row.setor),
      companyId: row.id_empresa ?? 1,
      isAdmin: perfilResolvido ? permissoes.includes("*") || permissoes.includes("admin.usuarios.view") : fallback.isAdmin,
      isSuperAdmin: perfilResolvido ? permissoes.includes("*") : fallback.isSuperAdmin,
      isSeller: perfilResolvido ? permissoes.includes("propostas.create") : fallback.isSeller,
      perfilSlug,
      permissoes
    };

    return enriched;
  } catch (err) {
    console.error("[UsuariosService] Exceção ao buscar dados do usuário:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers de verificação de permissão (para uso futuro no frontend)
// ---------------------------------------------------------------------------

/**
 * Verifica se o usuário tem uma permissão específica.
 * Suporte ao wildcard "*" (super_admin).
 */
export function hasPermissao(user: MockUser | null | undefined, codigo: string): boolean {
  if (!user) return false;
  if (!user.permissoes || user.permissoes.length === 0) {
    // Fallback: super admin e admin têm tudo
    return user.isSuperAdmin || user.isAdmin;
  }
  return user.permissoes.includes("*") || user.permissoes.includes(codigo);
}

/**
 * Verifica se o usuário tem TODAS as permissões informadas.
 */
export function hasAllPermissoes(user: MockUser | null | undefined, codigos: string[]): boolean {
  return codigos.every((c) => hasPermissao(user, c));
}

/**
 * Verifica se o usuário tem ALGUMA das permissões informadas.
 */
export function hasAnyPermissao(user: MockUser | null | undefined, codigos: string[]): boolean {
  return codigos.some((c) => hasPermissao(user, c));
}

// Re-export tipo para uso no AuthProvider e components
export type { PerfilData };
