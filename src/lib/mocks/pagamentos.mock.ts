import type {
  Cobranca,
  CobrancaHistoricoEvento,
  CobrancaParcelaSimulada,
  CobrancaTipo,
  CriarCobrancaFormValues,
  EmpresaRecebedoraOption,
  PropostaChatFinanceiro,
  PropostaCobrancaSnapshot
} from "@/features/cobrancas/types";
import type { Proposta } from "@/features/orcamentos/types";
import { mockCompanies } from "@/lib/mocks/empresas.mock";
import { roundMoney } from "@/features/cobrancas/cobrancas-utils";

export const empresasRecebedorasMock: EmpresaRecebedoraOption[] = mockCompanies
  .filter((company) => !company.isConsolidated)
  .map((company) => ({
    id: company.id,
    nome: company.name,
    labelCurta: company.shortName,
    documento: company.document,
    fluxoFuturo:
      company.shortName === "Ideal"
        ? "Fluxo com credencial e conta exclusiva da Ideal."
        : company.shortName === "Biro"
          ? "Fluxo com regras próprias do Birô."
          : "Fluxo com credenciais independentes da E3.",
    descricao: `Empresa recebedora ${company.shortName} preparada para integrações financeiras próprias.`
  }));

export const tiposCobrancaMock: Array<{ id: CobrancaTipo; label: string; descricao: string }> = [
  { id: "PIX", label: "PIX", descricao: "Cria cobrança imediata com token público." },
  { id: "BOLETO", label: "Boleto", descricao: "Gera linha digitável e PDF." },
  { id: "CREDIT_CARD", label: "Cartão de crédito (Antigo)", descricao: "Cria checkout para cobrança à vista no cartão." },
  { id: "CARD_PARCELADO", label: "Cartão de crédito", descricao: "Simula checkout de cartão com juros/taxa ou à vista." },
  { id: "E-FATURADO", label: "Faturado", descricao: "Valida crédito do cliente e envia para análise financeira." }
];

const tipoDisponibilidadePorEmpresa: Record<string, Record<CobrancaTipo, boolean>> = {
  "Ideal Grafica": {
    PIX: true,
    BOLETO: true,
    CREDIT_CARD: true,
    CARD_PARCELADO: true,
    "E-FATURADO": true
  },
  "Ideal Biro": {
    PIX: true,
    BOLETO: false,
    CREDIT_CARD: false,
    CARD_PARCELADO: false,
    "E-FATURADO": true
  },
  "E3 Brindes": {
    PIX: true,
    BOLETO: true,
    CREDIT_CARD: true,
    CARD_PARCELADO: true,
    "E-FATURADO": true
  }
};

function createHistory(
  base: Array<Pick<CobrancaHistoricoEvento, "data" | "titulo" | "descricao" | "tipo">>
): CobrancaHistoricoEvento[] {
  return base.map((item, index) => ({ id: `hist_${index + 1}_${item.data}`, ...item }));
}

function createChat(
  base: Array<Pick<PropostaChatFinanceiro, "data" | "autor" | "mensagem" | "categoria">>
): PropostaChatFinanceiro[] {
  return base.map((item, index) => ({ id: `chat_${index + 1}_${item.data}`, ...item }));
}

function createPixCode(idPagamento: string, valor: number) {
  return `00020126580014BR.GOV.BCB.PIX0136pix-${idPagamento}520400005303986540${valor
    .toFixed(2)
    .replace(".", "")}5802BR5915ERP IDEAL 6009BLUMENAU62070503***6304`;
}

function createLinhaDigitavel(idPagamento: string, valor: number) {
  const suffix = idPagamento.replace(/\D/g, "").slice(-10).padEnd(10, "0");
  const cents = Math.round(valor * 100).toString().padStart(10, "0");
  return `34191.79001 ${suffix.slice(0, 5)} ${suffix.slice(5)} 5 ${cents.slice(0, 5)}.${cents.slice(5)}`;
}

function buildPublicUrl(token: string) {
  return `/pagamento/${token}`;
}

export function getCobrancaTipoLabel(tipo: CobrancaTipo) {
  return tiposCobrancaMock.find((item) => item.id === tipo)?.label ?? tipo;
}

