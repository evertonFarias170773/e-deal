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
  Users,
  Wallet
} from "lucide-react";
import type { NavigationItem } from "@/lib/types";

export const navigationItems: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: Gauge },
  { label: "Cadastros", href: "/cadastros", icon: Users },
  { label: "Verificação CPF/CNPJ", href: "/verificacao", icon: ShieldCheck },
  { label: "Produtos", href: "/produtos", icon: Package },
  { label: "Orcamentos", href: "/orcamentos", icon: ClipboardList },
  { label: "Pendências", href: "/pendencias", icon: CheckSquare },
  { label: "Conta Corrente", href: "/conta-corrente", icon: Wallet },
  { label: "Maestro", href: "/maestro", icon: Bot },
  { label: "Conferência", href: "/cobrancas", icon: CreditCard },
  { label: "Contas a receber", href: "/contas-a-receber", icon: ReceiptText },
  { label: "Notas fiscais", href: "/notas-fiscais", icon: FileText },
  { 
    label: "Pedidos", 
    href: "/pedidos", 
    icon: Boxes,
    children: [
      { label: "Painel geral", href: "/pedidos" },
      { label: "Fila de impressão", href: "/pedidos/impressao" }
    ]
  },
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


