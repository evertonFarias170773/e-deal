import type { Produto, ProdutoFoto, ProdutoVariacaoDetalhada } from "@/features/produtos/types";
import type { SupabaseProdutoFotoRow, SupabaseProdutoRow, SupabaseProdutoVariacaoRow } from "@/features/produtos/types.supabase";

export type ProdutosReadSource = "supabase";

export type ProdutosResumo = {
  ativos: number;
  comVariacoes: number;
  estoque: number;
  comFotos: number;
};

export type ProdutosReadResult = {
  source: ProdutosReadSource;
  produtos: Produto[];
  resumo: ProdutosResumo;
  categorias: string[];
  warnings: string[];
  error?: string | null;
};

export function sortProdutosByIdAsc(produtos: Produto[]) {
  return [...produtos].sort((a, b) => a.id_produto - b.id_produto);
}

function toText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function parseDecimalInput(value: string): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const cleaned = trimmed
    .replace(/\s/g, "")
    .replace(/R\$/gi, "");

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized = cleaned;

  if (hasComma && hasDot) {
    // padrão brasileiro: 1.234,56
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    // exemplo: 0,16
    normalized = cleaned.replace(",", ".");
  } else {
    // exemplo: 0.16 ou 40
    normalized = cleaned;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    return parseDecimalInput(value);
  }

  return null;
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

function pickBoolean(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = parseBooleanLike(row[key]);
    if (typeof value === "boolean") {
      return value;
    }
  }

  return null;
}

function parseApelidos(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => toText(item)).filter(Boolean);
  }

  const text = toText(value);
  if (!text) {
    return [];
  }

  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function mapSupabaseProdutoFotoRowToFoto(row: SupabaseProdutoFotoRow): ProdutoFoto | null {
  const raw = row as Record<string, unknown>;
  const idProduto = pickNumber(raw, ["idProduto"]);
  const imagensURL = pickText(raw, ["imagensURL"]);

  if (typeof idProduto !== "number" || !imagensURL) {
    return null;
  }

  const id = pickNumber(raw, ["id"]) ?? `${idProduto}_${imagensURL}`;

  return {
    id: `foto_${id}`,
    idProduto,
    nomeProduto: pickText(raw, ["nomeProduto"]) || `Produto ${idProduto}`,
    imagensURL,
    principal: false
  };
}

export function mapSupabaseProdutoVariacaoRowToVariacao(row: SupabaseProdutoVariacaoRow): ProdutoVariacaoDetalhada | null {
  const raw = row as Record<string, unknown>;
  const idProduto = pickNumber(raw, ["id_produto"]);
  const idVariacao = pickNumber(raw, ["id_variacao"]);

  if (typeof idProduto !== "number" || typeof idVariacao !== "number") {
    return null;
  }

  const id = pickNumber(raw, ["id"]) ?? `${idProduto}_${idVariacao}`;
  const nome = pickText(raw, ["nome"]) || `Variação ${idVariacao}`;

  return {
    id: `pv_${id}`,
    id_produto: idProduto,
    id_variacao: idVariacao,
    is_obrigatorio: pickBoolean(raw, ["is_obrigatorio"]) ?? false,
    is_multiplo: pickBoolean(raw, ["is_multiplo"]) ?? false,
    variacao: {
      id_variacao: idVariacao,
      nome,
      descricao: "Variação vinculada ao produto no Supabase.",
      is_ativo: true
    },
    tipos: []
  };
}

export function mapSupabaseProdutoRowToProduto(
  row: SupabaseProdutoRow,
  relations: {
    fotos?: ProdutoFoto[];
    variacoes?: ProdutoVariacaoDetalhada[];
  } = {}
): Produto | null {
  const idProduto = pickNumber(row as Record<string, unknown>, ["id_produto"]);
  if (typeof idProduto !== "number") {
    return null;
  }

  const raw = row as Record<string, unknown>;
  const apelidos = parseApelidos(raw.apelidos);
  const fotos = relations.fotos ?? [];
  const variacoes = relations.variacoes ?? [];
  const id = pickNumber(raw, ["id"]);

  return {
    id: `prod_${id ?? idProduto}`,
    created_at: pickText(raw, ["created_at"]) || null,
    id_produto: idProduto,
    nomeReal: pickText(raw, ["nomeReal"]) || `Produto ${idProduto}`,
    categoria: pickText(raw, ["categoria"]) || "Sem categoria",
    formato: pickText(raw, ["formato"]),
    valorUnt: pickNumber(raw, ["valorUnt"]) ?? 0,
    valorFixo: pickNumber(raw, ["valorFixo"]) ?? 0,
    valor_custo: pickNumber(raw, ["valor_custo"]) ?? 0,
    peso: pickNumber(raw, ["peso"]) ?? 0,
    prazo: pickText(raw, ["prazo"]),
    nivelSeg: pickText(raw, ["nivelSeg"]) || "Não informado",
    fraseCons: pickText(raw, ["fraseCons"]),
    descricao: pickText(raw, ["descricao"]),
    personalizacao: pickText(raw, ["personalizacao"]),
    apelidos,
    ativo: pickBoolean(raw, ["ativo"]) ?? false,
    is_estoque: pickBoolean(raw, ["is_estoque"]) ?? false,
    is_variacao: pickBoolean(raw, ["is_variacao"]) ?? variacoes.length > 0,
    is_multiplo: pickBoolean(raw, ["is_multiplo"]) ?? false,
    cod_beneficio: pickText(raw, ["cod_beneficio"]),
    ncm: pickText(raw, ["ncm"]),
    descri_ncm: pickText(raw, ["descri_ncm"]),
    cest: pickText(raw, ["cest"]),
    origem: pickText(raw, ["origem"]),
    cod_origem: pickNumber(raw, ["cod_origem"]),
    cod_bar: pickText(raw, ["cod_bar"]),
    und_medida: pickText(raw, ["und_medida"]),
    cfop_interno: pickText(raw, ["cfop_interno"]),
    cfop_interestadual: pickText(raw, ["cfop_interestadual"]),
    unidade_comercial: pickText(raw, ["unidade_comercial"]),
    unidade_tributavel: pickText(raw, ["unidade_tributavel"]),
    icms_origem: pickText(raw, ["icms_origem"]),
    icms_situacao_tributaria: pickText(raw, ["icms_situacao_tributaria"]),
    pis_situacao_tributaria: pickText(raw, ["pis_situacao_tributaria"]),
    cofins_situacao_tributaria: pickText(raw, ["cofins_situacao_tributaria"]),
    informacoes_fiscais: pickText(raw, ["informacoes_fiscais"]),
    id_formato: pickNumber(raw, ["id_formato"]),
    id_modelo_cor: pickNumber(raw, ["id_modelo_cor"]),
    quantidade_minima_venda: pickNumber(raw, ["quantidade_minima_venda"]),
    tipo_blocagem: pickText(raw, ["tipo_blocagem"]) || null,
    fotos,
    variacoes
  };
}

export function mapSupabaseProdutoRowsToProdutos(
  rows: SupabaseProdutoRow[],
  relationsByIdProduto: Map<number, { fotos: ProdutoFoto[]; variacoes: ProdutoVariacaoDetalhada[] }> = new Map()
) {
  return sortProdutosByIdAsc(
    rows
      .map((row) => {
        const idProduto = pickNumber(row as Record<string, unknown>, ["id_produto"]);
        const relations = typeof idProduto === "number" ? relationsByIdProduto.get(idProduto) : undefined;
        return mapSupabaseProdutoRowToProduto(row, relations);
      })
      .filter((item): item is Produto => Boolean(item))
  );
}