export function getEmpresaRecebedoraById(id?: number | null) {
  return empresasRecebedorasMock.find((empresa) => empresa.id === id);
}

export function getEmpresaRecebedoraByNome(nome: string) {
  return empresasRecebedorasMock.find((empresa) => empresa.nome === nome);
}

export function getEmpresaRecebedoraByProposta(proposta: { empresa?: string; empresaProposta?: string }) {
  const nomeEmpresa = proposta.empresaProposta || proposta.empresa || "";
  return getEmpresaRecebedoraByNome(nomeEmpresa);
}

export function isTipoDisponivelParaEmpresa(empresaNome: string, tipo: CobrancaTipo) {
  return tipoDisponibilidadePorEmpresa[empresaNome]?.[tipo] ?? false;
}

export function getMensagemTipoIndisponivel(empresaNome: string, tipo: CobrancaTipo) {
  if (empresaNome === "Ideal Biro" && tipo === "BOLETO") {
    return "Boleto à vista não está disponível para Birô.";
  }

  if (empresaNome === "Ideal Biro" && (tipo === "CREDIT_CARD" || tipo === "CARD_PARCELADO")) {
    return "Cartão não está disponível para Birô.";
  }

  return "";
}

export function createParcelasSimuladas(valor: number): CobrancaParcelaSimulada[] {
  const base = [
    { parcelas: 1, taxaPercentual: 0 },
    { parcelas: 2, taxaPercentual: 4.5 },
    { parcelas: 3, taxaPercentual: 6.2 },
    { parcelas: 6, taxaPercentual: 11.9 }
  ];

  return base.map(({ parcelas, taxaPercentual }) => {
    const valorTaxa = valor * (taxaPercentual / 100);
    const valorFinal = valor + valorTaxa;
    const valorParcela = valorFinal / parcelas;

    return {
      parcelas,
      taxaPercentual,
      valorTaxa,
      valorFinal,
      valorParcela,
      rotulo:
        parcelas === 1
          ? `1x de ${valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} sem juros`
          : `${parcelas}x de ${valorParcela.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} com juros`
    };
  });
}

export const criarCobrancaInitialValues: CriarCobrancaFormValues = {
  propostaIdInt: null,
  osIdeal: "",
  tipoCobranca: "PIX",
  valor: 0,
  vencimento: "",
  observacao: "",
  descricao: "",
  condicaoPagamento: "À vista",
  expiracaoPix: "",
  multaPercentual: 2,
  jurosPercentual: 1,
  capturaAutomatica: true,
  parcelaSelecionada: undefined
};

function createBaseCobranca({
  id,
  id_pagamento,
  os_ideal,
  proposta,
  tipo_cobranca,
  status,
  valor,
  createdAt,
  vencimento,
  confirmado,
  paidAt,
  descricao,
  condicaoPagamento,
  creditoPendente,
  pedidoLiberadoMock
}: {
  id: string;
  id_pagamento: string;
  os_ideal: string;
  proposta: PropostaCobrancaSnapshot;
  tipo_cobranca: CobrancaTipo;
  status: Cobranca["status"];
  valor: number;
  createdAt: string;
  vencimento?: string;
  confirmado: boolean;
  paidAt?: string;
  descricao: string;
  condicaoPagamento?: string;
  creditoPendente?: boolean;
  pedidoLiberadoMock?: boolean;
}): Cobranca {
  const empresa = getEmpresaRecebedoraByNome(proposta.empresaProposta);
  const token = `pub_${id_pagamento.toLowerCase()}`;

  if (!empresa) {
    throw new Error(`Empresa recebedora não encontrada para a proposta: ${proposta.empresaProposta}`);
  }

  return {
    id,
    id_pagamento,
    os_ideal,
    id_int: proposta.id_int,
    id_cliente: 120017,
    valor,
    status,
    tipo_cobranca,
    created_at: createdAt,
    paid_at: paidAt,
    vencimento,
    cliente: proposta.cliente,
    empresa: empresa.nome,
    descricao,
    documento: proposta.documento,
    atendente: proposta.vendedor,
    confirmado,
    confirmado_por: confirmado ? "Financeiro" : undefined,
    data_confirmacao: confirmado ? paidAt ?? createdAt : undefined,
    id_empresa: empresa.id,
    token_publico: token,
    url_cobranca: buildPublicUrl(token),
    saldo_pendente: Math.max(0, proposta.valorTotal - valor),
    valor_frete: proposta.valorFrete,
    condicao_pagamento: condicaoPagamento,
    creditoPendente,
    pedidoLiberadoMock,
    proposta,
    historico: [],
    propostasChat: []
  };
}

