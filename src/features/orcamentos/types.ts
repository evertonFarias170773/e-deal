import type { Cadastro, CadastroContato, CadastroEndereco, CadastroVinculoComercial } from "@/features/cadastros/types";
import type { ModalidadeFrete } from "@/features/expedicao/types";
import type { Produto, TipoVariacao, VariacaoGlobal } from "@/features/produtos/types";

export type PropostaStatus = 
  | "NOVO" 
  | "NOVO / EM ARTE" 
  | "AGUARDANDO" 
  | "AGUARDANDO / EM ARTE" 
  | "AGUARDANDO / PENDENTE" 
  | "APROVADO" 
  | "APROVADO / EM ARTE" 
  | "REVISAO ATENDENTE" 
  | "REVISAO PRODUCAO" 
  | "EM PRODUCAO"
  | "EM IMPRESSAO"
  | "EM IMPRESSAO / PENDENTE"
  | "EM ACABAMENTO"
  | "EM ACABAMENTO / PENDENTE"
  | "EXPEDICAO"
  | "A RETIRAR" 
  | "EM TRANSITO" 
  | "ENTREGUE" 
  | "CANCELADO"
  | "STATUS_DESCONHECIDO";

export type PropostaCobrancaStatus = "NAO_GERADA" | "PENDENTE" | "GERADA" | "PAGA" | "CANCELADA";

export type PropostaVariacaoEscolhida = {
  id: string;
  id_variacao: number;
  variacao: VariacaoGlobal;
  tipo: TipoVariacao;
};

export type PedidoModeloState = {
  id?: number;
  tempId?: string;
  item_temp_id?: string;
  isPersisted: boolean;
  id_produto_proposta_origem?: number | null;
  nome_modelo: string;
  padrao: string | null;
  quantidade: number;
  tipo_numeracao: string | null;
  numeracao_inicio: number | null;
  numeracao_fim: number | null;
  verso_tipo: string | null;
  bloco?: string | null;
  gabarito_operacional?: string | null;
  status_arte?: string;
  status_producao?: string;
  /**
   * pedidos_modelos.amostra_arte_base64 — amostra renderizada da arte.
   * Somente leitura no formulário da proposta: é exibida no card do modelo,
   * mas nenhuma rotina de save a envia de volta (o upload/alteração da arte
   * continua sendo feito pelo fluxo de produção).
   */
  amostra_arte_base64?: string | null;
  /**
   * pedidos_modelos.verso_amostra_arte_base64 — amostra do verso da arte.
   * Mesmas regras do campo da frente: somente leitura no formulário da
   * proposta, exibida na visualização ampliada quando houver conteúdo.
   */
  verso_amostra_arte_base64?: string | null;
  /**
   * pedidos_modelos.variacoes_texto — texto consolidado das variações do item
   * de origem ("TAMANHO: 120 cm • ACABAMENTO: ..."). Recalculado a partir do
   * item específico da proposta (nunca por id_produto) ao criar, duplicar ou
   * alterar variações.
   */
  variacoes_texto?: string | null;
  ordem?: number;
  /** Camarote (producao_numeracoes.tipo = CAMAROTE): quantidade total de camarotes */
  Q_CAM?: number | null;
  /** Camarote: lugares por camarote */
  L_CAM?: number | null;
  /** Camarote: número inicial do camarote */
  C_INI?: number | null;
};

export type TipoDescontoProposta = "PERCENTUAL" | "VALOR";

export type PropostaItem = {
  id: string;
  id_produto_proposta_origem?: number;
  id_int?: number;
  id_produto: number;
  produto: Produto;
  nome: string;
  nome_produto?: string;
  formato: string;
  descricaoModelo: string;
  quantidade: number;
  qtd?: number;
  valorUnitario: number;
  valorFixo: number;
  subtotalBruto: number;
  acrescimoBonus: number;
  subtotal: number;
  prazo: string;
  pesoUnitario: number;
  pesoTotal: number;
  variacoesEscolhidas: PropostaVariacaoEscolhida[];
  statusItem?: string;
  /**
   * produtos_proposta.is_estoque — produto de prateleira, dispensa arte.
   * Snapshot congelado no save: alterar o cadastro do produto depois não muda
   * proposta já fechada. Ao montar um item novo vem de produto.is_estoque.
   */
  isEstoque?: boolean;
};

