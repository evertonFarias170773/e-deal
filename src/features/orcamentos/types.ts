import type { Cadastro, CadastroContato, CadastroEndereco, CadastroVinculoComercial } from "@/features/cadastros/types";
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
  enderecoId: string;
  compradorId: string;
  itens: PropostaItem[];
  /** IDs reais de produtos_proposta.id pendentes de DELETE no banco ao salvar */
  deletedProdutoPropostaIds: number[];
  pedidosModelos: PedidoModeloState[];
  briefingArtesDraft?: any;
  fretes: PropostaFrete[];
  freteEscolhidoId: string;
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
