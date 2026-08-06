/**
 * erp-relationships.ts
 * Mapa canônico de relacionamentos entre entidades do Vibe.
 *
 * Define como as tabelas se conectam via id_cliente e id_int.
 * Usado pelo Planner e pelo Context Engine para entender contexto cross-domínio.
 * Nunca contém dados dinâmicos — apenas estrutura e regras de relação.
 */

// ---------------------------------------------------------------------------
// Entidades principais
// ---------------------------------------------------------------------------

export const ERP_ENTITIES = {
  clientes: {
    label: 'Clientes / Cadastros',
    tabela: 'public.cadastros_clientes',
    viewReadOnly: 'public.vw_cadastros_clientes_lista',
    chavePrimaria: 'id (UUID)',
    chaveOperacional: 'id_cliente (inteiro interno)',
    chaveExibicao: 'id_cliente_text (string exibida ao usuário, ex: "8469")',
    camposImportantes: [
      'nome', 'fantasia', 'apelido', 'documento', 'tipo_pessoa',
      'cidade_uf', 'nome_vendedor', 'whatsapp_1', 'whatsapp_2',
      'telefone_fixo', 'credito', 'limite_credito', 'risco_credito',
      'data_fundacao', 'qtd_pedidos', 'data_ult_pedido',
    ],
    viewRanking: 'public.vw_cadastros_abc_clientes',
    dominio: 'Comercial',
    toolReadOnly: 'clientes.consultar',
    status: 'ativo' as const,
  },

  propostas: {
    label: 'Propostas / Orçamentos / Pedidos',
    tabela: 'public.propostas',
    chavePrimaria: 'id (UUID)',
    chaveOperacional: 'id_int (inteiro sequencial, ex: 18560)',
    filtroCliente: 'id_cliente (inteiro FK para cadastros_clientes)',
    camposImportantes: [
      'status_interno', 'is_prd_aprovado', 'valor_total', 'valor',
      'vendedor', 'empresa', 'cnpjCpf', 'created_at', 'updated_at',
      'em_arte', 'libera_nf', 'is_avulso', 'id_vendedor',
    ],
    observacao:
      'A mesma tabela representa orçamentos (status_interno=NOVO/AGUARDANDO) ' +
      'e pedidos reais (is_prd_aprovado=true). Nunca assumir que proposta === OS.',
    dominio: 'Comercial',
    toolReadOnly: 'propostas.consultar',
    status: 'planejado' as const,
  },

  propostas_os: {
    label: 'OS — Ordem de Serviço',
    tabela: 'public.propostas_os',
    chavePrimaria: 'id (UUID)',
    chaveOperacional: 'id_int (mesmo id_int da proposta)',
    filtroCliente: 'id_cliente',
    camposImportantes: [
      'status_pedido', 'status_pagamento', 'status_arte',
      'status_producao', 'status_expedicao',
      'valor_total', 'forma_pagamento',
      'data_pedido', 'data_termino', 'codigo_rastreamento',
      'nota_fiscal_url', 'obs',
    ],
    observacao:
      'A OS só existe após liberarPropostaParaProducao(). ' +
      'Não assume existência sem confirmar via propostas_os.',
    dominio: 'Produção',
    toolReadOnly: 'os.consultar',
    status: 'planejado' as const,
  },

  pedidos_modelos: {
    label: 'Modelos / Lotes de Pedido',
    tabela: 'public.pedidos_modelos',
    chaveOperacional: 'id_int (mesmo da proposta/OS)',
    camposImportantes: [
      'nome_modelo', 'quantidade', 'status_arte', 'status_producao',
      'tipo_numeracao', 'numeracao_inicio', 'numeracao_fim',
      'rfid_nfc', 'url_arte', 'url_gabarito', 'designer_responsavel',
    ],
    dominio: 'Produção',
    toolReadOnly: 'producao.consultar',
    status: 'planejado' as const,
  },

  pedidos_artes: {
    label: 'Artes de Pedido',
    tabela: 'public.pedidos_artes',
    chaveOperacional: 'id_int',
    camposImportantes: ['nome_evento', 'storage_bucket', 'created_at'],
    dominio: 'Produção',
    status: 'planejado' as const,
  },

  produtos_proposta: {
    label: 'Produtos da Proposta',
    tabela: 'public.produtos_proposta',
    chaveOperacional: 'id_int (proposta)',
    camposImportantes: ['nome_produto', 'qtd', 'peso_base', 'valor_unt', 'ncm', 'cfop'],
    tabelaVariacoes: 'public.produtos_proposta_variacao',
    chaveVariacao: 'id_produto_proposta',
    dominio: 'Comercial',
    status: 'planejado' as const,
  },

  pagamentos_v2: {
    label: 'Cobranças / Pagamentos',
    tabela: 'public.pagamentos_v2',
    chavePrimaria: 'id (UUID)',
    chaveOperacional: 'id_int (proposta), id_pagamento',
    filtroCliente: 'id_cliente',
    camposImportantes: [
      'valor', 'status', 'tipo_cobranca', 'paid_at', 'vencimento',
      'confirmado', 'confirmado_por', 'aprovado_por', 'data_confirmacao',
      'motivo_cancela', 'empresa', 'id_empresa',
    ],
    camposSensiveis: [
      'url_cobranca', 'pix_copia_cola', 'linha_digitavel',
      'url_pdf', 'token_publico', 'public_token', 'id_fatura',
    ],
    observacao:
      'pagamentos_v2 = toda cobrança do ERP (Pix, Link, Boleto, cartão). ' +
      'Dados sensíveis nunca exibidos sem fluxo seguro.',
    dominio: 'Financeiro',
    toolReadOnly: 'cobrancas.consultar',
    status: 'planejado' as const,
  },

  boletos: {
    label: 'Boletos / Contas a Receber',
    tabela: 'public.boletos',
    chaveOperacional: 'id_int (proposta), id_cliente',
    camposImportantes: [
      'valor', 'valor_atualizado', 'vencimento', 'status', 'paid_at',
      'dias_atraso', 'data_vencido', 'multa', 'juros_dia',
      'nome_cliente', 'documento', 'empresa', 'n_nf',
      'parcela', 'total_parcelas', 'is_faturado',
    ],
    camposSensiveis: ['linha_digitavel', 'codigo_barras', 'url_pdf', 'id_boleto_c6'],
    observacao:
      'boletos = boleto bancário físico via C6 Bank. ' +
      'Diferente de pagamentos_v2, que é cobrança geral do ERP.',
    dominio: 'Financeiro',
    toolReadOnly: 'boletos.consultar',
    status: 'planejado' as const,
  },

  cotacao_frete: {
    label: 'Frete / Cotação',
    tabela: 'public.cotacao_frete',
    chaveOperacional: 'id_int (proposta)',
    camposImportantes: ['escolhido', 'transportadora', 'servico', 'valor', 'prazo'],
    dominio: 'Comercial',
    status: 'planejado' as const,
  },

  notas_fiscais: {
    label: 'NF-e — Nota Fiscal de Produto',
    tabela: 'public.notas_fiscais',
    tabelaItens: 'public.notas_fiscais_itens',
    tabelaPagamentos: 'public.notas_fiscais_pagamentos',
    chaveOperacional: 'ref (ex: "NFE-18560-001")',
    camposLeitura: ['status', 'numero_nf', 'data_autorizacao', 'chave_nfe'],
    observacao: 'Ambiente atual: homologacao (não produção SEFAZ). Emissão irreversível.',
    dominio: 'Fiscal',
    toolReadOnly: 'fiscal.consultar',
    status: 'planejado' as const,
  },

  notas_servico: {
    label: 'NFS-e — Nota Fiscal de Serviço',
    tabela: 'public.notas_servico',
    dominio: 'Fiscal',
    status: 'planejado' as const,
  },

  propostas_chat: {
    label: 'Chat / Timeline da Proposta',
    tabela: 'public.propostas_chat',
    chaveOperacional: 'id_int',
    filtroCliente: 'id_cliente',
    dominio: 'Comercial',
    status: 'planejado' as const,
  },

  propostas_pendencias: {
    label: 'Pendências',
    tabela: 'public.propostas_pendencias',
    chaveOperacional: 'id_int (proposta)',
    filtroCliente: 'id_cliente',
    camposImportantes: [
      'titulo', 'descricao', 'categoria', 'status', 'prioridade',
      'responsavel_setor', 'data_limite',
    ],
    statusPossiveis: ['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'],
    dominio: 'Comercial',
    status: 'planejado' as const,
  },
} as const;

