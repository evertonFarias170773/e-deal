/**
 * business-rules.ts
 * Regras de negócio canônicas do ERP Ideal para o Maestro.
 *
 * Cobre: orçamento → proposta → aprovação → pedido real → OS → modelos → produção.
 * Nunca contém dados dinâmicos — apenas regras estruturais fixas.
 */

// ---------------------------------------------------------------------------
// Ciclo de vida de Proposta/Pedido
// ---------------------------------------------------------------------------

/**
 * Todos os 20 status possíveis de uma proposta, em ordem de ciclo.
 */
export const PROPOSTA_STATUS_TODOS = [
  'NOVO',
  'NOVO / EM ARTE',
  'AGUARDANDO',
  'AGUARDANDO / EM ARTE',
  'AGUARDANDO / PENDENTE',
  'APROVADO',
  'APROVADO / EM ARTE',
  'REVISAO ATENDENTE',
  'REVISAO PRODUCAO',
  'EM PRODUCAO',
  'EM IMPRESSAO',
  'EM IMPRESSAO / PENDENTE',
  'EM ACABAMENTO',
  'EM ACABAMENTO / PENDENTE',
  'EXPEDICAO',
  'A RETIRAR',
  'EM TRANSITO',
  'ENTREGUE',
  'CANCELADO',
  'STATUS_DESCONHECIDO',
] as const;

export type PropostaStatus = (typeof PROPOSTA_STATUS_TODOS)[number];

/**
 * Grupos funcionais de status por fase.
 */
export const PROPOSTA_STATUS_GRUPOS = {
  /** Fase comercial — orçamento em elaboração */
  orcamento: ['NOVO', 'NOVO / EM ARTE', 'AGUARDANDO', 'AGUARDANDO / EM ARTE', 'AGUARDANDO / PENDENTE'] as string[],

  /** Aprovado comercialmente — não é pedido real ainda */
  aprovadoComercial: ['APROVADO', 'APROVADO / EM ARTE'] as string[],

  /** Pedido real — is_prd_aprovado=true, liberado para produção */
  pedidoReal: [
    'REVISAO ATENDENTE', 'REVISAO PRODUCAO',
    'EM PRODUCAO', 'EM IMPRESSAO', 'EM IMPRESSAO / PENDENTE',
    'EM ACABAMENTO', 'EM ACABAMENTO / PENDENTE',
  ] as string[],

  /** Expedição e entrega */
  expedicao: ['EXPEDICAO', 'A RETIRAR', 'EM TRANSITO', 'ENTREGUE'] as string[],

  /** Encerrado */
  encerrado: ['CANCELADO', 'ENTREGUE'] as string[],

  /** Elegível para criar boletim/OS */
  elegivelBoletim: [
    'APROVADO', 'APROVADO / EM ARTE',
    'REVISAO ATENDENTE', 'REVISAO PRODUCAO', 'EM PRODUCAO',
  ] as string[],

  /** Elegível para NF-e */
  elegivelNfe: ['APROVADO'] as string[],

  /** Lista de produção */
  listaProducao: [
    'NOVO / EM ARTE', 'AGUARDANDO / EM ARTE', 'APROVADO / EM ARTE',
    'REVISAO PRODUCAO', 'EM PRODUCAO', 'EM IMPRESSAO', 'EM IMPRESSAO / PENDENTE',
    'EM ACABAMENTO', 'EM ACABAMENTO / PENDENTE',
  ] as string[],
} as const;

// ---------------------------------------------------------------------------
// Regras: quando uma proposta vira pedido real
// ---------------------------------------------------------------------------

