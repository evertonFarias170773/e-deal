import type { Cobranca, CobrancaHistoricoEvento } from "@/features/cobrancas/types";
import type { SupabasePagamentoV2Row } from "@/features/cobrancas/types.supabase";
import { getTipoCobrancaLabel, normalizeCobrancaStatus } from "@/features/cobrancas/cobrancas-utils";

function toText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function toNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const normalized = Number(String(value).replace(",", "."));
  return Number.isFinite(normalized) ? normalized : fallback;
}

function toBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "sim", "s", "yes", "y"].includes(normalized);
  }

  return fallback;
}

function toIsoDateTime(value: unknown) {
  const text = toText(value);
  return text || "";
}

function toIsoDate(value: unknown) {
  const text = toText(value);
  return text ? text.slice(0, 10) : "";
}

function onlyDigits(value: unknown) {
  return toText(value).replace(/\D/g, "");
}

function resolveStatus(row: SupabasePagamentoV2Row) {
  return normalizeCobrancaStatus({
    status: toText(row.status),
    vencimento: toIsoDate(row.vencimento),
    paidAt: toIsoDateTime(row.paid_at),
    confirmado: toBoolean(row.confirmado, false)
  });
}

function resolveTipoCobranca(row: SupabasePagamentoV2Row) {
  const raw = toText(row.tipo_cobranca);

  if (!raw) {
    return "NÃO INFORMADO";
  }

  const normalized = raw.toUpperCase();

  if (normalized === "PIX") return "PIX";
  if (normalized === "BOLETO") return "BOLETO";
  if (normalized === "CREDIT_CARD") return "CREDIT_CARD";
  if (normalized === "CARD_PARCELADO") return "CARD_PARCELADO";
  if (normalized === "E-FATURADO") return "E-FATURADO";

  return raw;
}

function resolveId(row: SupabasePagamentoV2Row) {
  return toText(row.id) || `pag_${toText(row.id_pagamento) || toNumber(row.id_int, 0)}`;
}

function resolveIdPagamento(row: SupabasePagamentoV2Row) {
  return toText(row.id_pagamento) || toText(row.id_int) || `PG-${toText(row.id_int) || "SEM-ID"}`;
}

function resolveOsIdeal(row: SupabasePagamentoV2Row) {
  const explicit = toText(row.os_ideal);
  if (explicit) {
    return explicit;
  }

  return resolveIdPagamento(row);
}

function resolveCliente(row: SupabasePagamentoV2Row) {
  const explicit = toText(row.cliente);
  if (explicit) {
    return explicit;
  }

  const idCliente = toNumber(row.id_cliente, 0);
  return idCliente ? `Cliente ${idCliente}` : "Cliente não informado";
}

function resolveEmpresa(row: SupabasePagamentoV2Row) {
  const explicit = toText(row.empresa);
  if (explicit) {
    return explicit;
  }

  const idEmpresa = toNumber(row.id_empresa, 0);
  return idEmpresa ? `Empresa ${idEmpresa}` : "Empresa não informada";
}

function resolveDocumento(row: SupabasePagamentoV2Row) {
  const digits = onlyDigits(row.documento);
  return digits || "-";
}

function resolveAtendente(row: SupabasePagamentoV2Row) {
  return toText(row.atendente) || "Não informado";
}

function resolveTokenPublico(row: SupabasePagamentoV2Row) {
  const explicit = toText(row.token_publico);
  if (explicit) {
    return explicit;
  }

  const fallback = toText(row.public_token);
  if (fallback) {
    return fallback;
  }

  return "";
}

function resolveUrlPublica(row: SupabasePagamentoV2Row, tokenPublico: string) {
  const explicit = toText(row.url_cobranca);
  if (explicit) {
    return explicit;
  }

  if (tokenPublico) {
    return `/pagamento/${tokenPublico}`;
  }

  return "";
}

