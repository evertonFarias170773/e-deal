import type { StatusTone } from "@/lib/types";
import type { Cobranca, EmpresaRecebedoraOption, LiberacaoPedidoStatus } from "@/features/cobrancas/types";

export const EMPRESAS_RECEBEDORAS_FIXAS: EmpresaRecebedoraOption[] = [
  {
    id: 1,
    nome: "IDEAL GRÁFICA EXPRESSA EIRELI",
    labelCurta: "Ideal Gráfica",
    documento: "",
    fluxoFuturo: "",
    descricao: ""
  },
  {
    id: 2,
    nome: "IDEAL BIRÔ SERV. GRAFICOS",
    labelCurta: "Ideal Birô",
    documento: "",
    fluxoFuturo: "",
    descricao: ""
  },
  {
    id: 3,
    nome: "E3 BRINDES LTDA",
    labelCurta: "E3 Brindes",
    documento: "",
    fluxoFuturo: "",
    descricao: ""
  }
];

export function getEmpresaRecebedoraFixaById(idEmpresa: number) {
  return EMPRESAS_RECEBEDORAS_FIXAS.find((item) => item.id === idEmpresa);
}

export function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toText(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function getNumeroCobranca(cobranca: Pick<Cobranca, "id_pagamento" | "id_int" | "id">) {
  return cobranca.id_pagamento || String(cobranca.id_int || cobranca.id);
}

export function getDataReferenciaCobranca(
  cobranca: Pick<Cobranca, "paid_at" | "created_at" | "data_confirmacao">
) {
  return cobranca.data_confirmacao || cobranca.paid_at || cobranca.created_at;
}

export function getDataReferenciaFaturamento(cobranca: Pick<Cobranca, "paid_at" | "data_confirmacao">) {
  return cobranca.paid_at || cobranca.data_confirmacao || "";
}

export function isPendenteAprovacao(
  cobranca: Pick<Cobranca, "tipo_cobranca" | "confirmado" | "status">
) {
  const tiposPendentes = new Set([
    "E-FATURADO",
    "E-AMOSTRAS",
    "E-RETRABALHO",
    "E-CORTESIA",
    "E-INFORME PGTO"
  ]);

  const tipoNormalizado = cobranca.tipo_cobranca.trim().toUpperCase();

  return tiposPendentes.has(tipoNormalizado) && cobranca.status === "A_VENCER" && !cobranca.confirmado;
}

function formatLocalDate(value: string | Date, options: Intl.DateTimeFormatOptions) {
  const text = typeof value === "string" ? value.trim() : "";

  if (text && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    ...options
  }).format(new Date(value));
}

export function getDataHoraListaCobranca(cobranca: Pick<Cobranca, "status" | "paid_at" | "created_at">) {
  if (cobranca.status === "PAID" && cobranca.paid_at) {
    return cobranca.paid_at;
  }

  return cobranca.created_at || cobranca.paid_at;
}

export function getConferenciaStatusLabel(cobranca: Pick<Cobranca, "status" | "confirmado">) {
  if (cobranca.confirmado) {
    return "Liberado";
  }

  if (cobranca.status === "PAID") {
    return "Pago / A liberar";
  }

  if (cobranca.status === "A_VENCER") {
    return "A vencer / A liberar";
  }

  if (cobranca.status === "A_RECEBER") {
    return "A receber";
  }

  return "A receber";
}

export function getConferenciaStatusTone(cobranca: Pick<Cobranca, "status" | "confirmado">) {
  if (cobranca.confirmado) {
    return "success";
  }

  if (cobranca.status === "PAID" || cobranca.status === "A_VENCER") {
    return "warning";
  }

  return "info";
}

export function getLocalDateKey(value: string | Date) {
  return formatLocalDate(value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

export function getLocalMonthKey(value: string | Date) {
  const text = typeof value === "string" ? value.trim() : "";

  if (text && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text.slice(0, 7);
  }

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit"
  }).format(new Date(value));
}