// ---------------------------------------------------------------------------
// Mapa de navegação por id_int (chave transversal do ERP)
// ---------------------------------------------------------------------------

/**
 * A partir de um id_int, pode-se navegar para:
 */
export const ID_INT_RELACIONAMENTOS = [
  { tabela: 'public.propostas', campo: 'id_int', observacao: 'Proposta principal' },
  { tabela: 'public.produtos_proposta', campo: 'id_int', observacao: 'Produtos da proposta' },
  { tabela: 'public.pagamentos_v2', campo: 'id_int', observacao: 'Cobranças do pedido' },
  { tabela: 'public.propostas_os', campo: 'id_int', observacao: 'OS vinculada (se existir)' },
  { tabela: 'public.pedidos_modelos', campo: 'id_int', observacao: 'Lotes/modelos de produção' },
  { tabela: 'public.pedidos_artes', campo: 'id_int', observacao: 'Artes cadastradas' },
  { tabela: 'public.propostas_chat', campo: 'id_int', observacao: 'Timeline/chat da proposta' },
  { tabela: 'public.propostas_pendencias', campo: 'id_int', observacao: 'Pendências operacionais' },
  { tabela: 'public.cotacao_frete', campo: 'id_int', observacao: 'Cotações de frete' },
] as const;

/**
 * A partir de um id_cliente, pode-se navegar para:
 */
export const ID_CLIENTE_RELACIONAMENTOS = [
  { tabela: 'public.propostas', campo: 'id_cliente', observacao: 'Todas as propostas do cliente' },
  { tabela: 'public.pagamentos_v2', campo: 'id_cliente', observacao: 'Cobranças do cliente' },
  { tabela: 'public.boletos', campo: 'id_cliente', observacao: 'Boletos bancários do cliente' },
  { tabela: 'public.propostas_pendencias', campo: 'id_cliente', observacao: 'Pendências do cliente' },
  { tabela: 'public.propostas_chat', campo: 'id_cliente', observacao: 'Mensagens relacionadas ao cliente' },
] as const;

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

export type EntidadeERP = keyof typeof ERP_ENTITIES;
export type StatusCapacidade = 'ativo' | 'planejado' | 'futuro';