function resolveCartaoStatus(tipoCobranca: string, status: Cobranca["status"]) {
  if (tipoCobranca === "CARD_PARCELADO") {
    return status === "PAID" ? "APPROVED" : "CHECKOUT_GERADO_COM_PARCELAS";
  }

  if (tipoCobranca === "CREDIT_CARD") {
    return status === "PAID" ? "APPROVED" : "CHECKOUT_GERADO";
  }

  return undefined;
}

function resolveHistorico(row: SupabasePagamentoV2Row, status: Cobranca["status"]) {
  const historico: CobrancaHistoricoEvento[] = [
    {
      id: `hist_${resolveId(row)}_created`,
      data: toIsoDateTime(row.created_at) || new Date().toISOString(),
      titulo: "Cobrança importada do Supabase",
      descricao: `${getTipoCobrancaLabel(resolveTipoCobranca(row))} em ${status === "PAID" ? "situação paga" : "conferência aberta"}.`,
      tipo: status === "PAID" ? ("success" as const) : ("info" as const)
    }
  ];

  const paidAt = toIsoDateTime(row.paid_at);
  if (paidAt) {
    historico.unshift({
      id: `hist_${resolveId(row)}_paid`,
      data: paidAt,
      titulo: "Pagamento confirmado",
      descricao: `Registro marcado como ${status}.`,
      tipo: "success" as const
    });
  }

  const motivoCancelamento = toText(row.motivo_cancela);
  if (motivoCancelamento) {
    historico.unshift({
      id: `hist_${resolveId(row)}_cancelled`,
      data: toIsoDateTime(row.data_confirmacao) || toIsoDateTime(row.created_at) || new Date().toISOString(),
      titulo: "Cobrança cancelada",
      descricao: motivoCancelamento,
      tipo: "danger" as const
    });
  }

  const erro = toText(row.erro_pagamento);
  if (erro) {
    historico.push({
      id: `hist_${resolveId(row)}_erro`,
      data: toIsoDateTime(row.created_at) || new Date().toISOString(),
      titulo: "Retorno/erro identificado",
      descricao: erro,
      tipo: "warning" as const
    });
  }

  return historico;
}

function resolveCreditoAnalise(row: SupabasePagamentoV2Row, status: Cobranca["status"], tipoCobranca: string) {
  if (tipoCobranca !== "E-FATURADO") {
    return undefined;
  }

  const pendente = !toBoolean(row.confirmado, false) && status !== "PAID";

  return {
    limite: 0,
    utilizado: 0,
    disponivel: 0,
    valorSolicitado: toNumber(row.valor, 0),
    risco: "MEDIO" as const,
    statusAnalise: pendente ? ("AGUARDANDO_FINANCEIRO" as const) : ("APROVADO" as const),
    mensagem: pendente ? "Crédito aguardando análise financeira." : "Crédito aprovado.",
    limiteReservado: !pendente
  };
}

function resolvePropostaSnapshot(row: SupabasePagamentoV2Row, status: Cobranca["status"]) {
  const valor = toNumber(row.valor, 0);
  const empresa = resolveEmpresa(row);
  const cliente = resolveCliente(row);
  const documento = resolveDocumento(row);
  const vendedor = resolveAtendente(row);
  const descricao = toText(row.descricao) || "Cobrança importada do Supabase.";

  return {
    id_int: toNumber(row.id_int, 0),
    statusProposta: status === "PAID" ? "APROVADO" : "AGUARDANDO",
    cliente,
    documento,
    valorTotal: valor,
    valorPendente: status === "PAID" ? 0 : valor,
    empresaProposta: empresa,
    vendedor,
    descricao,
    valorFrete: 0
  } satisfies Cobranca["proposta"];
}

