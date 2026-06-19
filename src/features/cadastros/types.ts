export type CadastroCategoria = "CLIENTE" | "TRANSPORTADORA" | "FORNECEDOR" | "ORGAO_PUBLICO";

export type TipoClienteDocumento = "CPF" | "CNPJ";

export type CadastroEndereco = {
  id: string;
  tipo: "principal" | "entrega" | "cobranca" | "fiscal";
  cep: string;
  endereco: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  obs?: string;
  recebedor?: string;
  cpfRecebedor?: string;
};

export type CadastroContato = {
  id: string;
  nome: string;
  cargo: string;
  whatsapp: string;
  email: string;
};

export type CadastroVinculoComercial = {
  id: string;
  idClienteRelacionado: number;
  nome: string;
  documento: string;
  tipoRelacao: string;
};

export type CadastroPropostaListItem = {
  id: string;
  idInt: number;
  idCliente: number;
  cliente: string;
  proposta: string;
  valor: number;
  valorTotal: number;
  vendedor: string;
  statusInterno: string;
  empresa: string;
  createdAt: string;
  updatedAt: string;
};

export type Cadastro = {
  id: string;
  idCliente: number;
  idVendedor?: string | number | null;
  nome: string;
  fantasia?: string;
  apelido?: string;
  contato?: string;
  categoria: CadastroCategoria;
  documento: string;
  tipoPessoa: "FISICA" | "JURIDICA";
  cidadeUf: string;
  vendedor: string;
  vendedor_padrao?: string;
  ativo: boolean;
  restricao: boolean;
  verificado: boolean;
  riscoCredito: "BAIXO" | "MEDIO" | "ALTO";
  limiteCredito: number;
  creditoDisponivel: number;
  padraoPagamento: string;
  ultimaCompra: string;
  totalCompras: number;
  valorTotalComprado?: number;
  whatsapp: string;
  whatsapp2?: string;
  telefoneFixo?: string;
  email: string;
  emailFinanceiro?: string;
  site?: string;
  empresaPadrao: string;
  observacoes: string;
  dataCadastro?: string;
  tipoContribuinte?: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  isentoInscricaoEstadual?: boolean;
  dataFundacao?: string;
  is_bonus?: boolean;
  bonusAtivo?: boolean;
  percentualBonus?: number;
  dataVerificacao?: string;
  motivoErro?: string;
  cpfInvalido?: boolean;
  cpfErro?: string;
  nota?: boolean;
  sendMail?: boolean;
  sendWhats?: boolean;
  /** UUID de public.modelos_cobranca. Só relevante quando padraoPagamento = 'FATURADO'. */
  modeloCobrancaId?: string | null;
  enderecos: CadastroEndereco[];
  contatos: CadastroContato[];
  vinculosComerciais: CadastroVinculoComercial[];
};

export type CadastroFormState = {
  idCliente: string;
  idVendedor: string;
  categoria: CadastroCategoria;
  tipoCliente: TipoClienteDocumento;
  documento: string;
  atendente: string;
  ativo: boolean;
  nome: string;
  fantasia: string;
  apelido: string;
  contato: string;
  tipoContribuinte: string;
  email: string;
  emailFinanceiro: string;
  inscricaoEstadual: string;
  isentoInscricaoEstadual: boolean;
  inscricaoMunicipal: string;
  telefoneFixo: string;
  site: string;
  whatsapp: string;
  whatsapp2: string;
  empresaPadrao: string;
  cidadeUf: string;
  dataFundacao: string;
  dataCadastro: string;
  dataVerificacao: string;
  ultimaCompra: string;
  totalCompras: string;
  credito: string;
  limiteCredito: string;
  creditoDisponivel: string;
  riscoCredito: "BAIXO" | "MEDIO" | "ALTO";
  padraoPagamento: string;
  modeloCobrancaId?: string;
  valorTotalComprado?: number;
  bonusAtivo: boolean;
  percentualBonus: string;
  nota: boolean;
  verificado: boolean;
  restricao: boolean;
  cpfInvalido: boolean;
  cpfErro: string;
  motivoErro: string;
  sendMail: boolean;
  sendWhats: boolean;
  observacoes: string;
  enderecos: CadastroEndereco[];
  contatos: CadastroContato[];
  vinculosComerciais: CadastroVinculoComercial[];
};

export type ConsultaCnpjMockResult = {
  nome: string;
  fantasia: string;
  email: string;
  telefone: string;
  endereco: CadastroEndereco;
};
