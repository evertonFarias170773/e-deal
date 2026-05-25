import type { Cadastro, ConsultaCnpjMockResult, TipoClienteDocumento } from "@/features/cadastros/types";

export const cadastrosMock: Cadastro[] = [
  {
    id: "cad_120017",
    idCliente: 120017,
    nome: "Entre Pontos Express LTDA",
    fantasia: "Entre Pontos",
    categoria: "CLIENTE",
    documento: "04142031000138",
    tipoPessoa: "JURIDICA",
    cidadeUf: "Porto Alegre - RS",
    vendedor: "Edison Jr",
    vendedor_padrao: "Edison Jr",
    ativo: true,
    restricao: false,
    verificado: true,
    riscoCredito: "BAIXO",
    limiteCredito: 15000,
    creditoDisponivel: 8200,
    padraoPagamento: "Pix a vista 3 dias",
    ultimaCompra: "2026-05-10",
    totalCompras: 42890.5,
    whatsapp: "51999887766",
    email: "compras@entrepontos.local",
    empresaPadrao: "Ideal Grafica",
    is_bonus: true,
    bonusAtivo: true,
    percentualBonus: 10,
    observacoes: "Cliente recorrente para credenciais e materiais de evento.",
    enderecos: [
      {
        id: "end_1",
        tipo: "principal",
        cep: "90010000",
        endereco: "Rua dos Andradas",
        numero: "1200",
        bairro: "Centro Historico",
        cidade: "Porto Alegre",
        uf: "RS"
      },
      {
        id: "end_2",
        tipo: "entrega",
        cep: "90240000",
        endereco: "Avenida Sertorio",
        numero: "845",
        bairro: "Navegantes",
        cidade: "Porto Alegre",
        uf: "RS"
      }
    ],
    contatos: [
      {
        id: "cont_1",
        nome: "Marina Lopes",
        cargo: "Compras",
        whatsapp: "51999887766",
        email: "marina@entrepontos.local"
      }
    ],
    vinculosComerciais: [
      {
        id: "vinc_1",
        idClienteRelacionado: 2005,
        nome: "Joao Pereira Eventos ME",
        documento: "15555111000180",
        tipoRelacao: "Autorizado a comprar"
      }
    ]
  },
  {
    id: "cad_922723",
    idCliente: 922723,
    nome: "Gremio Football Porto Alegrense",
    fantasia: "Gremio",
    categoria: "CLIENTE",
    documento: "92703659000144",
    tipoPessoa: "JURIDICA",
    cidadeUf: "Porto Alegre - RS",
    vendedor: "Caroline Silva",
    vendedor_padrao: "Caroline Silva",
    ativo: true,
    restricao: false,
    verificado: true,
    riscoCredito: "MEDIO",
    limiteCredito: 12000,
    creditoDisponivel: 1500,
    padraoPagamento: "Boleto 14 dias",
    ultimaCompra: "2026-05-18",
    totalCompras: 188430.9,
    whatsapp: "5133334444",
    email: "eventos@gremio.local",
    empresaPadrao: "Ideal Biro",
    is_bonus: false,
    bonusAtivo: false,
    percentualBonus: 0,
    observacoes: "Atender demandas com prioridade de prazo em jogos e eventos.",
    enderecos: [
      {
        id: "end_3",
        tipo: "principal",
        cep: "90250180",
        endereco: "Avenida Padre Leopoldo Brentano",
        numero: "110",
        bairro: "Humaita",
        cidade: "Porto Alegre",
        uf: "RS"
      }
    ],
    contatos: [
      {
        id: "cont_2",
        nome: "Rafael Monteiro",
        cargo: "Eventos",
        whatsapp: "51988776655",
        email: "rafael@gremio.local"
      }
    ],
    vinculosComerciais: []
  },
  {
    id: "cad_310442",
    idCliente: 310442,
    nome: "Translog Sul Transportes LTDA",
    fantasia: "Translog Sul",
    categoria: "TRANSPORTADORA",
    documento: "11888777000190",
    tipoPessoa: "JURIDICA",
    cidadeUf: "Canoas - RS",
    vendedor: "Operacao",
    ativo: true,
    restricao: false,
    verificado: true,
    riscoCredito: "BAIXO",
    limiteCredito: 0,
    creditoDisponivel: 0,
    padraoPagamento: "Contrato mensal",
    ultimaCompra: "2026-04-29",
    totalCompras: 0,
    whatsapp: "51991234567",
    email: "operacao@translogsul.local",
    empresaPadrao: "Ideal Grafica",
    observacoes: "Transportadora usada para entregas metropolitanas.",
    enderecos: [
      {
        id: "end_4",
        tipo: "principal",
        cep: "92010000",
        endereco: "Rua Industrial",
        numero: "400",
        bairro: "Sao Luis",
        cidade: "Canoas",
        uf: "RS"
      }
    ],
    contatos: [
      {
        id: "cont_3",
        nome: "Paula Ramos",
        cargo: "Logistica",
        whatsapp: "51991234567",
        email: "paula@translogsul.local"
      }
    ],
    vinculosComerciais: []
  },
  {
    id: "cad_540118",
    idCliente: 540118,
    nome: "Alpha Suprimentos Graficos SA",
    fantasia: "Alpha Suprimentos",
    categoria: "FORNECEDOR",
    documento: "33777222000110",
    tipoPessoa: "JURIDICA",
    cidadeUf: "Sao Leopoldo - RS",
    vendedor: "Administrativo",
    ativo: true,
    restricao: false,
    verificado: false,
    riscoCredito: "BAIXO",
    limiteCredito: 0,
    creditoDisponivel: 0,
    padraoPagamento: "Faturado 28 dias",
    ultimaCompra: "2026-03-21",
    totalCompras: 0,
    whatsapp: "51984561230",
    email: "comercial@alphasuprimentos.local",
    empresaPadrao: "Ideal Grafica",
    observacoes: "Fornecedor de insumos para impressao e acabamento.",
    enderecos: [
      {
        id: "end_5",
        tipo: "principal",
        cep: "93010000",
        endereco: "Avenida Unisinos",
        numero: "90",
        bairro: "Cristo Rei",
        cidade: "Sao Leopoldo",
        uf: "RS"
      }
    ],
    contatos: [
      {
        id: "cont_4",
        nome: "Renato Assis",
        cargo: "Comercial",
        whatsapp: "51984561230",
        email: "renato@alphasuprimentos.local"
      }
    ],
    vinculosComerciais: []
  },
  {
    id: "cad_770055",
    idCliente: 770055,
    nome: "Prefeitura Municipal de Nova Aurora",
    fantasia: "Prefeitura de Nova Aurora",
    categoria: "ORGAO_PUBLICO",
    documento: "88444111000122",
    tipoPessoa: "JURIDICA",
    cidadeUf: "Nova Aurora - PR",
    vendedor: "Edison Jr",
    ativo: true,
    restricao: true,
    verificado: false,
    riscoCredito: "BAIXO",
    limiteCredito: 35000,
    creditoDisponivel: 24000,
    padraoPagamento: "Empenho / faturado",
    ultimaCompra: "2026-02-14",
    totalCompras: 23800,
    whatsapp: "45999881122",
    email: "licitacoes@novaaurora.local",
    empresaPadrao: "E3 Brindes",
    observacoes: "Cadastro exige revisao documental antes de nova proposta.",
    enderecos: [
      {
        id: "end_6",
        tipo: "principal",
        cep: "85410000",
        endereco: "Praca dos Poderes",
        numero: "1",
        bairro: "Centro",
        cidade: "Nova Aurora",
        uf: "PR"
      }
    ],
    contatos: [
      {
        id: "cont_5",
        nome: "Silvia Andrade",
        cargo: "Compras publicas",
        whatsapp: "45999881122",
        email: "silvia@novaaurora.local"
      }
    ],
    vinculosComerciais: []
  },
  {
    id: "cad_882100",
    idCliente: 882100,
    nome: "Josiane Stein LTDA",
    fantasia: "JS Eventos",
    categoria: "CLIENTE",
    documento: "26555111000108",
    tipoPessoa: "JURIDICA",
    cidadeUf: "Caxias do Sul - RS",
    vendedor: "Caroline Silva",
    ativo: false,
    restricao: false,
    verificado: true,
    riscoCredito: "MEDIO",
    limiteCredito: 10000,
    creditoDisponivel: 4000,
    padraoPagamento: "Pix antecipado",
    ultimaCompra: "2025-11-02",
    totalCompras: 7640,
    whatsapp: "54988770011",
    email: "contato@jseventos.local",
    empresaPadrao: "Ideal Biro",
    observacoes: "Cadastro inativo ate nova validacao comercial.",
    enderecos: [
      {
        id: "end_7",
        tipo: "principal",
        cep: "95010000",
        endereco: "Rua Sinimbu",
        numero: "700",
        bairro: "Centro",
        cidade: "Caxias do Sul",
        uf: "RS"
      }
    ],
    contatos: [
      {
        id: "cont_6",
        nome: "Josiane Stein",
        cargo: "Diretora",
        whatsapp: "54988770011",
        email: "josiane@jseventos.local"
      }
    ],
    vinculosComerciais: []
  }
];

