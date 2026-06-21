import type { SupabasePropostaRow } from "@/features/orcamentos/types.supabase";

export type OrcamentoListSource = "supabase";

export type OrcamentoListItem = {
  id: string;
  id_int: number;
  clienteId: string;
  clienteNome: string;
  osIdeal: string;
  documento: string;
  empresaId: number | null;
  empresaLabel: string;
  vendedor: string;
  createdAt: string;
  updatedAt: string;
  dataKey: string;
  periodoKey: string;
  status: string;
  statusLabel: string;
  statusInterno: string;
  isAvulsoRaw: boolean | null | undefined;
  total: number;
  tiposCobranca: string[];
  tipoCobrancaLabel: string;
  modelo: "AVULSO" | "PROPOSTA";
  source: OrcamentoListSource;
  rawColumns?: string[];
};

const EMPRESA_LABELS: Record<number, string> = {
  1: "Ideal Grafica",
  2: "Ideal Biro",
  3: "E3 Brindes"
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getLocalDateKey(value: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function getLocalMonthKey(value: string) {
  return getLocalDateKey(value).slice(0, 7);
}

function parseMaybeDate(value: unknown) {
  const text = toText(value);
  if (!text) {
    return "";
  }

  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : text;
}

function pickText(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = toText(row[key]);
    if (value) {
      return value;
    }
  }

  return "";
}

function pickNumber(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = toNumber(row[key]);
    if (typeof value === "number") {
      return value;
    }
  }

  return null;
}

function getEmpresaLabel(idEmpresa: number | null, empresaText = "") {
  if (idEmpresa && EMPRESA_LABELS[idEmpresa]) {
    return EMPRESA_LABELS[idEmpresa];
  }

  const normalized = normalize(empresaText);
  if (normalized.includes("ideal grafica") || normalized.includes("ingresso ideal")) {
    return "Ideal Grafica";
  }

  if (normalized.includes("ideal biro") || normalized.includes("biro grafica")) {
    return "Ideal Biro";
  }

  if (normalized.includes("e3")) {
    return "E3 Brindes";
  }

  if (idEmpresa) {
    return `Empresa ${idEmpresa}`;
  }

  return empresaText || "Empresa nao informada";
}

function normalizeStatus(status: string) {
  const raw = normalize(status);

  if (!raw) {
    return "NOVO";
  }

  if (raw.includes("cancel")) {
    return "CANCELADO";
  }

  if (raw.includes("aprov")) {
    return "APROVADO";
  }

  if (raw.includes("aguard") || raw.includes("pend")) {
    return "AGUARDANDO";
  }

  return "NOVO";
}

function getStatusLabel(status: string) {
  const normalized = normalizeStatus(status);

  if (normalized === "NOVO") return "Novo";
  if (normalized === "AGUARDANDO") return "Aguardando";
  if (normalized === "APROVADO") return "Aprovado";
  if (normalized === "CANCELADO") return "Cancelado";
  return status || "Sem status";
}



function normalizeTipoCobranca(value: unknown) {
  const raw = normalize(toText(value));

  if (!raw) {
    return "";
  }

  if (raw.includes("pix")) return "PIX";
  if (raw.includes("boleto")) return "BOLETO";
  if (raw.includes("cart")) return "CARTAO";
  if (raw.includes("fatur")) return "E-FATURADO";
  if (raw.includes("amostra")) return "E-AMOSTRAS";
  if (raw.includes("retrabalho")) return "E-RETRABALHO";
  if (raw.includes("cortesia")) return "E-CORTESIA";
  if (raw.includes("informe")) return "E-INFORME PGTO";

  return toText(value).trim().toUpperCase();
}

function collectTiposCobranca(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeTipoCobranca(item)).filter(Boolean);
  }

  const normalized = normalizeTipoCobranca(value);
  return normalized ? [normalized] : [];
}

function parseBooleanLike(value: unknown): boolean | null | undefined {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  const text = toText(value).toLowerCase();
  if (!text) {
    return undefined;
  }

  if (["true", "1", "sim", "s", "yes", "y"].includes(text)) {
    return true;
  }

  if (["false", "0", "nao", "não", "n", "no"].includes(text)) {
    return false;
  }

  return undefined;
}

function uniqueTypes(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getTipoCobrancaLabel(values: string[]) {
  const unique = uniqueTypes(values);
  return unique.length ? unique.join(" / ") : "Não gerada";
}

function mapRowToListItem(row: SupabasePropostaRow): OrcamentoListItem | null {
  const idInt = pickNumber(row, ["id_int", "id"]);
  if (typeof idInt !== "number") {
    return null;
  }

  const clienteId = pickText(row, ["id_cliente"]);
  const clienteNome = pickText(row, ["cliente", "nome_cliente", "cliente_nome", "nome"]);
  const osIdeal = pickText(row, ["os_ideal"]);
  const documento = pickText(row, ["documento", "cpf_cnpj", "cnpj", "cpf"]);
  const empresaId = pickNumber(row, ["id_empresa"]);
  const empresaText = pickText(row, ["empresa", "nome_empresa"]);
  const vendedor = pickText(row, ["atendente", "vendedor", "responsavel"]);
  const data = parseMaybeDate(row.created_at ?? row.data ?? row.data_criacao ?? row.data_proposta);
  const dataAtualizacao = parseMaybeDate(row.updated_at ?? row.data_atualizacao);
  const statusInterno = pickText(row, ["status_interno"]);
  const statusRaw = statusInterno || pickText(row, ["status"]);
  const valorTotalDb = pickNumber(row, ["valor_total"]);
  const valorDb = pickNumber(row, ["valor"]) ?? 0;
  const valorFreteDb = pickNumber(row, ["valor_frete"]) ?? 0;
  let total = (valorTotalDb !== null && valorTotalDb !== undefined) ? valorTotalDb : (valorDb + valorFreteDb);
  if (total === valorFreteDb && valorDb > 0) {
    total = valorDb + valorFreteDb;
  }
  const isAvulsoRaw = parseBooleanLike(row.is_avulso);
  const isAvulso = isAvulsoRaw === true;
  const modelo: OrcamentoListItem["modelo"] = isAvulso ? "AVULSO" : "PROPOSTA";

  const dataKey = data ? getLocalDateKey(data) : "";
  const periodoKey = data ? getLocalMonthKey(data) : "";
  const tiposCobranca = uniqueTypes([
    ...collectTiposCobranca(row.tipos_cobranca),
    ...collectTiposCobranca(row.tipo_cobranca),
    ...collectTiposCobranca(row.cobranca_status)
  ]);

  return {
    id: `prop_${idInt}`,
    id_int: idInt,
    clienteId,
    clienteNome: clienteNome || "Cliente nao informado",
    osIdeal,
    documento,
    empresaId,
    empresaLabel: getEmpresaLabel(empresaId, empresaText),
    vendedor: vendedor || "Nao informado",
    createdAt: data || "",
    updatedAt: dataAtualizacao || data || "",
    dataKey,
    periodoKey,
    status: normalizeStatus(statusRaw),
    statusLabel: getStatusLabel(statusRaw),
    statusInterno,
    isAvulsoRaw,
    total,
    tiposCobranca,
    tipoCobrancaLabel: getTipoCobrancaLabel(tiposCobranca),
    modelo,
    source: "supabase",
    rawColumns: Object.keys(row)
  };
}

export function mapSupabasePropostaRowsToListItems(rows: SupabasePropostaRow[]) {
  return rows.map(mapRowToListItem).filter((item): item is OrcamentoListItem => Boolean(item));
}



