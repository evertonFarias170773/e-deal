/**
 * finance-rules.ts
 * Regras financeiras canônicas do ERP Ideal para o Maestro.
 *
 * Cobre: pagamentos_v2, boletos, status de cobrança, tipos E-*, aprovação.
 * Nunca contém dados dinâmicos — apenas regras estruturais fixas.
 */

// ---------------------------------------------------------------------------
// Diferença fundamental: pagamentos_v2 vs boletos
// ---------------------------------------------------------------------------

export const FINANCE_TABLES = {
  pagamentos_v2: {
    label: 'Cobranças / Pagamentos ERP',
    tabela: 'public.pagamentos_v2',
    descricao:
      'Toda cobrança gerada pelo ERP: Pix, Link de pagamento, Boleto, Cartão, ' +
      'E-Faturado, E-Retrabalho, etc.',
    chaveRelacao: 'id_int (proposta) + id_cliente',
    toolReadOnly: 'cobrancas.consultar',
    status: 'planejado' as const,
  },
  boletos: {
    label: 'Boletos Bancários / Contas a Receber',
    tabela: 'public.boletos',
    descricao:
      'Apenas boletos bancários emitidos via C6 Bank. ' +
      'Tem campos específicos de inadimplência: dias_atraso, multa, juros_dia.',
    chaveRelacao: 'id_int + id_cliente',
    toolReadOnly: 'boletos.consultar',
    status: 'planejado' as const,
  },
} as const;

// ---------------------------------------------------------------------------
// Status de pagamento (pagamentos_v2)
// ---------------------------------------------------------------------------

/**
 * Status internos do ERP (após normalização pelo mapper)
 */
export const PAYMENT_STATUS = {
  A_RECEBER: {
    label: 'Pendente',
    descricao: 'Cobrança gerada, sem vencimento imediato definido ou aguardando pagamento.',
  },
  A_VENCER: {
    label: 'A Vencer',
    descricao: 'Cobrança gerada com vencimento futuro, aguardando pagamento.',
  },
  PAID: {
    label: 'Pago',
    descricao: 'Pagamento confirmado (paid_at preenchido ou status=PAID).',
  },
  CANCELADO: {
    label: 'Cancelado',
    descricao: 'Cobrança cancelada — excluir de cálculos ativos.',
  },
  EXTORNADO: {
    label: 'Extornado',
    descricao: 'Valor estornado — excluir de cálculos ativos.',
  },
  RECUSADO: {
    label: 'Recusado',
    descricao: 'Pagamento recusado — excluir de cálculos ativos.',
  },
} as const;

export type PaymentStatus = keyof typeof PAYMENT_STATUS;

// ---------------------------------------------------------------------------
// Regras de identificação de status
// ---------------------------------------------------------------------------

export const REGRAS_STATUS_PAGAMENTO = {
  /**
   * Como identificar pagamento PAGO
   */
  pago: [
    'status === "PAID"',
    'OU paid_at IS NOT NULL',
    'OU (status === "A_VENCER" AND confirmado === true)',
  ],

  /**
   * Como identificar pagamento PENDENTE
   */
  pendente: [
    'status IN ("A_RECEBER", "A_VENCER")',
    'AND confirmado !== true',
    'AND paid_at IS NULL',
  ],

  /**
   * Como identificar VENCIDO
   */
  vencido: [
    'status IN ("A_RECEBER", "A_VENCER")',
    'AND vencimento < hoje',
    'AND paid_at IS NULL',
    'Em boletos: checar dias_atraso > 0',
  ],

  /**
   * Como identificar A VENCER (futuro)
   */
  aVencer: [
    'status === "A_VENCER"',
    'AND vencimento >= hoje',
    'AND paid_at IS NULL',
  ],

  /**
   * Quais status excluir de cálculos ativos
   */
  excluirDosCalculos: ['CANCELADO', 'EXTORNADO', 'RECUSADO'],
} as const;

// ---------------------------------------------------------------------------
// Tipos de cobrança
// ---------------------------------------------------------------------------