export const REGRAS_PEDIDO_REAL = {
  /**
   * O FLAG principal que define pedido real:
   * propostas.is_prd_aprovado = true
   *
   * Isso é setado quando liberarPropostaParaProducao() é chamado.
   */
  flagPrincipal: 'is_prd_aprovado = true',

  /**
   * Também pode ser detectado por status_interno:
   */
  statusQueIndicamPedidoReal: [
    'LIBERADO', 'REVISAO ATENDENTE', 'REVISAO PRODUCAO',
    'EM PRODUCAO', 'EM IMPRESSAO', 'EM IMPRESSAO / PENDENTE',
    'EM ACABAMENTO', 'EM ACABAMENTO / PENDENTE',
    'EXPEDICAO', 'A RETIRAR', 'EM TRANSITO', 'ENTREGUE',
  ] as string[],

  /**
   * Regra: proposta aprovada comercialmente (APROVADO) NÃO é automaticamente pedido real.
   * Pedido real exige liberarPropostaParaProducao() → is_prd_aprovado=true.
   */
  avisoAprovadoNaoEPedido:
    'Uma proposta com status_interno=APROVADO ainda NÃO é um pedido real confirmado. ' +
    'Pedido real requer is_prd_aprovado=true ou status operacional (REVISAO ATENDENTE ou posterior).',
} as const;

// ---------------------------------------------------------------------------
// Regras: OS (Ordem de Serviço)
// ---------------------------------------------------------------------------

export const REGRAS_OS = {
  /**
   * A OS só existe em public.propostas_os após a criação do boletim.
   * Verificar existência antes de afirmar.
   */
  quando: 'A OS é criada via criarPedidoParaBoletim() → INSERT em propostas_os.',

  /**
   * Nunca chamar a proposta de OS sem ter confirmado propostas_os.
   */
  atencao:
    'NUNCA dizer que "a OS está em andamento" consultando apenas public.propostas. ' +
    'public.propostas = proposta/pedido. public.propostas_os = OS operacional.',

  camposStatus: {
    status_pedido: 'Status do pedido na OS',
    status_arte: 'Status de arte (PENDENTE → LIBERADA → ...)',
    status_producao: 'Status de produção (BLOQUEADO → EM_IMPRESSAO → CONCLUIDA)',
    status_expedicao: 'Status de expedição',
  },

  statusArteAprovada: [
    'APROVADA', 'APROVADO', 'APROVADA_CLIENTE',
    'LIBERADA', 'IMPRESSA', 'NAO_NECESSARIA',
  ] as string[],
} as const;

// ---------------------------------------------------------------------------
// Regras: Modelos / Lotes de Produção
// ---------------------------------------------------------------------------

export const REGRAS_MODELOS = {
  tabela: 'public.pedidos_modelos',
  chaveRelacao: 'id_int (mesmo da proposta/OS)',
  statusInicialBoletim: {
    status_arte: 'PENDENTE',
    status_producao: 'BLOQUEADO',
  },
  observacao:
    'Cada modelo representa um lote de itens (ex: lote de 500 pulseiras numeradas). ' +
    'Um pedido pode ter múltiplos modelos/lotes.',
} as const;

// ---------------------------------------------------------------------------
// Regras: Perguntas que exigem verificação de existência
// ---------------------------------------------------------------------------

/**
 * Para responder a essas perguntas, o Maestro precisa da tool correspondente.
 * Sem tool conectada, usar fallback assistivo.
 */
export const PERGUNTAS_QUE_EXIGEM_TOOL = [
  {
    pergunta: 'Qual foi o último pedido desse cliente?',
    toolNecessaria: 'propostas.consultar',
    filtro: 'id_cliente + is_prd_aprovado=true ORDER BY created_at DESC',
    status: 'planejado',
  },
  {
    pergunta: 'Essa proposta já virou pedido?',
    toolNecessaria: 'propostas.consultar',
    filtro: 'id_int + is_prd_aprovado + status_interno',
    status: 'planejado',
  },
  {
    pergunta: 'A OS já foi criada?',
    toolNecessaria: 'os.consultar',
    filtro: 'id_int em propostas_os',
    status: 'planejado',
  },
  {
    pergunta: 'Qual o status da produção?',
    toolNecessaria: 'producao.consultar',
    filtro: 'id_int em propostas_os + pedidos_modelos',
    status: 'planejado',
  },
] as const;
