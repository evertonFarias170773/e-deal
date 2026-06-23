import type { Cadastro, CadastroContato, CadastroEndereco, CadastroVinculoComercial } from "@/features/cadastros/types";
import type { Produto, TipoVariacao, VariacaoGlobal } from "@/features/produtos/types";

export type PropostaStatus = "NOVO" | "AGUARDANDO" | "APROVADO" | "CANCELADO";

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
  isPersisted: boolean;
  id_produto_proposta_origem?: number | null;
  id_item?: string | null;
  nome_modelo: string;
  descricao: string | null;
  padrao: string | null;
  quantidade: number;
  tipo_numeracao: string | null;
  numeracao_inicio: number | null;
  numeracao_fim: number | null;
  verso_tipo: string | null;
  gabarito_operacional?: string | null;
  status_arte?: string;
  status_producao?: string;
  ordem?: number;
};

export type TipoDescontoProposta = "PERCENTUAL" | "VALOR";

export type PropostaItem = {
  id: string;
  id_produto_proposta_origem?: number;
  id_produto: number;
  produto: Produto;
  nome: string;
  formato: string;
  descricaoModelo: string;
  quantidade: number;
  valorUnitario: number;
  valorFixo: number;
  descontoTipo: TipoDescontoProposta;
  descontoValor: number;
  subtotalBruto: number;
  descontoValorCalculado: number;
  acrescimoBonus: number;
  subtotal: number;
  prazo: string;
  pesoUnitario: number;
  pesoTotal: number;
  variacoesEscolhidas: PropostaVariacaoEscolhida[];
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
  descontosIndividuais: number;
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
  /** ID do cliente faturado (referencia public.clientes.id_cliente). Usado para restaurar compradorId ao reabrir proposta. */
  id_faturado?: number | null;
};

export type PropostaFormState = {
  id_int: string;
  empresa: string;
  vendedor: string;
  status: PropostaStatus;
  clienteId: string;
  contatoId: string;
  enderecoId: string;
  compradorId: string;
  itens: PropostaItem[];
  pedidosModelos: PedidoModeloState[];
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
