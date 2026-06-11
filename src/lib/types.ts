import type { LucideIcon } from "lucide-react";

export type UserSector = "COMERCIAL" | "FINANCEIRO" | "FISCAL" | "PRODUCAO" | "ADMIN";

/**
 * Slugs válidos dos perfis cadastrados em public.perfis.
 * Espelha os slugs do seed do banco.
 */
export type PerfilSlug =
  | "super_admin"
  | "admin"
  | "financeiro"
  | "vendedor"
  | "producao"
  | "fiscal"
  | "operador";

/**
 * Dados de um perfil lidos de public.perfis.
 */
export type PerfilData = {
  id: number;
  slug: PerfilSlug | string;
  nome: string;
  descricao?: string | null;
  permissoes: string[]; // ex: ["cobrancas.view", "cobrancas.aprovar"]
  ativo: boolean;
};

export type MockUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  sector: UserSector;
  companyId: number;
  isAdmin: boolean;
  isGerente?: boolean;
  isSuperAdmin: boolean;
  isSeller: boolean;
  /** Slug do perfil atribuído via public.perfis (Fase 1). Opcional — fallback via flags legadas. */
  perfilSlug?: PerfilSlug | string;
  /** Permissões resolvidas do perfil ou fallback legado. */
  permissoes?: string[];
  /** ID do perfil atribuído via public.perfis (Fase 1). Opcional. */
  id_perfil?: number | null;
};

export type Company = {
  id: number;
  name: string;
  shortName: string;
  document: string;
  isConsolidated?: boolean;
};

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  disabled?: boolean;
  children?: {
    label: string;
    href: string;
    disabled?: boolean;
  }[];
};


export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral" | "special";

export type DashboardMetric = {
  title: string;
  value: string;
  description: string;
  tone: StatusTone;
  trend?: string;
};

export type GlobalSearchResult = {
  id: string;
  type: "Cliente" | "Proposta" | "Pedido" | "OS" | "Boleto" | "NF-e" | "Documento" | "Produto";
  title: string;
  description: string;
  href: string;
};

