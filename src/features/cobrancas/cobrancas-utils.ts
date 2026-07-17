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

/**
 * Converte o campo textual `propostas.empresa` no id numérico usado em
 * `pagamentos_v2.id_empresa` e `propostas_pendencias.id_empresa`.
 *
 * Segue a mesma lógica de resolução já usada em:
 *   - getEmpresaGrupoKey()
 *   - getEmpresaExibicao()
 *   - orcamentos/mappers.ts → getEmpresaLabel()
 *
 * Retorna `null` se não for possível determinar com segurança.
 */
export function resolveEmpresaIdFromTexto(empresaRaw: string | null | undefined): number | null {
  if (!empresaRaw) return null;

  const texto = normalize(empresaRaw.trim());

  // 1. Valor numérico puro (ex: "1", "2", "3")
  const parsed = Number(empresaRaw.trim());
  if (!isNaN(parsed) && parsed > 0 && Number.isInteger(parsed)) {
    // Só aceita se for uma empresa conhecida ou plausível
    if (EMPRESAS_RECEBEDORAS_FIXAS.some(e => e.id === parsed)) {
      return parsed;
    }
    return parsed; // empresa futura — aceitar valor inteiro positivo
  }

  // 2. Match por texto normalizado (mesma lógica de getEmpresaGrupoKey)
  if (texto.includes("ideal grafica") || texto.includes("ingresso ideal")) {
    return 1;
  }
  if (texto.includes("ideal biro") || texto.includes("biro grafica")) {
    return 2;
  }
  if (texto.includes("e3")) {
    return 3;
  }

  return null;
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
  cobranca: Pick<
    Cobranca,
    | "tipo_cobranca"
    | "confirmado"
    | "status"
    | "cliente_restricao"
    | "cliente_limite_credito"
    | "cliente_credito"
    | "valor"
    | "confirmado_por"
  >
) {
  const tipoNormalizado = (cobranca.tipo_cobranca || "").trim().toUpperCase().replace(/_/g, "-");
  const isEFaturado = tipoNormalizado.startsWith("E-") || tipoNormalizado === "EFATURADO" || tipoNormalizado === "FATURADO";
  const statusUpper = (cobranca.status || "").trim().toUpperCase();

  if (!isEFaturado) return false;
  if (cobranca.confirmado === true) return false;
  if (statusUpper === "CANCELADO" || statusUpper === "PAID") return false;

  // Se for A_VENCER, verificamos se foi explicitamente autorizado/liberado (manual ou via limite)
  if (statusUpper === "A_VENCER") {
    const isManuallyAuthorized = Boolean(cobranca.confirmado_por);

    if (isManuallyAuthorized) {
      return false; // Autorizado (automaticamente ou manualmente) -> NÃO é pendente financeiro
    }
  }

  return true; // Todos os outros casos (como A_RECEBER, ou A_VENCER sem autorização explícita) são pendentes
}



export function getDataHoraListaCobranca(cobranca: Pick<Cobranca, "status" | "paid_at" | "created_at">) {
  if (cobranca.status === "PAID" && cobranca.paid_at) {
    return cobranca.paid_at;
  }

  return cobranca.created_at || cobranca.paid_at;
}

export function getConferenciaStatusLabel(
  cobranca: Pick<Cobranca, "status" | "confirmado" | "tipo_cobranca" | "cliente_restricao" | "cliente_limite_credito" | "cliente_credito" | "valor">
) {
  const statusUpper = (cobranca.status || "").trim().toUpperCase();

  if (statusUpper === "CANCELADO") {
    return "Cancelado";
  }

  if (isPendenteAprovacao(cobranca)) {
    return "Aguardando financeiro";
  }

  // Regra definitiva: status PAID/A_VENCER indica condição financeira. confirmado=false indica aguardando conferência humana. confirmado=true indica liberado para produção.
  if ((statusUpper === "PAID" || statusUpper === "A_VENCER") && cobranca.confirmado) {
    return "Liberado";
  }

  if (statusUpper === "PAID" && !cobranca.confirmado) {
    return "Pago / A liberar";
  }

  if (statusUpper === "A_VENCER" && !cobranca.confirmado) {
    return "Faturamento autorizado / A liberar";
  }

  if (statusUpper === "A_RECEBER") {
    return "A receber";
  }

  return "A receber";
}