export function getEmpresaExibicao(cobranca: Pick<Cobranca, "empresa" | "id_empresa">) {
  const empresaId = Number(cobranca.id_empresa);

  if (empresaId === 1) {
    return "Ideal Gráfica";
  }
  if (empresaId === 2) {
    return "Ideal Birô";
  }
  if (empresaId === 3) {
    return "E3 Brindes";
  }

  const empresaTexto = normalize(toText(cobranca.empresa));

  if (empresaTexto.includes("ideal grafica") || empresaTexto.includes("ingresso ideal")) {
    return "Ideal Gráfica";
  }

  if (empresaTexto.includes("ideal biro") || empresaTexto.includes("ideal birô") || empresaTexto.includes("biro grafica")) {
    return "Ideal Birô";
  }

  if (empresaTexto.includes("e3")) {
    return "E3 Brindes";
  }

  return cobranca.empresa?.trim() || (empresaId ? `Empresa ${empresaId}` : "Empresa não informada");
}

export function getEmpresaGrupoKey(cobranca: Pick<Cobranca, "empresa" | "id_empresa">) {
  const empresaId = Number(cobranca.id_empresa);

  if (empresaId === 1) {
    return "IDEAL_GRAFICA";
  }
  if (empresaId === 2) {
    return "IDEAL_BIRO";
  }
  if (empresaId === 3) {
    return "E3_BRINDES";
  }

  const empresaTexto = normalize(toText(cobranca.empresa));

  if (empresaTexto.includes("ideal grafica") || empresaTexto.includes("ingresso ideal")) {
    return "IDEAL_GRAFICA";
  }

  if (empresaTexto.includes("ideal biro") || empresaTexto.includes("ideal birô") || empresaTexto.includes("biro grafica")) {
    return "IDEAL_BIRO";
  }

  if (empresaTexto.includes("e3")) {
    return "E3_BRINDES";
  }

  return empresaTexto || String(empresaId || "SEM_EMPRESA");
}

export function cobrancaMatchesSearch(cobranca: Cobranca, search: string) {
  const normalizedSearch = normalize(search.trim());

  if (!normalizedSearch) {
    return true;
  }

  return normalize(
    [
      cobranca.id_pagamento,
      cobranca.id_int,
      cobranca.os_ideal,
      cobranca.cliente,
      cobranca.documento,
      cobranca.empresa,
      cobranca.tipo_cobranca,
      cobranca.status,
      cobranca.token_publico,
      cobranca.url_cobranca
    ]
      .map((value) => toText(value))
      .join(" ")
  ).includes(normalizedSearch);
}

export function normalizeCobrancaStatus(params: {
  status: string;
  vencimento?: string;
  paidAt?: string;
  confirmado?: boolean;
}): Cobranca["status"] {
  const status = normalize(params.status.trim());

  if (!status) {
    return params.confirmado || Boolean(params.paidAt) ? "PAID" : "A_RECEBER";
  }

  if (status.includes("cancel")) {
    return "CANCELADO";
  }

  if (status === "paid" || status.includes("pago") || status.includes("confirm")) {
    return "PAID";
  }

  if (status === "a_vencer" || status.includes("venc")) {
    return "A_VENCER";
  }

  if (status === "a_receber" || status === "pending" || status === "pendente" || status.includes("aguard") || status.includes("process")) {
    return "A_RECEBER";
  }

  if (params.confirmado || Boolean(params.paidAt)) {
    return "PAID";
  }

  return "A_RECEBER";
}

export function getCobrancaStatusTone(status: string): StatusTone {
  if (status === "PAID" || status === "CONFIRMADO") return "success";
  if (status === "A_RECEBER" || status === "AGUARDANDO_PAGAMENTO" || status === "AGUARDANDO") return "info";
  if (status === "A_VENCER" || status === "PENDENTE" || status === "AGUARDANDO_CREDITO" || status === "PRONTA_PARA_LIBERACAO") return "warning";
  if (status === "CANCELADO") return "neutral";
  if (status === "VENCIDO" || status === "REJEITADA" || status === "ERRO" || status === "ERRO_AUTORIZACAO") return "danger";
  return "neutral";
}

export function isCobrancaVencida(cobranca: Pick<Cobranca, "status" | "vencimento">) {
  if (!cobranca.vencimento || cobranca.status === "PAID" || cobranca.status === "CANCELADO") {
    return false;
  }

  return new Date(cobranca.vencimento).getTime() < Date.now();
}

export function getCobrancaStatusDescription(cobranca: Cobranca) {
  if (cobranca.status === "PAID") return "Pagamento confirmado.";
  if (cobranca.status === "CANCELADO") return "Cobrança cancelada.";
  if (isCobrancaVencida(cobranca)) return "Cobrança vencida sem confirmação.";
  if (cobranca.status === "A_VENCER") return "Cobrança futura aprovada.";
  if (cobranca.status === "A_RECEBER") return "Cobrança aberta aguardando pagamento.";
  return "Cobrança importada e aguardando conferência.";
}