export type PropostaFrete = {
  id: string;
  id_int: number;
  transportadora: string;
  servico: string;
  valor: number;
  prazo: string;
  observacao: string;
  escolhido: boolean;
  chosen?: boolean;
  pesoUsado: number;
  valorOriginal?: number;
  valorMargem?: number;
  volumes?: number;
  pesoKg?: number;
  id_cotacao?: number;
};

export type PropostaResumo = {
  subtotalBrutoProdutos: number;
  acrescimoBonus: number;
  subtotalProdutos: number;
  descontoGeralTipo: TipoDescontoProposta;
  descontoGeralValor: number;
  descontoGeral: number;
  frete: number;
  valorTotal: number;
  pesoTotal: number;
  prazoProducao: string;
  prazoEntrega: string;
};

export type Proposta = {
  id: string;
  id_int: number;
  cliente: Cadastro;
  compradorAutorizado?: CadastroVinculoComercial;
  contato: CadastroContato;
  enderecoEntrega: CadastroEndereco;
  empresa: string;
  vendedor: string;
  data: string;
  status: PropostaStatus;
  itens: PropostaItem[];
  fretes: PropostaFrete[];
  freteEscolhidoId: string;
  /** propostas.modalidade_frete — quem paga, declarado na aba Fretes. */
  modalidadeFrete: ModalidadeFrete | null;
  /** propostas.id_transportadora_cliente — transportadora definida em FOB. */
  idTransportadoraCliente: number | null;
  resumo: PropostaResumo;
  descontoGeralTipo: TipoDescontoProposta;
  descontoGeralValor: number;
  formaPagamento: string;
  cobrancaStatus: PropostaCobrancaStatus;
  observacoes: string;
  is_avulso?: boolean;
  clienteNaoCadastrado?: boolean;
  id_faturado?: number | null;
  status_interno?: string;
  /**
   * `propostas.is_prd_aprovado` — se a proposta esta na fila produtiva. A tela
   * de detalhe precisa disso para oferecer "Retirar da Producao" no menu de
   * acoes, com a MESMA condicao que a lista usa.
   */
  is_prd_aprovado?: boolean;
  dbValorTotal?: number | null;
};

export type PropostaFormState = {
  id_int: string;
  empresa: string;
  vendedor: string;
  status: PropostaStatus;
  emArte?: boolean;
  clienteId: string;
  contatoId: string;
  /**
   * Nome do contato selecionado, resolvido pela tela na hora de salvar.
   * Existe porque contato adicionado direto na proposta vive só no estado da
   * tela (id sintético `cont_prop_<timestamp>`) e nunca esteve em
   * `cadastro.contatos` — sem isto o save não achava o nome e gravava o ID em
   * `propostas.contato`.
   */
  contatoNome?: string;
  enderecoId: string;
  compradorId: string;
  itens: PropostaItem[];
  /** IDs reais de produtos_proposta.id pendentes de DELETE no banco ao salvar */
  deletedProdutoPropostaIds: number[];
  pedidosModelos: PedidoModeloState[];
  briefingArtesDraft?: any;
  fretes: PropostaFrete[];
  freteEscolhidoId: string;
  /** Quem paga o transporte. Null em proposta anterior a 18/08/2026 ou ainda não declarada. */
  modalidadeFrete: ModalidadeFrete | null;
  /** FK para clientes(id_cliente) — só transportadoras cadastradas e ativas. */
  idTransportadoraCliente: number | null;
  descontoGeralTipo: TipoDescontoProposta;
  descontoGeralValor: string;
  formaPagamento: string;
  observacoes: string;
  isAvulso?: boolean;
  valorProdutosManual?: string;
  valorFreteManual?: string;
  observacoesFreteManual?: string;
  clienteNaoCadastrado?: boolean;
  nomeClienteLivre?: string;
  cepLivre?: string;
  cidadeLivre?: string;
  ufLivre?: string;
};
