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

export type Cadastro = {
  id: string;
  idCliente: number;
  nome: string;
  fantasia?: string;
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
  whatsapp: string;
  whatsapp2?: string;
  telefoneFixo?: string;
  email: string;
  emailFinanceiro?: string;
  site?: string;
  empresaPadrao: string;
  observacoes: string;
  tipoContribuinte?: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  isentoInscricaoEstadual?: boolean;
  dataFundacao?: string;
  is_bonus?: boolean;
  bonusAtivo?: boolean;
  percentualBonus?: number;
  nota?: boolean;
  sendMail?: boolean;
  sendWhats?: boolean;
  enderecos: CadastroEndereco[];
  contatos: CadastroContato[];
  vinculosComerciais: CadastroVinculoComercial[];
};

export type CadastroFormState = {
  idCliente: string;
  categoria: CadastroCategoria;
  tipoCliente: TipoClienteDocumento;
  documento: string;
  atendente: string;
  ativo: boolean;
  nome: string;
  fantasia: string;
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
  dataFundacao: string;
  limiteCredito: string;
  creditoDisponivel: string;
  riscoCredito: "BAIXO" | "MEDIO" | "ALTO";
  padraoPagamento: string;
  bonusAtivo: boolean;
  percentualBonus: string;
  nota: boolean;
  verificado: boolean;
  restricao: boolean;
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
