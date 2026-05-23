import type { StatusTone } from "@/lib/types";
import type { Cobranca, CobrancaTipo, LiberacaoPedidoStatus } from "@/features/cobrancas/types";
import { getCobrancaTipoLabel } from "@/lib/mocks/pagamentos.mock";

export function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function cobrancaMatchesSearch(cobranca: Cobranca, search: string) {
  const normalizedSearch = normalize(search.trim());

  if (!normalizedSearch) {
    return true;
  }

  return normalize(
    `${cobranca.id_pagamento} ${cobranca.id_int} ${cobranca.cliente} ${cobranca.documento}`
  ).includes(normalizedSearch);
}

export function getCobrancaStatusTone(status: Cobranca["status"]): StatusTone {
  if (status === "PAID") return "success";
  if (status === "A_RECEBER") return "info";
  if (status === "A_VENCER") return "warning";
  return "neutral";
}

export function isCobrancaVencida(cobranca: Pick<Cobranca, "status" | "vencimento">) {
  if (!cobranca.vencimento || cobranca.status === "PAID" || cobranca.status === "CANCELADO") {
    return false;
  }

  return new Date(cobranca.vencimento).getTime() < Date.now();
}

export function getCobrancaStatusDescription(cobranca: Cobranca) {
  if (cobranca.status === "PAID") return "Pagamento confirmado no mock.";
  if (cobranca.status === "CANCELADO") return "Cobrança cancelada no mock.";
  if (isCobrancaVencida(cobranca)) return "Cobrança vencida sem confirmação.";
  if (cobranca.status === "A_VENCER") return "Cobrança futura aprovada.";
  return "Cobrança criada e aguardando pagamento.";
}

export function getTipoCobrancaLabel(tipo: CobrancaTipo) {
  return getCobrancaTipoLabel(tipo);
}

export function isPagamentoAprovado(cobranca: Cobranca) {
  return cobranca.status === "PAID" || (cobranca.status === "A_VENCER" && cobranca.confirmado);
}

export function isCreditoPendente(cobranca: Cobranca) {
  return cobranca.tipo_cobranca === "E-FATURADO" && Boolean(cobranca.creditoPendente || cobranca.creditoAnalise?.statusAnalise === "AGUARDANDO_FINANCEIRO");
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