const snapshotIdeal: PropostaCobrancaSnapshot = {
  id_int: 16790,
  statusProposta: "NOVO",
  cliente: "Ideal Comercial Ltda",
  documento: "12.345.678/0001-90",
  valorTotal: 1030.9,
  valorPendente: 1030.9,
  empresaProposta: "Ideal Grafica",
  vendedor: "Everton Farias",
  descricao: "Pulseiras e ingressos para evento corporativo.",
  valorFrete: 68.9
};

const snapshotBiro: PropostaCobrancaSnapshot = {
  id_int: 16804,
  statusProposta: "AGUARDANDO",
  cliente: "Birô Serviços Graficos",
  documento: "98.765.432/0001-10",
  valorTotal: 9800,
  valorPendente: 9800,
  empresaProposta: "Ideal Biro",
  vendedor: "Caroline Silva",
  descricao: "Aguardando validação de faturamento para credenciais.",
  valorFrete: 94.5
};

const snapshotE3: PropostaCobrancaSnapshot = {
  id_int: 16821,
  statusProposta: "APROVADO",
  cliente: "E3 Distribuidora de Brindes",
  documento: "45.678.901/0001-23",
  valorTotal: 14200,
  valorPendente: 14200,
  empresaProposta: "E3 Brindes",
  vendedor: "Edison Jr",
  descricao: "Brindes corporativos com empenho público.",
  valorFrete: 52.7
};

const pixPendente = {
  ...createBaseCobranca({
    id: "cob_1",
    id_pagamento: "PG-2026-0001",
    os_ideal: "OS-IDEAL-2101",
    proposta: snapshotIdeal,
    tipo_cobranca: "PIX",
    status: "A_RECEBER",
    valor: 1030.9,
    createdAt: "2026-05-21T10:20:00-03:00",
    vencimento: "2026-05-24T18:00:00-03:00",
    confirmado: false,
    descricao: "PIX gerado na proposta pelo vendedor.",
    condicaoPagamento: "PIX à vista"
  }),
  pix_copia_cola: createPixCode("PG-2026-0001", 1030.9),
  historico: createHistory([
    {
      data: "2026-05-21T10:20:00-03:00",
      titulo: "Cobrança criada dentro da proposta",
      descricao: "Vendedor gerou PIX a partir da área de cobranças.",
      tipo: "success"
    }
  ])
} satisfies Cobranca;

const pixPago = {
  ...createBaseCobranca({
    id: "cob_2",
    id_pagamento: "PG-2026-0002",
    os_ideal: "OS-IDEAL-2101",
    proposta: snapshotIdeal,
    tipo_cobranca: "PIX",
    status: "PAID",
    valor: 700,
    createdAt: "2026-05-18T08:30:00-03:00",
    vencimento: "2026-05-19T23:59:00-03:00",
    confirmado: true,
    paidAt: "2026-05-18T09:12:00-03:00",
    descricao: "Entrada PIX confirmada.",
    condicaoPagamento: "Entrada PIX"
  }),
  pix_copia_cola: createPixCode("PG-2026-0002", 700),
  historico: createHistory([
    {
      data: "2026-05-18T08:30:00-03:00",
      titulo: "PIX gerado na proposta",
      description: "Cobrança criada como entrada financeira.",
      tipo: "success"
    } as unknown as Pick<CobrancaHistoricoEvento, "data" | "titulo" | "descricao" | "tipo">,
    {
      data: "2026-05-18T09:12:00-03:00",
      titulo: "Pagamento confirmado",
      description: "Confirmação realizada.",
      tipo: "success"
    } as unknown as Pick<CobrancaHistoricoEvento, "data" | "titulo" | "descricao" | "tipo">
  ])
} satisfies Cobranca;