export function mapSupabasePagamentoV2RowToCobranca(row: SupabasePagamentoV2Row): Cobranca | null {
  const id = resolveId(row);
  const idPagamento = resolveIdPagamento(row);
  const tipoCobranca = resolveTipoCobranca(row);
  const status = resolveStatus(row);
  const valor = toNumber(row.valor, 0);
  const tokenPublico = resolveTokenPublico(row);
  const dataConfirmacao = toIsoDate(row.data_confirmacao) || toIsoDate(row.paid_at) || undefined;

  if (!id || !idPagamento) {
    return null;
  }

  const cobranca: Cobranca = {
    id,
    id_pagamento: idPagamento,
    os_ideal: resolveOsIdeal(row),
    id_int: toNumber(row.id_int, 0),
    id_cliente: toNumber(row.id_cliente, 0),
    valor,
    status,
    tipo_cobranca: tipoCobranca as Cobranca["tipo_cobranca"],
    created_at: toIsoDateTime(row.created_at) || new Date().toISOString(),
    paid_at: toIsoDateTime(row.paid_at) || undefined,
    vencimento: toIsoDate(row.vencimento) || undefined,
    cliente: resolveCliente(row),
    empresa: resolveEmpresa(row),
    descricao: toText(row.descricao) || "Cobrança importada do Supabase.",
    documento: resolveDocumento(row),
    atendente: resolveAtendente(row),
    confirmado: toBoolean(row.confirmado, false),
    confirmado_por: toText(row.confirmado_por) || toText(row.aprovado_por) || undefined,
    data_confirmacao: dataConfirmacao,
    id_empresa: toNumber(row.id_empresa, 0),
    token_publico: tokenPublico || undefined,
    url_cobranca: resolveUrlPublica(row, tokenPublico) || undefined,
    pix_copia_cola: toText(row.pix_copia_cola) || undefined,
    linha_digitavel: toText(row.linha_digitavel) || undefined,
    url_pdf: toText(row.url_pdf) || undefined,
    erro_pagamento: toText(row.erro_pagamento) || undefined,
    cartao_parcelas: row.cartao_parcelas !== undefined && row.cartao_parcelas !== null ? toNumber(row.cartao_parcelas, 0) : undefined,
    cartao_taxa_percentual: row.cartao_taxa_percentual !== undefined && row.cartao_taxa_percentual !== null ? toNumber(row.cartao_taxa_percentual, 0) : undefined,
    cartao_valor_taxa: row.cartao_valor_taxa !== undefined && row.cartao_valor_taxa !== null ? toNumber(row.cartao_valor_taxa, 0) : undefined,
    cartao_valor_final: row.cartao_valor_final !== undefined && row.cartao_valor_final !== null ? toNumber(row.cartao_valor_final, 0) : (tipoCobranca === "CARD_PARCELADO" ? valor : undefined),
    cartao_checkout_id: row.cartao_checkout_id !== undefined && row.cartao_checkout_id !== null ? toText(row.cartao_checkout_id) : undefined,
    cartao_checkout_url: row.cartao_checkout_url !== undefined && row.cartao_checkout_url !== null && toText(row.cartao_checkout_url)
      ? toText(row.cartao_checkout_url)
      : (tokenPublico ? resolveUrlPublica(row, tokenPublico) || undefined : undefined),
    cartao_status: row.cartao_status !== undefined && row.cartao_status !== null ? toText(row.cartao_status) : resolveCartaoStatus(tipoCobranca, status),
    is_parcial: undefined,
    saldo_pendente: status === "PAID" ? 0 : valor,
    valor_frete: 0,
    forma_fatu: toText(row.forma_fatu) || undefined,
    obs_v2: toText(row.obs_v2) || undefined,
    motivo_cancela: toText(row.motivo_cancela) || undefined,
    multaPercentual: undefined,
    jurosPercentual: undefined,
    capturaAutomatica: undefined,
    condicao_pagamento: tipoCobranca ? getTipoCobrancaLabel(tipoCobranca) : undefined,
    creditoPendente: tipoCobranca === "E-FATURADO" ? !toBoolean(row.confirmado, false) && status !== "PAID" : false,
    pedidoLiberadoMock: false,
    boleto_enviadoo: toBoolean(row.boleto_enviadoo, false),
    proposta: resolvePropostaSnapshot(row, status),
    historico: resolveHistorico(row, status),
    propostasChat: [],
    creditoAnalise: resolveCreditoAnalise(row, status, tipoCobranca)
  };

  return cobranca;
}
