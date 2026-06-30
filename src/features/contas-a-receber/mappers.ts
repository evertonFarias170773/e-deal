import type { RecebimentoOperacional, RecebimentoOperacionalStatus, RecebimentoOperacionalTipo } from "@/lib/mocks/contas-receber.mock";
import type { SupabaseBoletoRow } from "./types.supabase";


const STATUS_VALIDOS = new Set<RecebimentoOperacionalStatus>(["A_VENCER", "A_RECEBER", "PAID", "CANCELADO", "VENCIDO"]);

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
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    return ["true", "1", "sim", "s", "yes", "y"].includes(value.trim().toLowerCase());
  }

  return fallback;
}

function toDigits(value: unknown) {
  return toText(value).replace(/\D/g, "");
}

function toIsoDate(value: unknown) {
  const text = toText(value);
  return text ? text.slice(0, 10) : "";
}

function toIsoDateTime(value: unknown) {
  const text = toText(value);
  return text || "";
}

function normalizeStatus(value: unknown): RecebimentoOperacionalStatus {
  let mappedStatus: RecebimentoOperacionalStatus = "A_VENCER";
  const text = toText(value).toUpperCase();

  if (STATUS_VALIDOS.has(text as RecebimentoOperacionalStatus)) {
    return text as RecebimentoOperacionalStatus;
  }

  if (text === "PAGO") return "PAID";
  if (text.includes("CANCEL")) return "CANCELADO";
  if (text.includes("RECEBER")) return "A_RECEBER";
  if (text.includes("VENCIDO")) return "VENCIDO";

  return mappedStatus;
}

function resolveTipo(row: SupabaseBoletoRow): RecebimentoOperacionalTipo {
  if (toBoolean(row.deposito_conta, false)) {
    return "DEPOSITO";
  }

  return "BOLETO";
}

function resolveId(row: SupabaseBoletoRow) {
  return toText(row.id) || `bol_${toText(row.id_int) || "sem_id"}`;
}

function resolveIdPagamento(row: SupabaseBoletoRow) {
  return toText(row.id_pagamento) || toText(row.id_int) || toText(row.n_doc_boleto) || `BOL-${toText(row.id_int) || "0000"}`;
}

function resolveOsIdeal(row: SupabaseBoletoRow) {
  return toText(row.n_nf) || toText(row.n_doc_boleto) || toText(row.ext_reference) || resolveIdPagamento(row);
}

function resolveCliente(row: SupabaseBoletoRow) {
  const explicit = toText(row.nome_cliente);
  if (explicit) return explicit;

  const idCliente = toNumber(row.id_cliente, 0);
  return idCliente ? `Cliente ${idCliente}` : "Cliente nao informado";
}

function resolveDocumento(row: SupabaseBoletoRow) {
  const digits = toDigits(row.documento);
  return digits || "-";
}

function resolveEmpresa(row: SupabaseBoletoRow) {
  const explicit = toText(row.empresa);
  if (explicit) return explicit;

  const idEmpresa = toNumber(row.id_empresa, 0);
  return idEmpresa ? `Empresa ${idEmpresa}` : "Empresa nao informada";
}

function resolveEmpresaOriginal(row: SupabaseBoletoRow) {
  return toText(row.empresa);
}

function resolveObservacao(row: SupabaseBoletoRow) {
  return toText(row.descricao) || toText(row.ext_reference);
}

function resolveConfirmado(row: SupabaseBoletoRow) {
  return normalizeStatus(row.status) === "PAID" || Boolean(toText(row.paid_at)) || Boolean(toText(row.confirmado_por));
}

function resolveVencimento(row: SupabaseBoletoRow) {
  return toIsoDate(row.vencimento);
}

function resolveValorOriginal(row: SupabaseBoletoRow) {
  return toNumber(row.valor, 0);
}

function resolveLinhaDigitavel(row: SupabaseBoletoRow) {
  return toText(row.linha_digitavel) || undefined;
}

function resolveCodigoBarras(row: SupabaseBoletoRow) {
  return toText(row.codigo_barras) || undefined;
}

function resolveUrlPdf(row: SupabaseBoletoRow) {
  return toText(row.url_pdf) || undefined;
}

function resolvePdfStorage(row: SupabaseBoletoRow) {
  return toText(row.pdf_storage) || undefined;
}

function resolveNumberOrUndefined(value: unknown) {
  const number = toNumber(value, Number.NaN);
  return Number.isFinite(number) ? number : undefined;
}

export function mapSupabaseBoletoRowToRecebimentoOperacional(row: SupabaseBoletoRow): RecebimentoOperacional {
  const tipo = resolveTipo(row);

  return {
    id: resolveId(row),
    id_pagamento: resolveIdPagamento(row),
    id_int: toNumber(row.id_int, 0),
    os_ideal: resolveOsIdeal(row) || "-",
    id_cliente: toNumber(row.id_cliente, 0),
    cliente: resolveCliente(row),
    documento: resolveDocumento(row),
    empresa: resolveEmpresa(row),
    empresa_original: resolveEmpresaOriginal(row) || undefined,
    id_empresa: toNumber(row.id_empresa, 0),
    tipo,
    status: normalizeStatus(row.status),
    valor: resolveValorOriginal(row),
    vencimento: resolveVencimento(row),
    confirmado: resolveConfirmado(row),
    paid_at: toIsoDateTime(row.paid_at) || undefined,
    created_at: toIsoDateTime(row.created_at) || undefined,
    parcela: resolveNumberOrUndefined(row.parcela),
    total_parcelas: resolveNumberOrUndefined(row.total_parcelas),
    linha_digitavel: resolveLinhaDigitavel(row),
    codigo_barras: resolveCodigoBarras(row),
    url_pdf: resolveUrlPdf(row),
    pdf_storage: resolvePdfStorage(row),
    id_boleto_c6: toText(row.id_boleto_c6) || undefined,
    nosso_numero: toText(row.nosso_numero) || undefined,
    referencia: resolveObservacao(row) || undefined,
    ext_reference: toText(row.ext_reference) || undefined,
    deposito_conta: toBoolean(row.deposito_conta, false),
    confirmado_por: toText(row.confirmado_por) || undefined,
    data_vencido: toIsoDate(row.data_vencido) || undefined,
    is_prorrogado: toBoolean(row.is_prorrogado, false),
    motivo_prorg: toText(row.motivo_prorg) || undefined,
    dias_prorg: resolveNumberOrUndefined(row.dias_prorg),
    dias_atraso: resolveNumberOrUndefined(row.dias_atraso),
    valor_atualizado: resolveNumberOrUndefined(row.valor_atualizado),
    is_avulso: toBoolean(row.is_avulso, false),
    is_faturado: toBoolean(row.is_faturado, false),
    multa: resolveNumberOrUndefined(row.multa),
    juros_dia: resolveNumberOrUndefined(row.juros_dia),
    observacao: resolveObservacao(row)
  };
}
