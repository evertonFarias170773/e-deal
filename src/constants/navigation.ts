import {
  BarChart3,
  Banknote,
  Blocks,
  Bot,
  Boxes,
  Building2,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Package,
  Printer,
  Receipt,
  ReceiptText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  Wallet
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

/**
 * Acesso rapido esvaziado em 21/08/2026.
 *
 * Eram atalhos para Orcamentos e Conferencia, as duas telas que agora abrem a
 * lista do menu (itens 1 e 2) — o atalho repetia o que estava logo abaixo.
 * A constante continua existindo, e os dois menus continuam mapeando-a, para
 * que voltar a ter atalhos seja so repopular esta lista.
 */
export const quickAccessItems: NavigationItem[] = [];

/**
 * Ordem do menu definida em 21/08/2026.
 *
 * A sequencia segue o caminho do pedido dentro da casa — conferir, vender,
 * cadastrar cliente, expedir; depois producao e financeiro; depois as telas de
 * apoio. Os separadores (`separatorAfter`) marcam as tres quebras desse
 * caminho, sem criar nivel novo de hierarquia.
 *
 * ROTULO NAO E ROTA. Tres itens mudaram de NOME e nenhum mudou de ENDERECO:
 *   - "PEDIDOS"   aponta para /orcamentos  (modulo src/features/orcamentos)
 *   - "CLIENTES"  aponta para /cadastros
 *   - "PRODUCAO"  aponta para /pedidos     (o antigo "Painel geral")
 * Rotas, pastas, chaves de permissao e filtros por URL ficam como estao, entao
 * link salvo e favorito continuam abrindo a mesma tela.
 *
 * Cuidado ao ler: as chaves de permissao `pedidos.*` governam a tela que agora
 * se chama PRODUCAO, e a tela que agora se chama PEDIDOS e governada por
 * `propostas.*`. O nome da chave nao acompanhou o rotulo de proposito.
 */
export const navigationSections: NavigationSection[] = [
  // 1
  {
    id: "conferencia",
    label: "Conferência",
    icon: CreditCard,
    href: "/cobrancas",
    items: []
  },
  // 2 — era "Orçamentos"; a rota /orcamentos nao muda.
  {
    id: "pedidos-comercial",
    label: "Pedidos",
    icon: ClipboardList,
    href: "/orcamentos",
    items: []
  },
  // 3 — era submenu de "Cadastros".
  {
    id: "clientes",
    label: "Clientes",
    icon: Users,
    href: "/cadastros",
    items: []
  },
  // 4 — era submenu de "Pedidos".
  {
    id: "expedicao",
    label: "Expedição",
    icon: Truck,
    href: "/expedicao",
    separatorAfter: true,
    items: []
  },
  // 5 — era "Painel geral", dentro de "Pedidos".
  {
    id: "producao",
    label: "Produção",
    icon: LayoutDashboard,
    href: "/pedidos",
    items: []
  },
  // 6 — "Notas fiscais" deixa de ser menu proprio e vira o primeiro submenu.
  {
    id: "financeiro",
    label: "Financeiro",
    icon: Banknote,
    separatorAfter: true,
    items: [
      { label: "Notas fiscais", href: "/notas-fiscais", icon: FileText },
      { label: "Carteira", href: "/contas-a-receber", icon: ReceiptText },
      { label: "Registro de recebíveis", href: "/contas-a-receber/registro", icon: ClipboardCheck },
      { label: "Conta Corrente", href: "/conta-corrente", icon: Wallet },
      { label: "Pendências", href: "/pendencias", icon: CheckSquare },
      { label: "Verificação de CPF/CNPJ", href: "/verificacao", icon: ShieldCheck },
      // Segue desabilitado, como sempre esteve. Mantido para nao sumir do menu.
      { label: "Relatórios", href: "/relatorios", icon: BarChart3, disabled: true }
    ]
  },
  // 7
  {
    id: "maestro",
    label: "Maestro",
    icon: Bot,
    href: "/maestro",
    separatorAfter: true,
    items: []
  },
  // 8
  {
    id: "dashboard",
    label: "Dashboard",
    icon: Gauge,
    href: "/dashboard",
    hiddenForSeller: true,
    items: []
  },
  // 9
  {
    id: "meu-desempenho",
    label: "Meu desempenho",
    icon: TrendingUp,
    href: "/meu-desempenho",
    sellerOnly: true,
    items: []
  },
  // 10 — era submenu de "Cadastros".
  {
    id: "produtos",
    label: "Produtos",
    icon: Package,
    href: "/produtos",
    items: []
  },
  // 11
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
      { label: "Parâmetros Fiscais", href: "/configuracoes/fiscal", icon: SlidersHorizontal, disabled: true },
      // href placeholder: item desabilitado, a rota ainda não existe (não colidir com /configuracoes/usuarios).
      { label: "Usuários", href: "/configuracoes/usuarios-em-breve", icon: Users, disabled: true }
    ]
  },
  // 12 — era submenu de "Pedidos".
  {
    id: "fila-impressao",
    label: "Fila de impressão",
    icon: Printer,
    href: "/pedidos/impressao",
    items: []
  }
];

/**
 * Todos os hrefs navegáveis do menu. Usado para resolver a rota ativa pelo href
 * mais específico (ex.: /contas-a-receber/registro não acende "Carteira").
 */
export const navigationHrefs: string[] = navigationSections.flatMap((section) => [
  ...(section.href ? [section.href] : []),
  ...section.items.flatMap((item) => [
    item.href,
    ...(item.children?.map((child) => child.href) ?? [])
  ])
]);


