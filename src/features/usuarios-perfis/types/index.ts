export interface PerfilDoCatalogo {
  id: number;
  slug: string;
  nome: string;
  descricao: string | null;
  permissoes: string[];
  ativo: boolean;
}

export interface UsuarioComPerfil {
  user_id: string;
  email: string;
  nome_usuario: string | null;
  is_admin: boolean;
  is_super_adm: boolean;
  is_vendedor: boolean;
  id_empresa: number | null;
  setor: string | null;
  id_perfil: number | null;
  // Join opcional com public.perfis
  perfis?: {
    id: number;
    slug: string;
    nome: string;
  } | null;
  // Propriedades resolvidas dinamicamente no frontend para exibição e filtragem
  perfilEfetivoSlug: string;
  perfilEfetivoNome: string;
  origemPerfil: "banco" | "fallback";
}

export interface FiltrosUsuariosPerfis {
  busca: string;
  perfilSlug: string;
  origem: "" | "banco" | "fallback";
}
