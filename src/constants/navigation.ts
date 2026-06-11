import {
  BarChart3,
  Bot,
  Boxes,
  Building2,
  CheckSquare,
  ClipboardList,
  CreditCard,
  FileText,
  Gauge,
  Package,
  ReceiptText,
  Settings,
  ShieldCheck,
  Truck,
  Users
} from "lucide-react";
import type { NavigationItem } from "@/lib/types";

export const navigationItems: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: Gauge },
  { label: "Cadastros", href: "/cadastros", icon: Users },
  { label: "Verificação CPF/CNPJ", href: "/verificacao", icon: ShieldCheck },
  { label: "Produtos", href: "/produtos", icon: Package },
  { label: "Orcamentos", href: "/orcamentos", icon: ClipboardList },
  { label: "Pendências", href: "/pendencias", icon: CheckSquare },
  { label: "Maestro", href: "/maestro", icon: Bot, disabled: true },
  { label: "Conferência", href: "/cobrancas", icon: CreditCard },
  { label: "Contas a receber", href: "/contas-a-receber", icon: ReceiptText },
  { label: "Notas fiscais", href: "/notas-fiscais", icon: FileText },
  { label: "Pedidos", href: "/pedidos", icon: Boxes },
  { label: "OS / Producao", href: "/os-producao", icon: Building2 },
  { label: "Expedicao", href: "/expedicao", icon: Truck },
  { label: "Relatorios", href: "/relatorios", icon: BarChart3, disabled: true },
  {
    label: "Configuracoes",
    href: "/configuracoes",
    icon: Settings,
    children: [
      { label: "Usuários e Perfis", href: "/configuracoes/usuarios" },
      { label: "Perfis e Permissões", href: "/configuracoes/perfis" },
      { label: "Empresas", href: "/configuracoes/empresas", disabled: true },
      { label: "Integrações", href: "/configuracoes/integracoes", disabled: true },
      { label: "Faturamento e Cobranças", href: "/configuracoes/faturamento", disabled: true },
      { label: "Parâmetros Fiscais", href: "/configuracoes/fiscal", disabled: true }
    ]
  }
];