export function getCadastroById(idCliente: number) {
  return cadastrosMock.find((cadastro) => cadastro.idCliente === idCliente);
}

export const atendentesMock = [
  "Everton Farias",
  "Alexandre Almeida",
  "Emily Boeira",
  "Fabio Almeida",
  "Edison Jr"
];

export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function verificarIdClienteMock(idCliente: number) {
  return cadastrosMock.find((cadastro) => cadastro.idCliente === idCliente) ?? null;
}

export function verificarDocumentoMock(documento: string) {
  const digits = onlyDigits(documento);

  return cadastrosMock.find((cadastro) => onlyDigits(cadastro.documento) === digits) ?? null;
}

export function validarCpfCnpj(documento: string, tipo?: TipoClienteDocumento) {
  const digits = onlyDigits(documento);

  if (tipo === "CPF" || digits.length === 11) {
    return isValidCpf(digits);
  }

  if (tipo === "CNPJ" || digits.length === 14) {
    return isValidCnpj(digits);
  }

  return false;
}

export function consultarCnpjMock(documento: string): ConsultaCnpjMockResult {
  const digits = onlyDigits(documento);

  return {
    nome: digits === "11222333000181" ? "Ideal Eventos Corporativos LTDA" : "Empresa Mockada LTDA",
    fantasia: digits === "11222333000181" ? "Ideal Eventos" : "Empresa Mock",
    email: "contato@empresa-mock.local",
    telefone: "5133332211",
    endereco: {
      id: `end_mock_${Date.now()}`,
      tipo: "principal",
      cep: "90570020",
      endereco: "Avenida Carlos Gomes",
      numero: "700",
      complemento: "Sala 301",
      bairro: "Boa Vista",
      cidade: "Porto Alegre",
      uf: "RS",
      obs: "Endereco preenchido por consulta CNPJ mockada."
    }
  };
}

function isValidCpf(cpf: string) {
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) {
    return false;
  }

  const calcDigit = (base: string, factor: number) => {
    const total = base.split("").reduce((sum, digit) => sum + Number(digit) * factor--, 0);
    const rest = (total * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  const firstDigit = calcDigit(cpf.slice(0, 9), 10);
  const secondDigit = calcDigit(cpf.slice(0, 10), 11);

  return firstDigit === Number(cpf[9]) && secondDigit === Number(cpf[10]);
}

function isValidCnpj(cnpj: string) {
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) {
    return false;
  }

  const calcDigit = (base: string, factors: number[]) => {
    const total = base.split("").reduce((sum, digit, index) => sum + Number(digit) * factors[index], 0);
    const rest = total % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const firstDigit = calcDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondDigit = calcDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return firstDigit === Number(cnpj[12]) && secondDigit === Number(cnpj[13]);
}