const boletoAVencer = {
  ...createBaseCobranca({
    id: "cob_3",
    id_pagamento: "PG-2026-0003",
    os_ideal: "OS-E3-8840",
    proposta: snapshotE3,
    tipo_cobranca: "BOLETO",
    status: "A_RECEBER",
    valor: 5860,
    createdAt: "2026-05-20T14:10:00-03:00",
    vencimento: "2026-06-03T00:00:00-03:00",
    confirmado: false,
    descricao: "Boleto à vista para conferência financeira.",
    condicaoPagamento: "Boleto 14 dias"
  }),
  linha_digitavel: createLinhaDigitavel("PG-2026-0003", 5860),
  url_pdf: "/documentos/boleto-pg-2026-0003.pdf",
  multaPercentual: 2,
  jurosPercentual: 1,
  historico: createHistory([
    {
      data: "2026-05-20T14:10:00-03:00",
      titulo: "Boleto emitido",
      descricao: "Linha digitável e PDF foram gerados para a proposta.",
      tipo: "success"
    }
  ])
} satisfies Cobranca;

const boletoVencido = {
  ...createBaseCobranca({
    id: "cob_4",
    id_pagamento: "PG-2026-0004",
    os_ideal: "OS-IDEAL-2088",
    proposta: snapshotIdeal,
    tipo_cobranca: "BOLETO",
    status: "CANCELADO",
    valor: 2210,
    createdAt: "2026-04-28T11:00:00-03:00",
    vencimento: "2026-05-05T00:00:00-03:00",
    confirmado: false,
    descricao: "Boleto cancelado para manter o saldo da proposta coerente.",
    condicaoPagamento: "Boleto à vista"
  }),
  linha_digitavel: createLinhaDigitavel("PG-2026-0004", 2210),
  url_pdf: "/documentos/boleto-pg-2026-0004.pdf",
  erro_pagamento: "Boleto vencido sem pagamento confirmado.",
  multaPercentual: 2,
  jurosPercentual: 1,
  historico: createHistory([
    {
      data: "2026-05-06T09:00:00-03:00",
      titulo: "Cobrança em atraso",
      descricao: "Financeiro precisa conferir o vencimento e cobrar o cliente.",
      tipo: "warning"
    }
  ])
} satisfies Cobranca;

const cartaoPendente = {
  ...createBaseCobranca({
    id: "cob_5",
    id_pagamento: "PG-2026-0005",
    os_ideal: "OS-IDEAL-2105",
    proposta: snapshotIdeal,
    tipo_cobranca: "CREDIT_CARD",
    status: "CANCELADO",
    valor: 3990,
    createdAt: "2026-05-22T09:50:00-03:00",
    confirmado: false,
    descricao: "Checkout de cartão cancelado para manter o saldo inicial da proposta coerente.",
    condicaoPagamento: "Cartão à vista"
  }),
  cartao_checkout_id: "chk_mock_0005",
  cartao_checkout_url: "/pagamento/pub_pg-2026-0005",
  cartao_status: "CANCELADO",
  capturaAutomatica: true,
  historico: createHistory([
    {
      data: "2026-05-22T09:50:00-03:00",
      titulo: "Checkout gerado",
      descricao: "Cobrança criada dentro da proposta para pagamento em cartão.",
      tipo: "success"
    }
  ])
} satisfies Cobranca;

const cartaoAprovado = {
  ...createBaseCobranca({
    id: "cob_6",
    id_pagamento: "PG-2026-0006",
    os_ideal: "OS-E3-8840",
    proposta: snapshotE3,
    tipo_cobranca: "CREDIT_CARD",
    status: "PAID",
    valor: 6150,
    createdAt: "2026-05-17T16:00:00-03:00",
    confirmado: true,
    paidAt: "2026-05-17T16:22:00-03:00",
    descricao: "Checkout de cartão aprovado.",
    condicaoPagamento: "Cartão à vista"
  }),
  cartao_checkout_id: "chk_mock_0006",
  cartao_checkout_url: "/pagamento/pub_pg-2026-0006",
  cartao_status: "APPROVED",
  capturaAutomatica: true,
  historico: createHistory([
    {
      data: "2026-05-17T16:22:00-03:00",
      titulo: "Cartão aprovado",
      descricao: "O financeiro já pode conferir a cobrança como paga.",
      tipo: "success"
    }
  ]),
  pedidoLiberadoMock: true
} satisfies Cobranca;

