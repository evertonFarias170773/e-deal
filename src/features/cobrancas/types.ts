import type { Proposta } from "@/features/orcamentos/types";

export type CobrancaStatus = "A_RECEBER" | "A_VENCER" | "PAID" | "CANCELADO";

export type CobrancaTipo = "PIX" | "BOLETO" | "CREDIT_CARD" | "CARD_PARCELADO" | "E-FATURADO" | "E-RETRABALHO" | "E-PERMUTA" | "E-AMOSTRA";

export type EmpresaRecebedoraOption = {
  id: number;
  nome: string;
  labelCurta: string;
  documento: string;
  fluxoFuturo: string;
  descricao: string;
};

export type CobrancaHistoricoEvento = {
  id: string;
  data: string;
  titulo: string;
  descricao: string;
  tipo: "info" | "success" | "warning" | "danger";
};

export type PropostaChatFinanceiro = {
  id: string;
  data: string;
  autor: string;
  mensagem: string;
  categoria: "SISTEMA" | "FINANCEIRO" | "COMERCIAL";
};

export type CobrancaParcelaSimulada = {
  parcelas: number;
  taxaPercentual: number;
  valorTaxa: number;
  valorFinal: number;
  valorParcela: number;
  rotulo: string;
};

export type CreditoAnaliseMock = {
  limite: number;
  utilizado: number;
  disponivel: number;
  valorSolicitado: number;
  risco: "BAIXO" | "MEDIO" | "ALTO";
  statusAnalise: "APROVADO" | "AGUARDANDO_FINANCEIRO";
  mensagem: string;
  limiteReservado?: boolean;
};

export type LiberacaoPedidoStatus =
  | "LIBERADA_PARA_PEDIDO"
  | "PRONTA_PARA_LIBERACAO"
  | "AGUARDANDO_PAGAMENTO"
  | "AGUARDANDO_CREDITO"
  | "PARCIALMENTE_APROVADA";

export type PropostaCobrancaSnapshot = {
  id_int: number;
  statusProposta: Proposta["status"];
  cliente: string;
  documento: string;
  valorTotal: number;
  valorPendente: number;
  empresaProposta: string;
  vendedor: string;
  descricao: string;
  valorFrete: number;
};

export type Cobranca = {
  id: string;
  id_pagamento: string;
  cod_solicitacao_inter?: string;
  os_ideal: string;
  id_int: number;
  id_cliente: number;
  valor: number;
  status: CobrancaStatus;
  tipo_cobranca: CobrancaTipo;
  created_at: string;
  paid_at?: string;
  vencimento?: string;
  cliente: string;
  empresa: string;
  descricao: string;
  documento: string;
  atendente: string;
  confirmado: boolean;
  confirmado_por?: string;
  data_confirmacao?: string;
  id_empresa: number;
  token_publico?: string;
  url_cobranca?: string;
  pix_copia_cola?: string;
  linha_digitavel?: string;
  url_pdf?: string;
  erro_pagamento?: string;
  cartao_parcelas?: number;
  cartao_taxa_percentual?: number;
  cartao_valor_taxa?: number;
  cartao_valor_final?: number;
  cartao_checkout_id?: string;
  cartao_checkout_url?: string;
  cartao_status?: string;
  is_parcial?: boolean;
  saldo_pendente?: number;
  valor_frete?: number;
  forma_fatu?: string;
  forma_pgto?: string;
  obs_v2?: string;
  id_modelo_cobranca?: string | null;
  motivo_cancela?: string;
  multaPercentual?: number;
  jurosPercentual?: number;
  capturaAutomatica?: boolean;
  condicao_pagamento?: string;
  creditoPendente?: boolean;
  pedidoLiberadoMock?: boolean;
  boleto_enviadoo?: boolean;
  proposta: PropostaCobrancaSnapshot;
  historico: CobrancaHistoricoEvento[];
  propostasChat: PropostaChatFinanceiro[];
  creditoAnalise?: CreditoAnaliseMock;
  cliente_restricao?: boolean;
  cliente_limite_credito?: number;
  cliente_credito?: number;
};

export type CreditAnalysisResult = {
  id_cliente: number;
  limite_credito: number;
  utilizado: number;
  saldo_carteira: number;
  limite_disponivel: number;
  status_credito: string;
  risco_credito: string;
  padrao_pagamento: string;
  media_atraso_dias: number;
  maior_atraso_dias: number;
  qtd_pagamentos_atrasados: number;
  qtd_pedidos_aprovados: number;
  ticket_medio_aprovado: number;
  mensagem: string;
};

export type ModeloCobranca = {
  id: string;
  entrada_porcento: number;
  qtd_parcela: number;
  inicio: number;
  intervalo: number;
  modelo: string;
  resultado: string;
};

export type CriarCobrancaFormValues = {
  propostaIdInt: number | null;
  osIdeal: string;
  tipoCobranca: CobrancaTipo;
  valor: number;
  vencimento: string;
  observacao: string;
  descricao: string;
  condicaoPagamento: string;
  expiracaoPix: string;
  multaPercentual: number;
  jurosPercentual: number;
  capturaAutomatica: boolean;
  parcelaSelecionada?: CobrancaParcelaSimulada;
  modeloFatu?: "BOLETO" | "DEPÓSITO";
  forma_fatu?: string | null;
  id_modelo_cobranca?: string | null;
  p_valor_entrada?: number | null;
  p_qtd_parcelas?: number | null;
  p_dias_pra_inicio?: number | null;
  p_intervalo?: number | null;
  id_empresa?: number;
  empresa?: string;
  /** Dados do pagador efetivo resolvido via propostas.id_faturado.
   *  Quando ausentes, createCobranca usa fallback em proposta.cliente (propostas antigas). */
  pagadorIdCliente?: number | null;
  pagadorNome?: string;
  pagadorDocumento?: string;
};
