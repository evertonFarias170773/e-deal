import type { UsuarioComPerfil } from "../types";

export interface PerfilResolvido {
  slug: string;
  nome: string;
  origem: "banco" | "fallback";
}

/**
 * Resolve dinamicamente o perfil efetivo e sua origem para exibição na UI
 * seguindo as mesmas regras do usuarios.service.ts.
 */
export function resolvePerfilEfetivo(usuario: UsuarioComPerfil): PerfilResolvido {
  // 1. Se possui perfil resolvido no banco de dados
  if (usuario.id_perfil != null && usuario.perfis) {
    return {
      slug: usuario.perfis.slug,
      nome: usuario.perfis.nome,
      origem: "banco"
    };
  }

  // 2. Fallbacks de compatibilidade baseados em flags legadas do banco
  if (usuario.is_super_adm) {
    return {
      slug: "super_admin",
      nome: "Super Administrador (Fallback)",
      origem: "fallback"
    };
  }

  if (usuario.is_admin) {
    return {
      slug: "admin",
      nome: "Administrador (Fallback)",
      origem: "fallback"
    };
  }

  if (usuario.is_vendedor) {
    return {
      slug: "vendedor",
      nome: "Vendedor (Fallback)",
      origem: "fallback"
    };
  }

  // Fallbacks baseados no setor do usuário
  const setor = usuario.setor?.toUpperCase() ?? "";
  switch (setor) {
    case "FINANCEIRO":
      return {
        slug: "financeiro",
        nome: "Financeiro (Fallback)",
        origem: "fallback"
      };
    case "FISCAL":
      return {
        slug: "fiscal",
        nome: "Fiscal (Fallback)",
        origem: "fallback"
      };
    case "PRODUCAO":
      return {
        slug: "producao",
        nome: "Produção (Fallback)",
        origem: "fallback"
      };
    case "COMERCIAL":
      return {
        slug: "vendedor",
        nome: "Vendedor (Fallback)",
        origem: "fallback"
      };
    default:
      return {
        slug: "operador",
        nome: "Operador (Fallback)",
        origem: "fallback"
      };
  }
}
