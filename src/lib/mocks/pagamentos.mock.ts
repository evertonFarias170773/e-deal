import type { Proposta } from "@/features/orcamentos/types";
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
import { mockCompanies } from "@/lib/mocks/empresas.mock";
import { propostasMock } from "@/lib/mocks/propostas.mock";

export const empresasRecebedorasMock: EmpresaRecebedoraOption[] = mockCompanies
  .filter((company) => !company.isConsolidated)
  .map((company) => ({
    id: company.id,
    nome: company.name,
    labelCurta: company.shortName,
    documento: company.document,
    fluxoFuturo:
      company.shortName === "Ideal"
        ? "Fluxo futuro com credencial e conta exclusiva da Ideal."
        : company.shortName === "Biro"
          ? "Fluxo futuro com regras próprias do Birô e restrições comerciais no mock."
          : "Fluxo futuro com credenciais independentes da E3.",
    descricao: `Empresa recebedora ${company.shortName} preparada para integrações financeiras próprias.`
  }));

export const tiposCobrancaMock: Array<{ id: CobrancaTipo; label: string; descricao: string }> = [
  { id: "PIX", label: "PIX", descricao: "Cria cobrança imediata com token público e PIX copia e cola mockados." },
  { id: "BOLETO", label: "Boleto", descricao: "Gera linha digitável e PDF mockado quando a empresa permitir boleto à vista." },
  { id: "CREDIT_CARD", label: "Cartão de crédito", descricao: "Cria checkout mockado para cobrança à vista no cartão." },
  { id: "CARD_PARCELADO", label: "Cartão parcelado", descricao: "Simula parcelamento e salva taxa, valor final e checkout mockado." },
  { id: "E-FATURADO", label: "Faturado", descricao: "Valida crédito do cliente e envia para análise financeira quando faltar limite." }
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

function buildSnapshot(proposta: Proposta, valorCobrado = 0): PropostaCobrancaSnapshot {
  const valorFrete = proposta.fretes.find((item) => item.id === proposta.freteEscolhidoId)?.valor ?? proposta.resumo.frete;

  return {
    id_int: proposta.id_int,
    statusProposta: proposta.status,
    cliente: proposta.cliente.nome,
    documento: proposta.cliente.documento,
    valorTotal: proposta.resumo.valorTotal,
    valorPendente: Math.max(0, proposta.resumo.valorTotal - valorCobrado),
    empresaProposta: proposta.empresa,
    vendedor: proposta.vendedor,
    descricao: proposta.observacoes,
    valorFrete
  };
}

function createPixCode(idPagamento: string, valor: number) {
  return `00020126580014BR.GOV.BCB.PIX0136mock-${idPagamento}520400005303986540${valor
    .toFixed(2)
    .replace(".", "")}5802BR5915ERP IDEAL MOCK6009BLUMENAU62070503***6304MOCK`;
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

export function getEmpresaRecebedoraByProposta(proposta: Pick<Proposta, "empresa">) {
  return getEmpresaRecebedoraByNome(proposta.empresa);
}

export function isTipoDisponivelParaEmpresa(empresaNome: string, tipo: CobrancaTipo) {
  return tipoDisponibilidadePorEmpresa[empresaNome]?.[tipo] ?? false;
}

export function getMensagemTipoIndisponivel(empresaNome: string, tipo: CobrancaTipo) {
  if (empresaNome === "Ideal Biro" && tipo === "BOLETO") {
    return "Boleto à vista não está disponível no mock para Birô.";
  }

  if (empresaNome === "Ideal Biro" && (tipo === "CREDIT_CARD" || tipo === "CARD_PARCELADO")) {
    return "Cartão não está disponível no mock para Birô.";
  }

  return "";
}

export function getEligiblePropostasForCobranca() {
  return propostasMock.filter((proposta) => proposta.status === "APROVADO" || proposta.status === "AGUARDANDO");
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

function buildInitialFormValues(): CriarCobrancaFormValues {
  const proposta = getEligiblePropostasForCobranca()[0];

  return {
    propostaIdInt: proposta?.id_int ?? null,
    osIdeal: "",
    tipoCobranca: "PIX",
    valor: proposta?.resumo.valorTotal ?? 0,
    vencimento: "2026-05-30",
    observacao: proposta?.observacoes ?? "",
    descricao: proposta?.observacoes ?? "Cobrança mockada vinculada à proposta.",
    condicaoPagamento: "À vista",
    expiracaoPix: "2026-05-30T18:00",
    multaPercentual: 2,
    jurosPercentual: 1,
    capturaAutomatica: true,
    parcelaSelecionada: undefined
  };
}

export const criarCobrancaInitialValues = buildInitialFormValues();

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
  proposta: Proposta;
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
  const empresa = getEmpresaRecebedoraByProposta(proposta);
  const token = `pub_${id_pagamento.toLowerCase()}`;

  if (!empresa) {
    throw new Error(`Empresa recebedora mockada não encontrada para a proposta: ${proposta.empresa}`);
  }

  return {
    id,
    id_pagamento,
    os_ideal,
    id_int: proposta.id_int,
    id_cliente: proposta.cliente.idCliente,
    valor,
    status,
    tipo_cobranca,
    created_at: createdAt,
    paid_at: paidAt,
    vencimento,
    cliente: proposta.cliente.nome,
    empresa: empresa.nome,
    descricao,
    documento: proposta.cliente.documento,
    atendente: proposta.vendedor,
    confirmado,
    confirmado_por: confirmado ? "Financeiro mockado" : undefined,
    data_confirmacao: confirmado ? paidAt ?? createdAt : undefined,
    id_empresa: empresa.id,
    token_publico: token,
    url_cobranca: buildPublicUrl(token),
    saldo_pendente: Math.max(0, proposta.resumo.valorTotal - valor),
    valor_frete: proposta.resumo.frete,
    condicao_pagamento: condicaoPagamento,
    creditoPendente,
    pedidoLiberadoMock,
    proposta: buildSnapshot(proposta, valor),
    historico: [],
    propostasChat: []
  };
}

const propostaIdeal = propostasMock[0];
const propostaBiro = propostasMock[1];
const propostaE3 = propostasMock[2];

const pixPendente = {
  ...createBaseCobranca({
    id: "cob_1",
    id_pagamento: "PG-2026-0001",
    os_ideal: "OS-IDEAL-2101",
    proposta: propostaIdeal,
    tipo_cobranca: "PIX",
    status: "A_RECEBER",
    valor: 1030.9,
    createdAt: "2026-05-21T10:20:00-03:00",
    vencimento: "2026-05-24T18:00:00-03:00",
    confirmado: false,
    descricao: "PIX mockado gerado na proposta pelo vendedor.",
    condicaoPagamento: "PIX à vista"
  }),
  pix_copia_cola: createPixCode("PG-2026-0001", 1030.9),
  historico: createHistory([
    {
      data: "2026-05-21T10:20:00-03:00",
      titulo: "Cobrança criada dentro da proposta",
      descricao: "Vendedor gerou PIX mockado a partir da área Criar e ver cobranças.",
      tipo: "success"
    }
  ])
} satisfies Cobranca;

const pixPago = {
  ...createBaseCobranca({
    id: "cob_2",
    id_pagamento: "PG-2026-0002",
    os_ideal: "OS-IDEAL-2101",
    proposta: propostaIdeal,
    tipo_cobranca: "PIX",
    status: "PAID",
    valor: 700,
    createdAt: "2026-05-18T08:30:00-03:00",
    vencimento: "2026-05-19T23:59:00-03:00",
    confirmado: true,
    paidAt: "2026-05-18T09:12:00-03:00",
    descricao: "Entrada PIX confirmada no mock.",
    condicaoPagamento: "Entrada PIX"
  }),
  pix_copia_cola: createPixCode("PG-2026-0002", 700),
  historico: createHistory([
    {
      data: "2026-05-18T08:30:00-03:00",
      titulo: "PIX gerado na proposta",
      descricao: "Cobrança criada como entrada financeira.",
      tipo: "success"
    },
    {
      data: "2026-05-18T09:12:00-03:00",
      titulo: "Pagamento confirmado",
      descricao: "Webhook futuro mudará esse status para pago. No mock a confirmação é manual.",
      tipo: "success"
    }
  ])
} satisfies Cobranca;

const boletoAVencer = {
  ...createBaseCobranca({
    id: "cob_3",
    id_pagamento: "PG-2026-0003",
    os_ideal: "OS-E3-8840",
    proposta: propostaE3,
    tipo_cobranca: "BOLETO",
    status: "A_RECEBER",
    valor: 5860,
    createdAt: "2026-05-20T14:10:00-03:00",
    vencimento: "2026-06-03T00:00:00-03:00",
    confirmado: false,
    descricao: "Boleto à vista mockado para conferência financeira.",
    condicaoPagamento: "Boleto 14 dias"
  }),
  linha_digitavel: createLinhaDigitavel("PG-2026-0003", 5860),
  url_pdf: "/documentos/mock-boleto-pg-2026-0003.pdf",
  multaPercentual: 2,
  jurosPercentual: 1,
  historico: createHistory([
    {
      data: "2026-05-20T14:10:00-03:00",
      titulo: "Boleto emitido no mock",
      descricao: "Linha digitável e PDF fictício foram gerados para a proposta.",
      tipo: "success"
    }
  ])
} satisfies Cobranca;

const boletoVencido = {
  ...createBaseCobranca({
    id: "cob_4",
    id_pagamento: "PG-2026-0004",
    os_ideal: "OS-IDEAL-2088",
    proposta: propostaIdeal,
    tipo_cobranca: "BOLETO",
    status: "CANCELADO",
    valor: 2210,
    createdAt: "2026-04-28T11:00:00-03:00",
    vencimento: "2026-05-05T00:00:00-03:00",
    confirmado: false,
    descricao: "Boleto mockado cancelado para manter o saldo da proposta coerente.",
    condicaoPagamento: "Boleto à vista"
  }),
  linha_digitavel: createLinhaDigitavel("PG-2026-0004", 2210),
  url_pdf: "/documentos/mock-boleto-pg-2026-0004.pdf",
  erro_pagamento: "Boleto vencido sem pagamento confirmado no mock.",
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
    proposta: propostaIdeal,
    tipo_cobranca: "CREDIT_CARD",
    status: "CANCELADO",
    valor: 3990,
    createdAt: "2026-05-22T09:50:00-03:00",
    confirmado: false,
    descricao: "Checkout de cartão cancelado no mock para manter o saldo inicial da proposta coerente.",
    condicaoPagamento: "Cartão à vista"
  }),
  cartao_checkout_id: "chk_mock_0005",
  cartao_checkout_url: "/pagamento/pub_pg-2026-0005",
  cartao_status: "CHECKOUT_GERADO",
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
    proposta: propostaE3,
    tipo_cobranca: "CREDIT_CARD",
    status: "PAID",
    valor: 6150,
    createdAt: "2026-05-17T16:00:00-03:00",
    confirmado: true,
    paidAt: "2026-05-17T16:22:00-03:00",
    descricao: "Checkout de cartão aprovado no mock.",
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
    proposta: propostaE3,
    tipo_cobranca: "CARD_PARCELADO",
    status: "A_RECEBER",
    valor: 7800,
    createdAt: "2026-05-22T10:10:00-03:00",
    confirmado: false,
    descricao: "Cartão parcelado mockado aguardando pagamento.",
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
      descricao: "Fluxo de cartão parcelado criado, mas o status financeiro continua A_RECEBER.",
      tipo: "info"
    }
  ])
} satisfies Cobranca;

