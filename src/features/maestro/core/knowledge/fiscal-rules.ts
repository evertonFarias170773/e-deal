/**
 * fiscal-rules.ts
 * Regras fiscais canônicas do ERP Ideal para o Maestro.
 *
 * Cobre: NF-e, NFS-e, libera_nf, o que o Maestro pode e não pode.
 * Nunca contém dados dinâmicos — apenas regras estruturais fixas.
 */

// ---------------------------------------------------------------------------
// NF-e vs NFS-e
// ---------------------------------------------------------------------------

export const FISCAL_TIPOS = {
  nfe: {
    label: 'NF-e — Nota Fiscal Eletrônica de Produto',
    tabela: 'public.notas_fiscais',
    tabelaItens: 'public.notas_fiscais_itens',
    tabelaPagamentos: 'public.notas_fiscais_pagamentos',
    modelo: '55',
    descricao:
      'Emitida para venda de produto físico (ex: crachás, pulseiras, adesivos, brindes). ' +
      'Integra com SEFAZ via Focus NFe.',
    cfopInterestadual: '6101 — VENDA DE PRODUCAO PROPRIA DEST. OUTRO ESTADO',
    cfopIntraestadual: '5101 — VENDA DE PRODUCAO PROPRIA',
    ambienteAtual: 'homologacao',
    observacaoAmbiente:
      'NF-e está em ambiente de homologação (teste). Não está em produção SEFAZ ainda.',
    toolReadOnly: 'fiscal.consultar',
    status: 'planejado' as const,
  },
  nfse: {
    label: 'NFS-e — Nota Fiscal de Serviço Eletrônica',
    tabela: 'public.notas_servico',
    descricao:
      'Emitida para prestação de serviço (ex: design, arte, personalização). ' +
      'Integra com prefeitura municipal.',
    toolReadOnly: 'fiscal.consultar',
    status: 'planejado' as const,
  },
} as const;

// ---------------------------------------------------------------------------
// Status de NF-e
// ---------------------------------------------------------------------------

export const NFE_STATUS = {
  PENDENTE: 'Rascunho criado, aguardando envio.',
  PRONTA_PARA_ENVIO: 'Validada localmente, pronta para envio ao SEFAZ.',
  PROCESSANDO: 'Enviada ao SEFAZ, aguardando retorno.',
  AUTORIZADA: 'Aprovada pelo SEFAZ. NF emitida com sucesso.',
  ERRO_AUTORIZACAO: 'SEFAZ rejeitou a NF. Ver mensagem de erro.',
  ERRO_ENVIO: 'Falha ao enviar para o SEFAZ.',
  NAO_ENCONTRADA_FOCUS: 'Não localizada no provedor Focus NFe.',
  CANCELADA: 'NF cancelada. Irreversível após autorização.',
  DENEGADA: 'NF denegada pelo SEFAZ. Não pode ser reaproveitada.',
} as const;

export type NfeStatus = keyof typeof NFE_STATUS;

// ---------------------------------------------------------------------------
// Gatilho de emissão
// ---------------------------------------------------------------------------

export const REGRAS_GATILHO_NFE = {
  campo: 'propostas.libera_nf',
  descricao:
    'Quando libera_nf = true em uma proposta, a NF-e ou NFS-e pode ser gerada para aquele id_int.',
  observacao:
    'O campo libera_nf não emite a NF automaticamente. É um flag de liberação que habilita ' +
    'o fluxo de emissão no módulo fiscal.',
  referenciaBoletim: 'O número da NF vinculada fica em boletos.n_nf após emissão.',
} as const;

// ---------------------------------------------------------------------------
// O que o Maestro PODE fazer com fiscal
// ---------------------------------------------------------------------------

export const MAESTRO_ACOES_FISCAIS = {
  permitido: [
    'Consultar se libera_nf = true para uma proposta (read).',
    'Informar o número da NF (boletos.n_nf) quando disponível.',
    'Informar o status da NF-e (notas_fiscais.status) — apenas leitura.',
    'Encaminhar o usuário ao módulo Fiscal para ações.',
    'Explicar a diferença entre NF-e (produto) e NFS-e (serviço).',
  ],
  bloqueado: [
    'NUNCA emitir NF-e ou NFS-e.',
    'NUNCA cancelar nota fiscal.',
    'NUNCA alterar dados fiscais de propostas (CFOP, NCM, valores).',
    'NUNCA alterar campos que impactam cálculo de impostos.',
    'NUNCA chamar RPCs fiscais (fn_preparar_envio_nfe, fn_montar_payload_nfe).',
  ],
} as const;

// ---------------------------------------------------------------------------
// Mapeamento tributário básico (leitura de contexto)
// ---------------------------------------------------------------------------

export const FISCAL_TRIBUTACAO_BASICA = {
  icms: {
    situacaoTributariaPadrao: '102',
    origemPadrao: '0',
  },
  pisCofins: {
    situacaoTributariaPadrao: '99',
  },
  ncmPadrao: '49119900',
  consumidorFinal: {
    cnpj: 0,
    cpf: 1,
  },
  tipoContribuinte: {
    cnpj: 1,
    cpf: 9,
  },
  modalidadeFrete: {
    comFrete: 0,
    semFrete: 9,
  },
  formasPagamentoNfe: {
    PIX: '17',
    TED: '17',
    DINHEIRO: '01',
    CARTAO: '03',
    BOLETO: '15',
  },
} as const;
