import type { DashboardMetric } from "@/lib/types";

type DashboardMockData = {
  metrics: DashboardMetric[];
  salesByMonth: Array<{ month: string; vendas: number }>;
  receivablesByStatus: Array<{ status: string; valor: number }>;
  proposalsByStatus: Array<{ status: string; total: number }>;
  salesByCompany: Array<{ empresa: string; vendas: number }>;
};

export const dashboardByCompanyMock: Record<number, DashboardMockData> = {
  0: {
    metrics: [
      {
        title: "Vendas do mes",
        value: "R$ 148.920,00",
        description: "Propostas aprovadas e pedidos confirmados",
        tone: "success",
        trend: "+12% vs. mes anterior"
      },
      {
        title: "Contas a receber",
        value: "R$ 62.480,30",
        description: "Titulos em aberto no periodo",
        tone: "info",
        trend: "42 lancamentos"
      },
      {
        title: "Propostas aguardando",
        value: "18",
        description: "Aguardando retorno ou aprovacao",
        tone: "warning",
        trend: "5 vencem hoje"
      },
      {
        title: "Notas com erro",
        value: "3",
        description: "Pendencias fiscais para revisar",
        tone: "danger",
        trend: "2 NF-e e 1 NFS-e"
      },
      {
        title: "OS em producao",
        value: "27",
        description: "Ordens ativas na operacao",
        tone: "special",
        trend: "8 com prazo ate amanha"
      }
    ],
    salesByMonth: [
      { month: "Jan", vendas: 92000 },
      { month: "Fev", vendas: 104000 },
      { month: "Mar", vendas: 118500 },
      { month: "Abr", vendas: 132700 },
      { month: "Mai", vendas: 148920 }
    ],
    receivablesByStatus: [
      { status: "A vencer", valor: 34480 },
      { status: "Vencidos", valor: 11200 },
      { status: "Pagos", valor: 86900 },
      { status: "Faturados", valor: 16800 }
    ],
    proposalsByStatus: [
      { status: "Novo", total: 9 },
      { status: "Aguardando", total: 18 },
      { status: "Aprovado", total: 31 },
      { status: "Cancelado", total: 4 }
    ],
    salesByCompany: [
      { empresa: "Ideal", vendas: 70420 },
      { empresa: "Biro", vendas: 48600 },
      { empresa: "E3", vendas: 29900 }
    ]
  },
  1: {
    metrics: [
      { title: "Vendas do mes", value: "R$ 70.420,00", description: "Operacao Ideal Grafica", tone: "success", trend: "+8%" },
      { title: "Contas a receber", value: "R$ 28.100,00", description: "Titulos da empresa Ideal", tone: "info", trend: "19 lancamentos" },
      { title: "Propostas aguardando", value: "7", description: "Carteira comercial Ideal", tone: "warning", trend: "2 vencem hoje" },
      { title: "Notas com erro", value: "1", description: "Pendencia fiscal Ideal", tone: "danger", trend: "1 NF-e" },
      { title: "OS em producao", value: "14", description: "Ordens da Ideal Grafica", tone: "special", trend: "4 urgentes" }
    ],
    salesByMonth: [
      { month: "Jan", vendas: 42000 },
      { month: "Fev", vendas: 48800 },
      { month: "Mar", vendas: 52600 },
      { month: "Abr", vendas: 61100 },
      { month: "Mai", vendas: 70420 }
    ],
    receivablesByStatus: [
      { status: "A vencer", valor: 16100 },
      { status: "Vencidos", valor: 4200 },
      { status: "Pagos", valor: 39800 },
      { status: "Faturados", valor: 7800 }
    ],
    proposalsByStatus: [
      { status: "Novo", total: 4 },
      { status: "Aguardando", total: 7 },
      { status: "Aprovado", total: 15 },
      { status: "Cancelado", total: 1 }
    ],
    salesByCompany: [{ empresa: "Ideal", vendas: 70420 }]
  },
  2: {
    metrics: [
      { title: "Vendas do mes", value: "R$ 48.600,00", description: "Operacao Ideal Biro", tone: "success", trend: "+15%" },
      { title: "Contas a receber", value: "R$ 21.780,30", description: "Titulos do Biro", tone: "info", trend: "14 lancamentos" },
      { title: "Propostas aguardando", value: "6", description: "Carteira Biro", tone: "warning", trend: "1 vence hoje" },
      { title: "Notas com erro", value: "1", description: "Pendencia fiscal Biro", tone: "danger", trend: "1 NFS-e" },
      { title: "OS em producao", value: "8", description: "Ordens do Biro", tone: "special", trend: "2 urgentes" }
    ],
    salesByMonth: [
      { month: "Jan", vendas: 30500 },
      { month: "Fev", vendas: 33200 },
      { month: "Mar", vendas: 40100 },
      { month: "Abr", vendas: 42600 },
      { month: "Mai", vendas: 48600 }
    ],
    receivablesByStatus: [
      { status: "A vencer", valor: 11880 },
      { status: "Vencidos", valor: 3500 },
      { status: "Pagos", valor: 28500 },
      { status: "Faturados", valor: 6400 }
    ],
    proposalsByStatus: [
      { status: "Novo", total: 3 },
      { status: "Aguardando", total: 6 },
      { status: "Aprovado", total: 10 },
      { status: "Cancelado", total: 2 }
    ],
    salesByCompany: [{ empresa: "Biro", vendas: 48600 }]
  },
  3: {
    metrics: [
      { title: "Vendas do mes", value: "R$ 29.900,00", description: "Operacao E3 Brindes", tone: "success", trend: "+6%" },
      { title: "Contas a receber", value: "R$ 12.600,00", description: "Titulos da E3", tone: "info", trend: "9 lancamentos" },
      { title: "Propostas aguardando", value: "5", description: "Carteira E3", tone: "warning", trend: "2 vencem hoje" },
      { title: "Notas com erro", value: "1", description: "Pendencia fiscal E3", tone: "danger", trend: "1 NF-e" },
      { title: "OS em producao", value: "5", description: "Ordens da E3", tone: "special", trend: "2 com prazo curto" }
    ],
    salesByMonth: [
      { month: "Jan", vendas: 19500 },
      { month: "Fev", vendas: 22000 },
      { month: "Mar", vendas: 25800 },
      { month: "Abr", vendas: 29000 },
      { month: "Mai", vendas: 29900 }
    ],
    receivablesByStatus: [
      { status: "A vencer", valor: 6500 },
      { status: "Vencidos", valor: 3500 },
      { status: "Pagos", valor: 18600 },
      { status: "Faturados", valor: 2600 }
    ],
    proposalsByStatus: [
      { status: "Novo", total: 2 },
      { status: "Aguardando", total: 5 },
      { status: "Aprovado", total: 6 },
      { status: "Cancelado", total: 1 }
    ],
    salesByCompany: [{ empresa: "E3", vendas: 29900 }]
  }
};

export function getDashboardMockData(companyId: number) {
  return dashboardByCompanyMock[companyId] ?? dashboardByCompanyMock[0];
}

export const dashboardActivity = [
  {
    id: "ACT-001",
    title: "Proposta #9241 aprovada",
    description: "Cliente Casa Norte Eventos - R$ 4.820,00",
    status: "APROVADO"
  },
  {
    id: "ACT-002",
    title: "Boleto vence hoje",
    description: "Ideal Biro - parcela 2/3 - R$ 1.240,00",
    status: "A_VENCER"
  },
  {
    id: "ACT-003",
    title: "NF-e rejeitada",
    description: "Documento fiscal precisa de correcao cadastral",
    status: "REJEITADA"
  }
];