const faturadoAprovado = {
  ...createBaseCobranca({
    id: "cob_8",
    id_pagamento: "PG-2026-0008",
    os_ideal: "OS-E3-8840",
    proposta: propostaE3,
    tipo_cobranca: "E-FATURADO",
    status: "A_VENCER",
    valor: 14200,
    createdAt: "2026-05-16T13:00:00-03:00",
    vencimento: "2026-06-13T00:00:00-03:00",
    confirmado: true,
    descricao: "Faturado mockado aprovado por limite disponível.",
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
    proposta: propostaBiro,
    tipo_cobranca: "E-FATURADO",
    status: "A_RECEBER",
    valor: 9800,
    createdAt: "2026-05-22T11:05:00-03:00",
    vencimento: "2026-06-20T00:00:00-03:00",
    confirmado: false,
    descricao: "Pedido de crédito mockado aguardando análise do financeiro.",
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

export function createCobrancaFromForm(values: CriarCobrancaFormValues) {
  const proposta = propostasMock.find((item) => item.id_int === values.propostaIdInt);

  if (!proposta) {
    throw new Error("Proposta mockada não encontrada para criar a cobrança.");
  }

  const empresa = getEmpresaRecebedoraByProposta(proposta);

  if (!empresa) {
    throw new Error("Empresa da proposta não encontrada no mock.");
  }

  if (!values.osIdeal.trim()) {
    throw new Error("OS Ideal é obrigatória para criar a cobrança.");
  }

  if (!isTipoDisponivelParaEmpresa(proposta.empresa, values.tipoCobranca)) {
    throw new Error(getMensagemTipoIndisponivel(proposta.empresa, values.tipoCobranca) || "Tipo de cobrança indisponível para a empresa.");
  }

  const timestamp = Date.now();
  const idPagamento = `PG-MOCK-${timestamp}`;
  const token = `pub_${timestamp}`;
  const parcela = values.parcelaSelecionada;
  const valorFinal = parcela?.valorFinal ?? values.valor;
  const creditoAprovado = values.tipoCobranca === "E-FATURADO" && proposta.cliente.creditoDisponivel >= values.valor;
  const creditoPendente = values.tipoCobranca === "E-FATURADO" && !creditoAprovado;

  const cobranca: Cobranca = {
    id: `cob_${timestamp}`,
    id_pagamento: idPagamento,
    os_ideal: values.osIdeal.trim(),
    id_int: proposta.id_int,
    id_cliente: proposta.cliente.idCliente,
    valor: values.valor,
    status: values.tipoCobranca === "E-FATURADO" && creditoAprovado ? "A_VENCER" : "A_RECEBER",
    tipo_cobranca: values.tipoCobranca,
    created_at: new Date(timestamp).toISOString(),
    vencimento: values.vencimento || undefined,
    cliente: proposta.cliente.nome,
    empresa: empresa.nome,
    descricao: values.descricao || proposta.observacoes,
    documento: proposta.cliente.documento,
    atendente: proposta.vendedor,
    confirmado: creditoAprovado,
    confirmado_por: creditoAprovado ? "Financeiro mockado" : undefined,
    data_confirmacao: creditoAprovado ? new Date(timestamp).toISOString() : undefined,
    id_empresa: empresa.id,
    token_publico: token,
    url_cobranca: buildPublicUrl(token),
    pix_copia_cola: values.tipoCobranca === "PIX" ? createPixCode(idPagamento, values.valor) : undefined,
    linha_digitavel: values.tipoCobranca === "BOLETO" ? createLinhaDigitavel(idPagamento, values.valor) : undefined,
    url_pdf: values.tipoCobranca === "BOLETO" ? `/documentos/mock-${idPagamento.toLowerCase()}.pdf` : undefined,
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
    cartao_valor_taxa: parcela?.valorTaxa,
    cartao_valor_final: values.tipoCobranca === "CARD_PARCELADO" ? valorFinal : undefined,
    capturaAutomatica: values.tipoCobranca === "CREDIT_CARD" ? values.capturaAutomatica : undefined,
    multaPercentual: values.tipoCobranca === "BOLETO" ? values.multaPercentual : undefined,
    jurosPercentual: values.tipoCobranca === "BOLETO" ? values.jurosPercentual : undefined,
    valor_frete: proposta.resumo.frete,
    saldo_pendente: Math.max(0, proposta.resumo.valorTotal - valorFinal),
    obs_v2: values.observacao,
    condicao_pagamento: values.condicaoPagamento,
    creditoPendente,
    pedidoLiberadoMock: false,
    proposta: {
      id_int: proposta.id_int,
      statusProposta: creditoPendente ? "AGUARDANDO" : proposta.status,
      cliente: proposta.cliente.nome,
      documento: proposta.cliente.documento,
      valorTotal: proposta.resumo.valorTotal,
      valorPendente: Math.max(0, proposta.resumo.valorTotal - valorFinal),
      empresaProposta: proposta.empresa,
      vendedor: proposta.vendedor,
      descricao: proposta.observacoes,
      valorFrete: proposta.resumo.frete
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
            mensagem: "Solicitação de crédito enviada ao financeiro para análise.",
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
            statusAnalise: creditoAprovado ? "APROVADO" : "AGUARDANDO_FINANCEIRO",
            mensagem: creditoAprovado
              ? "Crédito disponível. Faturamento liberado."
              : "Crédito insuficiente. Solicitação enviada ao financeiro.",
            limiteReservado: creditoAprovado
          }
        : undefined
  };

  return cobranca;
}