export function getConferenciaStatusTone(
  cobranca: Pick<Cobranca, "status" | "confirmado" | "tipo_cobranca" | "cliente_restricao" | "cliente_limite_credito" | "cliente_credito" | "valor">
) {
  const statusUpper = (cobranca.status || "").trim().toUpperCase();

  if (statusUpper === "CANCELADO") {
    return "neutral";
  }

  if (isPendenteAprovacao(cobranca)) {
    return "warning";
  }

  if ((statusUpper === "PAID" || statusUpper === "A_VENCER") && cobranca.confirmado) {
    return "success";
  }

  if (statusUpper === "PAID" && !cobranca.confirmado) {
    return "info";
  }

  if (statusUpper === "A_VENCER" && !cobranca.confirmado) {
    return "info";
  }

  return "info";
}

export function getLocalDateKey(value: string | Date) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text && text.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }

  const dateObj = typeof value === "string" ? new Date(value) : value;
  if (dateObj instanceof Date && !isNaN(dateObj.getTime())) {
    return dateObj.toISOString().slice(0, 10);
  }

  return "";
}

export function getLocalMonthKey(value: string | Date) {
  const dateKey = getLocalDateKey(value);
  return dateKey ? dateKey.slice(0, 7) : "";
}

export function getEmpresaExibicao(cobranca: Pick<Cobranca, "empresa" | "id_empresa">) {
  const empresaId = Number(cobranca.id_empresa);
  const empresaTextoRaw = cobranca.empresa?.trim() || "";

  if (empresaTextoRaw === "Definir empresa" || empresaTextoRaw === "1" || !empresaTextoRaw) {
    if (empresaId === 1) return "IDEAL GRÁFICA EXPRESSA EIRELI";
    if (empresaId === 2) return "IDEAL BIRÔ SERV. GRAFICOS";
    if (empresaId === 3) return "E3 BRINDES LTDA";
  }

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

export function getLocalDateInSaoPaulo(value: string | Date | null | undefined): string {
  if (!value) return "";
  try {
    const dateObj = typeof value === "string" ? new Date(value) : value;
    if (dateObj instanceof Date && !isNaN(dateObj.getTime())) {
      return dateObj.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    }
  } catch (e) {
    console.error("Erro ao converter data para fuso SP:", e);
  }
  return "";
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
      cobranca.id_cliente,
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
  if (normalized === "E-RETRABALHO") return "E-Retrabalho";
  if (normalized === "E-PERMUTA") return "E-Permuta";
  if (normalized === "E-AMOSTRA" || normalized === "E-AMOSTRAS") return "E-Amostra";
  if (normalized === "E-CREDITO") return "E-Crédito";

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

/**
 * Retorna true se a cobrança é do tipo E-CREDITO (uso de crédito do cliente como pagamento).
 *
 * Regra de faturamento:
 * - E-CREDITO como PAGAMENTO → ENTRA no faturamento (compõe a receita da venda)
 * - Geração de crédito → vai APENAS para movimento_credito, nunca para pagamentos_v2
 *
 * A função é usada para garantir que o E-CREDITO:
 *   1. Apareça apenas quando o cliente tiver saldo disponível
 *   2. Seja contabilizado corretamente no faturamento (sem dupla contagem)
 */
export function isCobrancaECredito(cobranca: Pick<Cobranca, "tipo_cobranca">): boolean {
  return (cobranca.tipo_cobranca || "").trim().toUpperCase() === "E-CREDITO";
}

/**
 * Calcula o valor efetivamente pago e confirmado em uma lista de cobranças.
 * Utiliza o critério oficial de isPagamentoAprovado.
 * Ignora cobranças canceladas.
 */
export function calcularValorPagoConfirmado(cobrancas: Cobranca[]): number {
  return cobrancas
    .filter((c) => c.status !== "CANCELADO" && isPagamentoAprovado(c))
    .reduce((sum, c) => sum + (Number(c.valor) || 0), 0);
}

/**
 * Calcula a diferença financeira entre o novo total e o valor já pago.
 * Retorna:
 *   < 0  → crédito para o cliente (proposta ficou mais barata)
 *   > 0  → débito (proposta ficou mais cara)
 *   = 0  → sem diferença financeira
 */
export function calcularDiferencaFinanceira(
  novoTotal: number,
  valorPagoConfirmado: number
): number {
  return Math.round((novoTotal - valorPagoConfirmado) * 100) / 100;
}

export function isCreditoPendente(cobranca: Cobranca) {
  const tipoUpper = (cobranca.tipo_cobranca || "").trim().toUpperCase();
  return (
    tipoUpper.startsWith("E-") &&
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
