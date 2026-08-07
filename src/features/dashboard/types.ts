/**
 * Tipos do Dashboard executivo — espelham o payload jsonb devolvido pela RPC
 * public.rpc_dashboard_executivo (supabase/migrations/20260807_rpc_dashboard_executivo.sql).
 */

export type KpiPar = { qtd: number; valor: number };

export type KpiComparativo = { atual: KpiPar; anterior: KpiPar };

export type TempoAprovacaoBloco = {
  qtd: number;
  media_horas: number;
  mediana_horas: number;
} | null;

export type FiscalBloco = {
  emitidas: KpiComparativo;
  /** Foto (situação atual), não recorte do período. */
  pendentes: number;
  rejeitadas: number;
};

export type DashboardExecutivoPayload = {
  periodo: {
    inicio: string;
    fim: string;
    inicio_prev: string;
    fim_prev: string;
    hoje: string;
  };
  comercial: {
    criadas: KpiComparativo;
    ganho: KpiComparativo;
    perdido: KpiComparativo;
    /** LIBERADO já vem unificado como APROVADO (decisão de 08/08). */
    por_status: Array<{ status: string; qtd: number; valor: number }>;
    /** Valores das propostas aprovadas do período por tipo_cobranca dos pagamentos válidos. */
    aprovadas_por_tipo: Array<{ tipo: string; valor: number; qtd: number }>;
    tempo_aprovacao: { atual: TempoAprovacaoBloco; anterior: TempoAprovacaoBloco };
  };
  financeiro: {
    recebido: KpiComparativo;
    serie: Array<{ ref: string; total: number }>;
    serie_bucket: "dia" | "mes";
    por_empresa: Array<{ id_empresa: number; valor: number; qtd: number }>;
    carteira: { vencido: KpiPar; hoje: KpiPar; a_vencer: KpiPar; total: KpiPar };
    fluxo: Array<{ faixa: string; qtd: number; valor: number }>;
    pendencias_cc: { qtd: number; valor: number };
  };
  producao: {
    total: number;
    por_etapa: Array<{ etapa: string; qtd: number }>;
    por_setor: Array<{ setor: string; qtd: number }>;
  };
  fiscal: { nfe: FiscalBloco; nfse: FiscalBloco };
  clientes: {
    novos: { atual: number; anterior: number };
    ativos: { atual: number; anterior: number };
    top: Array<{ id_cliente: number; cliente: string; valor: number; qtd: number }>;
  };
  widgets: {
    ultimas_aprovacoes: Array<{
      id_int: number;
      cliente: string;
      valor: number;
      aprovado_em: string;
    }>;
  };
};

/** Payload da RPC rpc_ranking_vendedores (exclusiva de perfis administrativos). */
export type RankingVendedores = {
  total: number;
  ranking: Array<{
    posicao: number;
    vendedor: string;
    valor: number;
    pedidos: number;
    ticket: number | null;
    participacao_pct: number | null;
  }>;
};

/** Linha do widget "Próximos boletos a vencer" (tabela public.boletos). */
export type ProximoBoleto = {
  id: string;
  id_int: number | null;
  parcela: number | null;
  total_parcelas: number | null;
  nome_cliente: string | null;
  valor: number | null;
  valor_atualizado: number | null;
  vencimento: string;
  status: string;
};

/** Linha do widget "Últimos pagamentos recebidos" (public.pagamentos_v2). */
export type UltimoPagamento = {
  id: string;
  id_int: number | null;
  cliente: string | null;
  valor: number | null;
  tipo_cobranca: string | null;
  data_confirmacao: string;
};
