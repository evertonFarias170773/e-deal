import { getProdutoById, produtosMock } from "@/lib/mocks/produtos.mock";
import type { Produto, ProdutoCategoria, ProdutoNivelSeguranca, ProdutoFoto, ProdutoVariacaoDetalhada } from "@/features/produtos/types";
import type { SupabaseProdutoRow } from "@/features/produtos/types.supabase";

export type ProdutosReadSource = "supabase" | "mock";

export type ProdutosReadResult = {
  source: ProdutosReadSource;
  produtos: Produto[];
  warnings: string[];
};

export function sortProdutosByIdAsc(produtos: Produto[]) {
  return [...produtos].sort((a, b) => a.id_produto - b.id_produto);
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
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

function parseMaybeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
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

function normalizeCategoria(value: string): ProdutoCategoria | null {
  const text = normalize(value);
  if (!text) {
    return null;
  }

  if (text.includes("pulseir")) return "Pulseiras";
  if (text.includes("ingress")) return "Ingressos";
  if (text.includes("cart") || text.includes("pvc")) return "Cartoes";
  if (text.includes("credenc") || text.includes("badge") || text.includes("cracha")) return "Credenciais";

  return null;
}

function normalizeNivelSeguranca(value: string): ProdutoNivelSeguranca | null {
  const text = normalize(value);
  if (!text) {
    return null;
  }

  if (text.includes("baixo")) return "baixo";
  if (text.includes("antifraud")) return "antifraude";
  if (text.includes("control") || text.includes("visual")) return "controle visual";
  if (text.includes("alto")) return "alto";
  if (text.includes("medio") || text.includes("médio")) return "medio";

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

function mapFotoArray(value: unknown, fallback: ProdutoFoto[]) {
  const array = parseMaybeArray(value);
  if (!array.length) {
    return fallback;
  }

  return array as ProdutoFoto[];
}

function mapVariacaoArray(value: unknown, fallback: ProdutoVariacaoDetalhada[]) {
  const array = parseMaybeArray(value);
  if (!array.length) {
    return fallback;
  }

  return array as ProdutoVariacaoDetalhada[];
}

export function cloneMockProdutos() {
  return sortProdutosByIdAsc(produtosMock.map((produto) => ({
    ...produto,
    fotos: [...produto.fotos],
    variacoes: [...produto.variacoes]
  })));
}

export function mapSupabaseProdutoRowToProduto(row: SupabaseProdutoRow): Produto | null {
  const idProduto = pickNumber(row as Record<string, unknown>, ["id_produto", "id", "codigo_produto", "codigo"]);
  if (typeof idProduto !== "number") {
    return null;
  }

  const fallback = getProdutoById(idProduto) ?? null;
  const raw = row as Record<string, unknown>;
  const categoriaTexto = pickText(raw, ["categoria", "grupo", "subcategoria"]);
  const nivelSegTexto = pickText(raw, ["nivelSeg", "nivel_seg", "nivel_seguranca"]);
  const apelidos = parseApelidos(raw.apelidos);

  const categoria = normalizeCategoria(categoriaTexto) ?? fallback?.categoria ?? "Pulseiras";
  const nivelSeg = normalizeNivelSeguranca(nivelSegTexto) ?? fallback?.nivelSeg ?? "medio";
  const fotos = mapFotoArray(raw.fotos ?? raw.produto_fotos, fallback?.fotos ?? []);
  const variacoes = mapVariacaoArray(raw.variacoes ?? raw.produto_variacoes, fallback?.variacoes ?? []);

  return {
    id: `prod_${idProduto}`,
    id_produto: idProduto,
    nomeReal: pickText(raw, ["nome_real", "nome", "produto", "descricao_produto"]) || fallback?.nomeReal || `Produto ${idProduto}`,
    categoria,
    formato: pickText(raw, ["formato", "medida", "tamanho"]) || fallback?.formato || "",
    valorUnt: pickNumber(raw, ["valorUnt", "valor_unt", "valor_unitario", "valor"]) ?? fallback?.valorUnt ?? 0,
    valorFixo: pickNumber(raw, ["valorFixo", "valor_fixo", "setup", "valor_setup"]) ?? fallback?.valorFixo ?? 0,
    valor_custo: pickNumber(raw, ["valor_custo", "custo", "custo_unitario"]) ?? fallback?.valor_custo ?? 0,
    peso: pickNumber(raw, ["peso", "peso_kg"]) ?? fallback?.peso ?? 0,
    prazo: pickText(raw, ["prazo", "prazo_producao", "prazo_entrega"]) || fallback?.prazo || "",
    nivelSeg,
    fraseCons: pickText(raw, ["fraseCons", "frase_cons", "frase_consultiva"]) || fallback?.fraseCons || "",
    descricao: pickText(raw, ["descricao", "descricao_produto"]) || fallback?.descricao || "",
    personalizacao: pickText(raw, ["personalizacao", "customizacao", "personalizacao_texto"]) || fallback?.personalizacao || "",
    apelidos: apelidos.length ? apelidos : fallback?.apelidos ?? [],
    ativo: pickBoolean(raw, ["ativo", "is_ativo", "status"]) ?? fallback?.ativo ?? true,
    is_estoque: pickBoolean(raw, ["is_estoque", "estoque", "controla_estoque"]) ?? fallback?.is_estoque ?? false,
    is_variacao: pickBoolean(raw, ["is_variacao", "tem_variacao", "possui_variacao"]) ?? fallback?.is_variacao ?? variacoes.length > 0,
    fotos,
    variacoes
  };
}

export function mapSupabaseProdutoRowsToProdutos(rows: SupabaseProdutoRow[]) {
  return sortProdutosByIdAsc(rows.map(mapSupabaseProdutoRowToProduto).filter((item): item is Produto => Boolean(item)));
}