const cartaoParcelado = {
  ...createBaseCobranca({
    id: "cob_7",
    id_pagamento: "PG-2026-0007",
    os_ideal: "OS-E3-8840",
    proposta: snapshotE3,
    tipo_cobranca: "CARD_PARCELADO",
    status: "A_RECEBER",
    valor: 7800,
    createdAt: "2026-05-22T10:10:00-03:00",
    confirmado: false,
    descricao: "Cartão parcelado aguardando pagamento.",
    condicaoPagamento: "3x com juros"
  }),
  cartao_parcelas: 3,
  cartao_taxa_percentual: 6.2,
  cartao_valor_taxa: 483.6,
  cartao_valor_final: 8283.6,
  cartao_checkout_id: "chk_mock_0007",
  cartao_checkout_url: "/pagamento/pub_pg-2026-0007",
  cartao_status: "CHECKOUT_GERADO",
  historico: createHistory([
    {
      data: "2026-05-22T10:10:00-03:00",
      titulo: "Parcelamento salvo",
      descricao: "Fluxo de cartão parcelado criado.",
      tipo: "info"
    }
  ])
} satisfies Cobranca;

const faturadoAprovado = {
  ...createBaseCobranca({
    id: "cob_8",
    id_pagamento: "PG-2026-0008",
    os_ideal: "OS-E3-8840",
    proposta: snapshotE3,
    tipo_cobranca: "E-FATURADO",
    status: "A_VENCER",
    valor: 14200,
    createdAt: "2026-05-16T13:00:00-03:00",
    vencimento: "2026-06-13T00:00:00-03:00",
    confirmado: true,
    descricao: "Faturado aprovado por limite disponível.",
    condicaoPagamento: "Faturado 28 dias"
  }),
  creditoAnalise: {
    limite: 35000,
    utilizado: 11000,
    disponivel: 24000,
    valorSolicitado: 14200,
    risco: "BAIXO",
    statusAnalise: "APROVADO",
    mensagem: "Crédito disponível. Faturamento liberado.",
    limiteReservado: true
  },
  historico: createHistory([
    {
      data: "2026-05-16T13:00:00-03:00",
      titulo: "Crédito reservado",
      descricao: "Pagamento criado como A_VENCER e confirmado automaticamente.",
      tipo: "success"
    }
  ]),
  propostasChat: createChat([
    {
      data: "2026-05-16T13:02:00-03:00",
      autor: "Financeiro",
      mensagem: "Crédito aprovado pelo financeiro. Proposta liberada para faturamento.",
      categoria: "FINANCEIRO"
    }
  ]),
  pedidoLiberadoMock: true
} satisfies Cobranca;

const faturadoAguardando = {
  ...createBaseCobranca({
    id: "cob_9",
    id_pagamento: "PG-2026-0009",
    os_ideal: "OS-BIRO-4472",
    proposta: snapshotBiro,
    tipo_cobranca: "E-FATURADO",
    status: "A_RECEBER",
    valor: 9800,
    createdAt: "2026-05-22T11:05:00-03:00",
    vencimento: "2026-06-20T00:00:00-03:00",
    confirmado: false,
    descricao: "Pedido de crédito aguardando análise do financeiro.",
    condicaoPagamento: "Faturado sob análise",
    creditoPendente: true
  }),
  creditoAnalise: {
    limite: 12000,
    utilizado: 10500,
    disponivel: 1500,
    valorSolicitado: 9800,
    risco: "MEDIO",
    statusAnalise: "AGUARDANDO_FINANCEIRO",
    mensagem: "Crédito insuficiente. Solicitação enviada ao financeiro."
  },
  historico: createHistory([
    {
      data: "2026-05-22T11:05:00-03:00",
      titulo: "Crédito pendente",
      descricao: "O vendedor criou a cobrança, mas o financeiro ainda precisa analisar o limite.",
      tipo: "warning"
    }
  ]),
  propostasChat: createChat([
    {
      data: "2026-05-22T11:06:00-03:00",
      autor: "Sistema",
      mensagem: "Solicitação de crédito enviada ao financeiro para análise.",
      categoria: "SISTEMA"
    }
  ])
} satisfies Cobranca;

