/**
 * Tipos do Dashboard do Vendedor — espelham o payload jsonb da RPC
 * public.rpc_dashboard_vendedor (supabase/migrations/20260808_rpc_dashboard_vendedor.sql).
 * O vendedor é resolvido no banco via auth.uid(); nada aqui carrega identidade.
 */

export type ParQtdValor = { qtd: number; valor: number };

export type ParComparativo = { atual: ParQtdValor; anterior: ParQtdValor };

export type DashboardVendedorPayload = {
  periodo: { inicio: string; fim: string; inicio_prev: string; fim_prev: string };
  vendedor: { nome: string };
  faturamento: {
    proprio: {
      atual: { valor: number; pedidos: number };
      anterior: { valor: number; pedidos: number };
    };
    /** Consolidado da empresa — único dado global (escalar). */
    total: { atual: number; anterior: number };
    participacao_pct: { atual: number | null; anterior: number | null };
  };
  serie: Array<{ ref: string; total: number }>;
  serie_bucket: "dia" | "mes";
  propostas: {
    criadas: ParComparativo;
    ganhas: ParComparativo;
    perdidas: ParComparativo;
    por_status: Array<{ status: string; qtd: number; valor: number }>;
  };
  fotos: {
    aguardando: ParQtdValor;
    producao: ParQtdValor & { por_etapa: Array<{ etapa: string; qtd: number }> };
  };
  widgets: {
    ultimos_pagamentos: Array<{
      id_int: number;
      cliente: string;
      valor: number;
      data_confirmacao: string;
    }>;
    ultimas_propostas: Array<{
      id_int: number;
      cliente: string;
      status: string;
      valor: number;
      created_at: string;
    }>;
  };
};
