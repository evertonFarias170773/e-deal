import {
  BarChart3,
  Banknote,
  Blocks,
  Bot,
  Boxes,
  Building2,
  CheckSquare,
  ClipboardList,
  CreditCard,
  FileText,
  FolderOpen,
  Gauge,
  KeyRound,
  Package,
  Receipt,
  ReceiptText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  UserCog,
  Users,
  Wallet,
  Zap
} from "lucide-react";
import type { NavigationItem, NavigationSection } from "@/lib/types";

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
  {
    label: "Contas a receber",
    href: "/contas-a-receber",
    icon: ReceiptText,
    children: [
      { label: "Carteira", href: "/contas-a-receber" },
      { label: "Registro de recebíveis", href: "/contas-a-receber/registro" }
    ]
  },
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

// --- Menu reorganizado por seções (modelo "Acordeão por seção") ---
// Reutiliza os mesmos hrefs/ícones de navigationItems; labels com acentuação corrigida.
// navigationItems (acima) é mantido intacto como fallback do menu antigo.

export const quickAccessItems: NavigationItem[] = [
  { label: "Orçamentos", href: "/orcamentos", icon: ClipboardList },
  { label: "Conferência", href: "/cobrancas", icon: CreditCard }
];

export const navigationSections: NavigationSection[] = [
  {
    id: "operacao",
    label: "Operação",
    icon: Zap,
    items: [
      { label: "Dashboard", href: "/dashboard", icon: Gauge },
      { label: "Orçamentos", href: "/orcamentos", icon: ClipboardList },
      {
        label: "Pedidos",
        href: "/pedidos",
        icon: Boxes,
        children: [
          { label: "Painel geral", href: "/pedidos" },
          { label: "Fila de impressão", href: "/pedidos/impressao" }
        ]
      },
      { label: "Conferência", href: "/cobrancas", icon: CreditCard },
      { label: "Expedição", href: "/expedicao", icon: Truck },
      { label: "Maestro", href: "/maestro", icon: Bot }
    ]
  },
  {
    id: "cadastros",
    label: "Cadastros",
    icon: FolderOpen,
    items: [
      { label: "Cadastros", href: "/cadastros", icon: Users },
      { label: "Produtos", href: "/produtos", icon: Package },
      { label: "Verificação CPF/CNPJ", href: "/verificacao", icon: ShieldCheck }
    ]
  },
  {
    id: "financeiro",
    label: "Financeiro",
    icon: Banknote,
    items: [
      {
        label: "Contas a receber",
        href: "/contas-a-receber",
        icon: ReceiptText,
        children: [
          { label: "Carteira", href: "/contas-a-receber" },
          { label: "Registro de recebíveis", href: "/contas-a-receber/registro" }
        ]
      },
      { label: "Conta Corrente", href: "/conta-corrente", icon: Wallet },
      { label: "Pendências", href: "/pendencias", icon: CheckSquare },
      { label: "Notas fiscais", href: "/notas-fiscais", icon: FileText },
      { label: "Relatórios", href: "/relatorios", icon: BarChart3, disabled: true }
    ]
  },
  {
    id: "config",
    label: "Configurações",
    icon: Settings,
    requiresConfigPerm: true,
    items: [
      { label: "Usuários e Perfis", href: "/configuracoes/usuarios", icon: UserCog },
      { label: "Perfis e Permissões", href: "/configuracoes/perfis", icon: KeyRound },
      { label: "Empresas", href: "/configuracoes/empresas", icon: Building2, disabled: true },
      { label: "Integrações", href: "/configuracoes/integracoes", icon: Blocks, disabled: true },
      { label: "Faturamento e Cobranças", href: "/configuracoes/faturamento", icon: Receipt, disabled: true },
      { label: "Parâmetros Fiscais", href: "/configuracoes/fiscal", icon: SlidersHorizontal, disabled: true }
    ]
  }
];