export const TIPOS_COBRANCA = {
  PIX: { label: 'Pix', natureza: 'pagamento_instantaneo', ehEFaturamento: false },
  BOLETO: { label: 'Boleto', natureza: 'bancario', ehEFaturamento: false },
  CREDIT_CARD: { label: 'Cartão de Crédito', natureza: 'cartao', ehEFaturamento: false },
  CARD_PARCELADO: { label: 'Cartão Parcelado', natureza: 'cartao', ehEFaturamento: false },
  'E-FATURADO': {
    label: 'E-Faturado',
    natureza: 'faturamento',
    ehEFaturamento: true,
    observacao: 'Exige confirmação manual financeira. verificar confirmado=true.',
  },
  'E-RETRABALHO': {
    label: 'E-Retrabalho',
    natureza: 'cortesia',
    ehEFaturamento: true,
    observacao: 'Cortesia por retrabalho. Exige confirmação.',
  },
  'E-PERMUTA': { label: 'E-Permuta', natureza: 'permuta', ehEFaturamento: true },
  'E-AMOSTRA': { label: 'E-Amostra', natureza: 'cortesia', ehEFaturamento: true },
} as const;

export type TipoCobranca = keyof typeof TIPOS_COBRANCA;

// ---------------------------------------------------------------------------
// Regra especial: tipos E-* (faturamento)
// ---------------------------------------------------------------------------

export const REGRA_E_FATURAMENTO = {
  descricao:
    'Cobranças com tipo_cobranca começando com "E-" (E-Faturado, E-Retrabalho, etc.) ' +
    'exigem confirmação manual financeira.',

  isPendenteAprovacao: [
    '1. Só se aplica a tipo_cobranca que começa com "E-".',
    '2. Se confirmado === true → NÃO é pendente de aprovação.',
    '3. Se status === CANCELADO ou PAID → NÃO é pendente.',
    '4. Se status === A_VENCER e confirmado_por preenchido → NÃO é pendente (já autorizado).',
    '5. Caso contrário → PENDENTE — aguarda autorização financeira.',
  ],

  isFaturamentoElegivel: [
    'confirmado === true',
    'AND (status === "PAID" OR status === "A_VENCER")',
    'AND id_empresa > 0',
  ],
} as const;

// ---------------------------------------------------------------------------
// Lógica de liberação de pedido (por cobranças)
// ---------------------------------------------------------------------------

export const LIBERACAO_PEDIDO_STATUS = {
  AGUARDANDO_CREDITO: 'Há cobrança com crédito pendente de análise.',
  LIBERADA_PARA_PEDIDO: 'Todas cobranças aprovadas e pedido liberado manualmente.',
  PRONTA_PARA_LIBERACAO: 'Todas cobranças aprovadas, aguardando liberação manual.',
  AGUARDANDO_PAGAMENTO: 'Nenhuma cobrança aprovada.',
  PARCIALMENTE_APROVADA: 'Algumas cobranças aprovadas, outras pendentes.',
} as const;

// ---------------------------------------------------------------------------
// Dados financeiros sensíveis — contexto de segurança
// ---------------------------------------------------------------------------

export const CAMPOS_FINANCEIROS_SENSIVEIS = [
  'url_cobranca',
  'pix_copia_cola',
  'linha_digitavel',
  'codigo_barras',
  'token_publico',
  'public_token',
  'id_fatura',
  'cod_solicitacao_inter',
  'id_boleto_c6',
  'nosso_numero',
] as const;

export const REGRAS_ACESSO_FINANCEIRO = {
  perfisPermitidos: ['financeiro', 'admin', 'gerente'],
  dadosLivresParaVendedor: ['status', 'valor_total', 'vencimento', 'tipo_cobranca'],
  dadosBloqueadosParaVendedor: CAMPOS_FINANCEIROS_SENSIVEIS,
  instrucao:
    'Antes de exibir dados financeiros sensíveis, verificar se o usuário tem perfil financeiro/admin. ' +
    'Em caso de dúvida, negar e orientar a ir ao módulo Cobranças.',
} as const;