export const pagamentosMock: Cobranca[] = [
  pixPendente,
  pixPago,
  boletoAVencer,
  boletoVencido,
  cartaoPendente,
  cartaoAprovado,
  cartaoParcelado,
  faturadoAprovado,
  faturadoAguardando
];

export function clonePagamentosMock() {
  return pagamentosMock.map((item) => ({
    ...item,
    proposta: { ...item.proposta },
    historico: item.historico.map((evento) => ({ ...evento })),
    propostasChat: item.propostasChat.map((evento) => ({ ...evento })),
    creditoAnalise: item.creditoAnalise ? { ...item.creditoAnalise } : undefined
  }));
}

export function getCobrancaById(id: string) {
  return pagamentosMock.find((cobranca) => cobranca.id === id);
}

export function getCobrancaByToken(token: string) {
  return pagamentosMock.find((cobranca) => cobranca.token_publico === token);
}

export function getCobrancasByProposta(idInt: number) {
  return pagamentosMock.filter((cobranca) => cobranca.id_int === idInt);
}

export function createCobrancaFromForm(values: CriarCobrancaFormValues, proposta: Proposta, currentCobrancas?: Cobranca[]) {
  const empresa = getEmpresaRecebedoraByProposta(proposta);

  if (!empresa) {
    throw new Error("Empresa da proposta não encontrada.");
  }

  if (!values.osIdeal.trim()) {
    throw new Error("OS Ideal é obrigatória para criar a cobrança.");
  }

  if (!isTipoDisponivelParaEmpresa(proposta.empresa, values.tipoCobranca)) {
    throw new Error(getMensagemTipoIndisponivel(proposta.empresa, values.tipoCobranca) || "Tipo de cobrança indisponível para a empresa.");
  }

  const timestamp = Date.now();
  const idPagamento = `PG-${timestamp}`;
  const token = `pub_${timestamp}`;
  const parcela = values.parcelaSelecionada;
  const roundedValor = roundMoney(values.valor);
  const roundedValorFinal = roundMoney(parcela?.valorFinal ?? values.valor);
  const roundedPropostaTotal = roundMoney(proposta.resumo.valorTotal);
  const roundedPropostaFrete = roundMoney(proposta.resumo.frete);

  const listToSearch = currentCobrancas || pagamentosMock;
  const customerCobrancas = listToSearch.filter((item) => item.id_cliente === proposta.cliente.idCliente);

  const hasOverdue = customerCobrancas.some((cob) => {
    if (!cob.vencimento || cob.status === "PAID" || cob.status === "CANCELADO") {
      return false;
    }
    const vencDate = new Date(cob.vencimento + "T23:59:59");
    return vencDate.getTime() < Date.now();
  });

  const hasCredit = proposta.cliente.creditoDisponivel >= roundedValor;
  const isScenario1 = values.tipoCobranca === "E-FATURADO" && hasCredit && !hasOverdue;
  const creditoPendente = values.tipoCobranca === "E-FATURADO";

  const cobranca: Cobranca = {
    id: `cob_${timestamp}`,
    id_pagamento: idPagamento,
    os_ideal: values.osIdeal.trim(),
    id_int: proposta.id_int,
    id_cliente: proposta.cliente.idCliente,
    valor: roundedValor,
    status: values.tipoCobranca === "E-FATURADO" ? "A_VENCER" : "A_RECEBER",
    tipo_cobranca: values.tipoCobranca,
    created_at: new Date(timestamp).toISOString(),
    paid_at: (values.tipoCobranca === "E-FATURADO" && isScenario1) ? new Date(timestamp).toISOString() : undefined,
    vencimento: values.vencimento || undefined,
    cliente: proposta.cliente.nome,
    empresa: empresa.nome,
    descricao: values.descricao || proposta.observacoes,
    documento: proposta.cliente.documento,
    atendente: proposta.vendedor,
    confirmado: false,
    confirmado_por: undefined,
    data_confirmacao: undefined,
    id_empresa: empresa.id,
    token_publico: token,
    url_cobranca: buildPublicUrl(token),
    pix_copia_cola: values.tipoCobranca === "PIX" ? createPixCode(idPagamento, roundedValor) : undefined,
    linha_digitavel: values.tipoCobranca === "BOLETO" ? createLinhaDigitavel(idPagamento, roundedValor) : undefined,
    url_pdf: values.tipoCobranca === "BOLETO" ? `/documentos/${idPagamento.toLowerCase()}.pdf` : undefined,
    cartao_checkout_id:
      values.tipoCobranca === "CREDIT_CARD" || values.tipoCobranca === "CARD_PARCELADO"
        ? `chk_${timestamp}`
        : undefined,
    cartao_checkout_url:
      values.tipoCobranca === "CREDIT_CARD" || values.tipoCobranca === "CARD_PARCELADO"
        ? buildPublicUrl(token)
        : undefined,
    cartao_status:
      values.tipoCobranca === "CARD_PARCELADO"
        ? "CHECKOUT_GERADO_COM_PARCELAS"
        : values.tipoCobranca === "CREDIT_CARD"
          ? "CHECKOUT_GERADO"
          : undefined,
    cartao_parcelas: parcela?.parcelas,
    cartao_taxa_percentual: parcela?.taxaPercentual,
    cartao_valor_taxa: parcela?.valorTaxa ? roundMoney(parcela.valorTaxa) : undefined,
    cartao_valor_final: values.tipoCobranca === "CARD_PARCELADO" ? roundedValorFinal : undefined,
    capturaAutomatica: values.tipoCobranca === "CREDIT_CARD" ? values.capturaAutomatica : undefined,
    multaPercentual: values.tipoCobranca === "BOLETO" ? values.multaPercentual : undefined,
    jurosPercentual: values.tipoCobranca === "BOLETO" ? values.jurosPercentual : undefined,
    valor_frete: roundedPropostaFrete,
    forma_fatu: values.tipoCobranca === "E-FATURADO" ? (values.modeloFatu || "BOLETO") : undefined,
    saldo_pendente: Math.max(0, roundedPropostaTotal - roundedValorFinal),
    obs_v2: values.observacao,
    condicao_pagamento: values.condicaoPagamento,
    creditoPendente,
    pedidoLiberadoMock: false,
    proposta: {
      id_int: proposta.id_int,
      statusProposta: creditoPendente ? "AGUARDANDO" : proposta.status,
      cliente: proposta.cliente.nome,
      documento: proposta.cliente.documento,
      valorTotal: roundedPropostaTotal,
      valorPendente: Math.max(0, roundedPropostaTotal - roundedValorFinal),
      empresaProposta: proposta.empresa,
      vendedor: proposta.vendedor,
      descricao: proposta.observacoes,
      valorFrete: roundedPropostaFrete
    },
    historico: createHistory([
      {
        data: new Date(timestamp).toISOString(),
        titulo: "Cobrança criada dentro da proposta",
        descricao: `${getCobrancaTipoLabel(values.tipoCobranca)} criado para a OS ${values.osIdeal.trim()} com origem na proposta ${proposta.id_int}.`,
        tipo: "success"
      }
    ]),
    propostasChat: creditoPendente
      ? createChat([
          {
            data: new Date(timestamp).toISOString(),
            autor: "Sistema",
            mensagem: isScenario1
              ? "Nova solicitação de faturamento registrada."
              : "Solicitação enviada para avaliação.",
            categoria: "SISTEMA"
          }
        ])
      : [],
    creditoAnalise:
      values.tipoCobranca === "E-FATURADO"
        ? {
            limite: proposta.cliente.limiteCredito,
            utilizado: Math.max(0, proposta.cliente.limiteCredito - proposta.cliente.creditoDisponivel),
            disponivel: proposta.cliente.creditoDisponivel,
            valorSolicitado: values.valor,
            risco: proposta.cliente.riscoCredito,
            statusAnalise: "AGUARDANDO_FINANCEIRO" as const,
            mensagem: isScenario1
              ? "Crédito disponível."
              : "Solicitação enviada para avaliação.",
            limiteReservado: isScenario1
          }
        : undefined
  };

  return cobranca;
}
