export type PedidoStatus =
  | "BOLETIM_FINALIZADO"
  | "APROVADO"
  | "PENDENTE"
  | "BLOQUEADO"
  | "NOVO"
  | "ARTE_EM_ANDAMENTO"
  | "AGUARDANDO_APROVACAO_CLIENTE"
  | "AGUARDANDO_APROVACAO_ATENDENTE"
  | "AGUARDANDO_OS"
  | "EM_IMPRESSAO"
  | "EM_ACABAMENTO"
  | "REVISAO_FINAL"
  | "PRONTO_EXPEDICAO"
  | "EXPEDIDO"
  | "CANCELADO";

export type ArteStatus =
  | "PENDENTE"
  | "EM_CRIACAO"
  | "EM_REVISAO_INTERNA"
  | "AGUARDANDO_CLIENTE"
  | "REPROVADA_CLIENTE"
  | "APROVADA_CLIENTE"
  | "LIBERADA"
  | "IMPRESSA"
  | "NAO_NECESSARIA"
  | "DESIGN_ATRIBUIDO";

export type ProducaoStatus =
  | "PENDENTE"
  | "EM_IMPRESSAO"
  | "EM_ACABAMENTO"
  | "CONCLUIDA"
  | "PAUSADA";

export interface ConfigImpressaoMock {
  tipoNumeracao: string;
  posicaoX?: number;
  posicaoY?: number;
  tamanhoFonte?: number;
  inclinacao?: number;
  qtdDigitos?: number;
  cor?: string;
  qrCode?: boolean;
  rfid?: boolean;
  qrTemplate?: string;
  codBarras?: boolean;
  codBarrasTipo?: string;
}

export interface ModeloMock {
  id: string;
  nomeModelo: string;
  quantidade: number;
  statusArte: ArteStatus;
  statusProducao: ProducaoStatus;
  designerResponsavel?: string;
  obsImpressao?: string;
  configImpressao: ConfigImpressaoMock;
  arteAtual?: {
    versao: number;
    urlArquivo: string;
    nomeArquivo: string;
    comentarios?: string;
    dataUpload: string;
  };
  historicoArtes: {
    versao: number;
    urlArquivo: string;
    nomeArquivo: string;
    status: ArteStatus;
    comentarios?: string;
    dataUpload: string;
  }[];
  tokenAprovacao: string;
  comentarioCliente?: string;
  aprovadoPorNome?: string;
  aprovadoEm?: string;

  // Novos campos técnicos da Ficha Gráfica
  setor: string; // ex: pulseiras, crachás, credenciais
  numeracaoInicial?: number;
  numeracaoFinal?: number;
  verso?: boolean;
  bloco?: string;
  corMaterial?: string;
  csvDadosVariaveisUrl?: string;
  gabaritoNumeracao?: string;
  observacoesTecnicas?: string;
  comentarioInterno?: string;
}

export interface ProdutoMock {
  id: string;
  db_id?: number;
  nome: string; // ex: Triband, Pulseira Tyvek, Credencial
  quantidade: number;
  pesoEstimado: number; // em kg
  quantidadeOriginal?: number; // Qtd total da proposta
  setor?: string;
  modelos: ModeloMock[];
}

export interface PedidoMock {
  id_int: number;
  clienteNome: string;
  contatoNome?: string;
  idCliente: number;
  empresa: string;
  vendedor: string;
  dataPedido: string;
  dataPrevistaEntrega: string;
  statusPedido: PedidoStatus;
  urgente: boolean;
  formaPagamento: string;
  valorTotal: number;
  pesoTeorico: number; // em kg
  pesoAferido?: number;
  volumes?: number;
  financialBlock?: boolean;
  blockReason?: string;
  tempoParadoMinutos?: number;
  dataInicioImpressao?: string;
  obs?: string;

  // Novos campos de Boletim Operacional
  briefingOperacional?: string;
  observacoesGerais?: string;
  anexos?: { url: string; name: string; type: string }[];
  dadosEvento?: {
    nome: string;
    data: string;
    local: string;
  };
  instrucoesDesign?: string;
  instrucoesImpressao?: string;
  
  // Especificações de acabamento e designer
  verniz?: string;
  laminacao?: string;
  corte?: string;
  furo?: string;
  acabamentoEspecial?: string;
  observacoesAcabamento?: string;
  designerResponsavelOS?: string;

  // Estrutura hierárquica operacional
  produtos: ProdutoMock[];

  /**
   * @deprecated Utilizar `produtos[].modelos[]`. Mantido apenas para compatibilidade das telas legadas.
   */
  modelos: ModeloMock[];
}

export interface PedidoProducaoListItem extends PedidoMock {
  id?: string;
  descricao?: string;
  status_pedido?: string;
  status_pagamento?: string;
  status_arte?: string;
  status_producao?: string;
  status_expedicao?: string;
}

export interface PropostaOperacionalListItem {
  id_int: number;
  clienteNome: string;
  empresa: string;
  vendedor: string;
  dataProposta: string;
  dataPrevistaEntrega: string; // prazo prometido
  valorTotal: number;
  status_interno: string; // Da tabela propostas
  libera_nf?: boolean | null; // Flag de liberação fiscal
  urgente: boolean;
  obs?: string;
  volumes?: number;
  pesoTeorico?: number;
  pesoAferido?: number;

  // Novos campos prioritários (Fase 1 migração)
  produto_principal?: string;
  quantidade_total?: number;
  pendencias_operacionais?: string[];

  // Evidências de OS/Boletim
  hasOS: boolean;
  isLegado: boolean;
  osId?: string;
  status_pedido?: PedidoStatus | string;
  status_producao?: string;
  status_expedicao?: string;
  codigo_rastreamento?: string;

  // Evidências Financeiras
  cobrancas_validas: number;
  cobrancas_confirmadas: number;
  bloqueio_financeiro: boolean;
  financeiro_status: "OK" | "PENDENTE" | "SEM_COBRANCA" | "PARCIAL";

  // Evidências de Arte/Modelos
  qtd_modelos: number;
  arte_status_geral: string; // "LIBERADA", "PENDENTE", "AGUARDANDO_CLIENTE", "SEM_MODELO"
  hasArtePendente: boolean;

  // Hierarquia
  produtos?: ProdutoMock[];
  modelos?: ModeloMock[];
  
  // Retrocompatibilidade (para Kanban e views antigas não quebrarem por completo se injetado)
  statusPedido?: PedidoStatus | string;
  statusArte?: ArteStatus | string;
  dadosEvento?: { nome?: string };
  briefingOperacional?: string;
  blockReason?: string;
  financialBlock?: boolean;
  idCliente?: number;
}
