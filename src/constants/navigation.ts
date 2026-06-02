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
  Truck,
  Users
} from "lucide-react";
import type { NavigationItem } from "@/lib/types";

export const navigationItems: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: Gauge },
  { label: "Cadastros", href: "/cadastros", icon: Users },
  { label: "Produtos", href: "/produtos", icon: Package },
  { label: "Orcamentos", href: "/orcamentos", icon: ClipboardList },
  { label: "Pendências", href: "/pendencias", icon: CheckSquare },
  { label: "Maestro", href: "/maestro", icon: Bot, disabled: true },
  { label: "Conferência", href: "/cobrancas", icon: CreditCard },
  { label: "Contas a receber", href: "/contas-a-receber", icon: ReceiptText },
  { label: "Notas fiscais", href: "/notas-fiscais", icon: FileText, disabled: true },
  { label: "Pedidos", href: "/pedidos", icon: Boxes },
  { label: "OS / Producao", href: "/os-producao", icon: Building2 },
  { label: "Expedicao", href: "/expedicao", icon: Truck },
  { label: "Relatorios", href: "/relatorios", icon: BarChart3, disabled: true },
  { label: "Configuracoes", href: "/configuracoes", icon: Settings, disabled: true }
];
