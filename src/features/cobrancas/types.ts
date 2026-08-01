import type { Proposta } from "@/features/orcamentos/types";

export type CobrancaStatus = "A_RECEBER" | "A_VENCER" | "PAID" | "CANCELADO";

export type CobrancaTipo = "PIX" | "BOLETO" | "CREDIT_CARD" | "CARD_PARCELADO" | "E-FATURADO" | "E-RETRABALHO" | "E-PERMUTA" | "E-AMOSTRA" | "E-CREDITO";

// ---------------------------------------------------------------------------
// movimento_credito — estrutura real (12 colunas, confirmada em 2026-07-16)
// ---------------------------------------------------------------------------

export type MovimentoCreditoTipo =
  | "CREDITO"      // crédito: saldo aumenta
  | "DEBITO";      // débito: saldo diminui

/** Evento estruturado da Conta Corrente (Fase 1) — ver conta_corrente_pendencias. */
export type MovimentoCreditoTipoEvento =
  | "ABERTURA" | "USO_PEDIDO" | "DEVOLUCAO" | "BONIFICACAO" | "BAIXA" | "CANCELAMENTO" | "ESTORNO";

export type MovimentoCredito = {
  id: number;
  id_cliente: number;
  id_int: number | null;     // ✅ existe — FK para propostas.id_int
  valor: number;             // sempre positivo; tipo determina sinal semântico
  tipo: MovimentoCreditoTipo;
  origem: string;            // ex: "PROPOSTA_ALTERADA", "MANUAL", "CONSUMO_CREDITO"
  observacao: string | null; // texto livre com contexto da operação
  created_at: string;        // timestamptz
  created_by: string | null; // user email ou id — preencher sempre a partir de agora
  cancelado: boolean;
  cancelado_em: string | null;
  cancelado_por: string | null;
  // Colunas estruturadas da Fase 1 (Conta Corrente — Pendências Financeiras).
  // Nullable: registros legados anteriores à Fase 1 não as possuem.
  id_pendencia?: number | null;
  tipo_evento?: MovimentoCreditoTipoEvento | null;
  id_int_origem?: number | null;
  id_int_destino?: number | null;
  id_pagamento_destino?: string | null;
  id_movimento_ref?: number | null;
  motivo_evento?: string | null;
};

// ---------------------------------------------------------------------------
// Tipos para o Modal de Diferença Financeira
// ---------------------------------------------------------------------------

export type AcaoCreditoTipo =
  | "MANTER_CREDITO"         // registra CREDITO em movimento_credito
  | "DEVOLVER"               // solicita DEVOLUCAO (dois estágios — Financeiro confirma)
  | "ABATER_DEBITO";         // registra CONSUMO contra um débito existente selecionado

export type AcaoDebitoTipo =
  | "DEBITO_PENDENTE_COBRANCA" // registra DEBITO + pendência; usuário gera cobrança depois
  | "BONIFICAR"               // registra BONIFICACAO em movimento_credito
  | "DEBITO_FUTURO";          // registra DEBITO em movimento_credito para cobrança futura

/**
 * Payload de confirmação da ação financeira.
 * - Para ABATER_DEBITO: obrigatório informar idDebitoAlvo e valorAbatimento
 * - Para demais: obs é opcional
 */
export type AcaoFinanceiraDiferenca =
  | { tipo: Exclude<AcaoCreditoTipo, "ABATER_DEBITO">; obs?: string }
  | { tipo: "ABATER_DEBITO"; obs?: string; idDebitoAlvo: number; valorAbatimento: number }
  | { tipo: AcaoDebitoTipo; obs?: string };

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
  /** Fluxo de cartão escolhido no modal. Não é persistido em coluna própria:
   *  serve só para rotear a integração. "ASAS" é a segunda opção de cartão. */
  cartaoFluxo?: "PADRAO" | "ASAS";
  /** Dados do pagador efetivo resolvido via propostas.id_faturado.
   *  Quando ausentes, createCobranca usa fallback em proposta.cliente (propostas antigas). */
  pagadorIdCliente?: number | null;
  pagadorNome?: string;
  pagadorDocumento?: string;
};
