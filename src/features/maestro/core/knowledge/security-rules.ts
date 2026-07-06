/**
 * security-rules.ts
 * Regras de segurança canônicas do Maestro ERP Ideal.
 *
 * Define o que o Maestro pode, deve mascarar, deve negar e deve logar.
 * Segurança funciona como TRILHO DE LIBERAÇÃO, não bloqueio permanente:
 *   → entender o contexto
 *   → ler com permissão adequada
 *   → executar ações com confirmação e log
 * Nunca contém dados dinâmicos — apenas regras fixas.
 */

// ---------------------------------------------------------------------------
// Classificação de dados por nível de sensibilidade
// ---------------------------------------------------------------------------

export const CLASSIFICACAO_DADOS = {
  publico: {
    label: 'Público',
    descricao: 'Dados de contato e localização — podem ser exibidos livremente.',
    exemplos: ['nome do cliente', 'cidade/UF', 'telefone de atendimento', 'e-mail público'],
    restricao: 'Nenhuma',
  },
  operacional: {
    label: 'Operacional',
    descricao: 'Status e prazos do pedido — para usuários logados.',
    exemplos: [
      'status_interno da proposta', 'data_termino', 'status_producao',
      'status_arte', 'codigo_rastreamento',
    ],
    restricao: 'Usuário logado no ERP',
  },
  interno: {
    label: 'Interno',
    descricao: 'Valores financeiros básicos — verificar perfil.',
    exemplos: ['valor_total da proposta', 'forma_pagamento', 'tipo_cobranca'],
    restricao: 'Perfil operacional ou superior',
  },
  confidencial: {
    label: 'Confidencial',
    descricao: 'Dados de cobrança e inadimplência — perfil financeiro.',
    exemplos: [
      'status de cobranças', 'vencimento', 'dias_atraso', 'valor_atualizado',
      'multa', 'juros_dia', 'confirmado_por',
    ],
    restricao: 'Perfil financeiro, gerente ou admin',
  },
  restrito: {
    label: 'Restrito',
    descricao: 'Dados de pagamento real — nunca exibir sem fluxo seguro.',
    exemplos: [
      'pix_copia_cola', 'linha_digitavel', 'codigo_barras',
      'url_cobranca', 'token_publico', 'public_token',
      'id_fatura', 'payload_envio', 'payload_retorno',
    ],
    restricao: 'Nunca exibir diretamente — encaminhar via link seguro ou módulo específico',
  },
} as const;

// ---------------------------------------------------------------------------
// Campos que o Maestro NUNCA deve expor diretamente
// ---------------------------------------------------------------------------

export const CAMPOS_PROIBIDOS = [
  'token_publico',
  'public_token',
  'pix_copia_cola',
  'linha_digitavel',
  'codigo_barras',
  'url_cobranca',
  'id_fatura',
  'cod_solicitacao_inter',
  'id_boleto_c6',
  'nosso_numero',
  'ext_reference',
  'payload_envio',
  'payload_retorno',
  'payload_webhook',
  'chave_nfe',         // Chave de acesso SEFAZ — dado fiscal sensível
  'caminho_xml',
  'caminho_danfe',
] as const;

// ---------------------------------------------------------------------------
// Dados que devem ser mascarados
// ---------------------------------------------------------------------------

export const MASCARAMENTO = {
  cpfCnpj: {
    regra: 'Exibir apenas últimos dígitos ou formato parcial.',
    exemplo: 'CPF: ***.***.789-** | CNPJ: ***.456.789/0001-**',
    quando: 'Sempre que exibir CPF/CNPJ em mensagem de texto do Maestro.',
  },
  chavePix: {
    regra: 'Nunca exibir chave PIX pessoal na íntegra.',
    quando: 'Qualquer contexto de exibição de dados de pagamento.',
  },
} as const;

// ---------------------------------------------------------------------------
// Regras de conduta do Maestro
// ---------------------------------------------------------------------------

export const REGRAS_CONDUTA = {
  /**
   * Dados reais vs. dados mock
   */
  transparenciaFonte: [
    'Sempre indicar se o dado é real (consultado via Tool) ou mock.',
    'Nunca apresentar dado mock como se fosse real.',
    'Quando tool não existe, usar fallback assistivo explicando o que precisaria consultar.',
  ],

  /**
   * Política de negação segura
   */
  negacaoSegura: [
    'Em caso de dúvida sobre permissão, negar de forma segura e educada.',
    'Explicar qual perfil ou ação seria necessária para obter o dado.',
    'Nunca negar sem oferecer alternativa ou próximo passo.',
  ],

  /**
   * Política de invenção de dados
   */
  proibicaoInventar: [
    'NUNCA inventar número de pedido, valor de cobrança, data de entrega ou status de NF.',
    'NUNCA confirmar dado financeiro sem tool real conectada.',
    'Se não tem tool, dizer claramente: "Não tenho essa informação disponível agora."',
    'Preferir fallback contextual a suposição.',
  ],

  /**
   * Ações de escrita
   */
  escritaControlada: [
    'Nenhuma escrita sem confirmação dupla do usuário.',
    'Nenhuma escrita sem log de auditoria futuro.',
    'Escrita só após verificação de perfil e escopo.',
    'Em caso de erro de escrita, rollback imediato e notificação.',
  ],
} as const;

// ---------------------------------------------------------------------------
// Consultas que precisam de log futuro
// ---------------------------------------------------------------------------

export const CONSULTAS_QUE_EXIGEM_LOG = [
  'Qualquer acesso a dados financeiros de cliente (valor, cobrança, boleto).',
  'Consultas que retornem valores monetários acima de R$ 10.000.',
  'Consultas de dados fiscais (NF-e, NFS-e).',
  'Ações de escrita — quando implementadas.',
] as const;

// ---------------------------------------------------------------------------
// Ações que exigem confirmação dupla
// ---------------------------------------------------------------------------

export const ACOES_CONFIRMACAO_DUPLA = [
  'Liberação de proposta para produção.',
  'Emissão de NF-e ou NFS-e.',
  'Cancelamento de cobrança.',
  'Confirmação manual de pagamento.',
  'Qualquer INSERT, UPDATE ou DELETE no banco.',
] as const;

// ---------------------------------------------------------------------------
// Trilho de liberação (segurança progressiva)
// ---------------------------------------------------------------------------

/**
 * O Maestro deve seguir este trilho, não bloquear permanentemente:
 */
export const TRILHO_LIBERACAO = [
  {
    nivel: 1,
    label: 'Entender',
    descricao: 'Identificar contexto, intenção e domínio sem acessar dado sensível.',
    status: 'ativo',
  },
  {
    nivel: 2,
    label: 'Ler com permissão',
    descricao: 'Consultar dado real após verificar perfil do usuário. Tool read-only.',
    status: 'planejado',
  },
  {
    nivel: 3,
    label: 'Executar com confirmação',
    descricao: 'Ação de escrita após confirmação dupla, log e perfil verificado.',
    status: 'futuro',
  },
] as const;
