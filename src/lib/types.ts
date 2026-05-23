import type { LucideIcon } from "lucide-react";

export type UserSector = "COMERCIAL" | "FINANCEIRO" | "FISCAL" | "PRODUCAO" | "ADMIN";

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