export function getTipoCobrancaLabel(tipo: string) {
  const normalized = tipo.trim().toUpperCase();

  if (!normalized) {
    return "Não informado";
  }

  if (normalized === "PIX") return "PIX";
  if (normalized === "BOLETO") return "Boleto";
  if (normalized === "CREDIT_CARD") return "Cartão de crédito";
  if (normalized === "CARD_PARCELADO") return "Cartão de crédito";
  if (normalized === "E-FATURADO") return "E-Faturado";

  return titleCase(
    normalized
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  );
}

export function isPagamentoAprovado(cobranca: Cobranca) {
  return cobranca.status === "PAID" || (cobranca.status === "A_VENCER" && cobranca.confirmado);
}

export function isCreditoPendente(cobranca: Cobranca) {
  return (
    cobranca.tipo_cobranca === "E-FATURADO" &&
    Boolean(cobranca.creditoPendente || cobranca.creditoAnalise?.statusAnalise === "AGUARDANDO_FINANCEIRO")
  );
}

export function isPropostaLiberadaParaPedido(cobrancas: Cobranca[]) {
  const validas = cobrancas.filter((item) => item.status !== "CANCELADO");

  if (!validas.length) {
    return false;
  }

  return validas.every(isPagamentoAprovado) && validas.every((item) => item.pedidoLiberadoMock);
}

export function getLiberacaoPedidoStatus(cobrancas: Cobranca[]): LiberacaoPedidoStatus {
  const validas = cobrancas.filter((item) => item.status !== "CANCELADO");

  if (!validas.length) {
    return "AGUARDANDO_PAGAMENTO";
  }

  const hasCreditoPendente = validas.some(isCreditoPendente);
  const aprovadas = validas.filter(isPagamentoAprovado);

  if (hasCreditoPendente) {
    return "AGUARDANDO_CREDITO";
  }

  if (isPropostaLiberadaParaPedido(validas)) {
    return "LIBERADA_PARA_PEDIDO";
  }

  if (validas.every(isPagamentoAprovado)) {
    return "PRONTA_PARA_LIBERACAO";
  }

  if (aprovadas.length === 0) {
    return "AGUARDANDO_PAGAMENTO";
  }

  if (aprovadas.length < validas.length) {
    return "PARCIALMENTE_APROVADA";
  }

  return "AGUARDANDO_PAGAMENTO";
}

export function canLiberarParaPedido(cobrancas: Cobranca[]) {
  const validas = cobrancas.filter((item) => item.status !== "CANCELADO");

  if (!validas.length) {
    return false;
  }

  return validas.every(isPagamentoAprovado) && !validas.some(isCreditoPendente);
}

export function getLiberacaoPedidoLabel(status: LiberacaoPedidoStatus) {
  if (status === "LIBERADA_PARA_PEDIDO") return "Liberada para pedido";
  if (status === "PRONTA_PARA_LIBERACAO") return "Pronta para liberar";
  if (status === "AGUARDANDO_CREDITO") return "Aguardando análise de crédito";
  if (status === "PARCIALMENTE_APROVADA") return "Parcialmente paga";
  return "Aguardando pagamento";
}

export function getSituacaoFinanceiraPropostaLabel(cobrancas: Cobranca[]) {
  const validas = cobrancas.filter((item) => item.status !== "CANCELADO");

  if (validas.some(isCreditoPendente)) {
    return "Aguardando análise de crédito";
  }

  if (isPropostaLiberadaParaPedido(validas) || (validas.length > 0 && validas.every(isPagamentoAprovado))) {
    return "Liberada para pedido";
  }

  if (validas.some(isPagamentoAprovado)) {
    return "Parcialmente paga";
  }

  return "Aguardando pagamento";
}

export function getLiberacaoPedidoTone(status: LiberacaoPedidoStatus): StatusTone {
  if (status === "LIBERADA_PARA_PEDIDO") return "success";
  if (status === "PRONTA_PARA_LIBERACAO") return "info";
  if (status === "AGUARDANDO_CREDITO") return "warning";
  if (status === "PARCIALMENTE_APROVADA") return "special";
  return "info";
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
