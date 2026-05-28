import { getSupabaseClient } from "@/lib/supabase/client";
import {
  mapSupabaseProdutoFotoRowToFoto,
  mapSupabaseProdutoRowToProduto,
  mapSupabaseProdutoRowsToProdutos,
  mapSupabaseProdutoVariacaoRowToVariacao,
  type ProdutosReadResult,
  type ProdutosResumo
} from "@/features/produtos/mappers";
import type { Produto, ProdutoFoto, ProdutoVariacaoDetalhada } from "@/features/produtos/types";
import type { SupabaseProdutoFotoRow, SupabaseProdutoRow, SupabaseProdutoVariacaoRow } from "@/features/produtos/types.supabase";

export type { ProdutosReadResult, ProdutosResumo } from "@/features/produtos/mappers";

export type ProdutosListParams = {
  pageIndex?: number;
  pageSize?: number;
  search?: string;
  categoria?: string;
  ativo?: boolean;
  isEstoque?: boolean;
  isVariacao?: boolean;
  hasFotos?: boolean;
};

const DEFAULT_PAGE_SIZE = 100;

export const PRODUTOS_SELECT = [
  "id",
  "created_at",
  "id_produto",
  "nomeReal",
  "formato",
  "valorUnt",
  "valorFixo",
  "peso",
  "prazo",
  "nivelSeg",
  "fraseCons",
  "descricao",
  "personalizacao",
  "categoria",
  "ativo",
  "apelidos",
  "is_estoque",
  "is_variacao",
  "valor_custo",
  "cod_beneficio",
  "ncm",
  "descri_ncm",
  "cest",
  "origem",
  "cod_origem",
  "cod_bar",
  "und_medida",
  "is_multiplo",
  "cfop_interno",
  "cfop_interestadual",
  "unidade_comercial",
  "unidade_tributavel",
  "icms_origem",
  "icms_situacao_tributaria",
  "pis_situacao_tributaria",
  "cofins_situacao_tributaria",
  "informacoes_fiscais"
].join(",");

const FOTOS_SELECT = "id,nomeProduto,imagensURL,idProduto";
const VARIACOES_SELECT = "id,id_produto,id_variacao,nome,is_obrigatorio,is_multiplo";

function buildEmptyResult(warnings: string[] = []): ProdutosReadResult {
  return {
    source: "supabase",
    produtos: [],
    resumo: {
      ativos: 0,
      comVariacoes: 0,
      estoque: 0,
      comFotos: 0
    },
    categorias: [],
    warnings
  };
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function produtoMatchesSearch(produto: Produto, search: string) {
  const normalizedSearch = normalize(search.trim());
  if (!normalizedSearch) {
    return true;
  }

  return normalize([
    produto.id_produto.toString(),
    produto.nomeReal,
    produto.apelidos.join(" "),
    produto.categoria
  ].join(" ")).includes(normalizedSearch);
}

function groupRelations(
  fotos: ProdutoFoto[],
  variacoes: ProdutoVariacaoDetalhada[]
) {
  const relations = new Map<number, { fotos: ProdutoFoto[]; variacoes: ProdutoVariacaoDetalhada[] }>();

  for (const foto of fotos) {
    const current = relations.get(foto.idProduto) ?? { fotos: [], variacoes: [] };
    current.fotos.push({
      ...foto,
      principal: current.fotos.length === 0
    });
    relations.set(foto.idProduto, current);
  }

  for (const variacao of variacoes) {
    const current = relations.get(variacao.id_produto) ?? { fotos: [], variacoes: [] };
    current.variacoes.push(variacao);
    relations.set(variacao.id_produto, current);
  }

  return relations;
}

function buildResumoFromProdutos(produtos: Produto[]): ProdutosResumo {
  return {
    ativos: produtos.filter((produto) => produto.ativo).length,
    comVariacoes: produtos.filter((produto) => produto.is_variacao).length,
    estoque: produtos.filter((produto) => produto.is_estoque).length,
    comFotos: produtos.filter((produto) => produto.fotos.length > 0).length
  };
}

async function fetchFotosProdutos() {
  const client = getSupabaseClient();
  if (!client) {
    return {
      fotos: [] as ProdutoFoto[],
      warning: "Supabase indisponível para leitura de fotos."
    };
  }

  const { data, error } = await client
    .from("fotosProdutos")
    .select(FOTOS_SELECT)
    .order("idProduto", { ascending: true })
    .returns<SupabaseProdutoFotoRow[]>();

  if (error) {
    console.log("[Produtos][Fotos] leitura falhou.", { error });
    return {
      fotos: [] as ProdutoFoto[],
      warning: "Não foi possível carregar fotos reais de public.fotosProdutos."
    };
  }

  return {
    fotos: (data ?? []).map(mapSupabaseProdutoFotoRowToFoto).filter((item): item is ProdutoFoto => Boolean(item)),
    warning: null
  };
}

async function fetchProdutoVariacoes() {
  const client = getSupabaseClient();
  if (!client) {
    return {
      variacoes: [] as ProdutoVariacaoDetalhada[],
      warning: "Supabase indisponível para leitura de variações."
    };
  }

  const { data, error } = await client
    .from("produto_variacoes")
    .select(VARIACOES_SELECT)
    .order("id_produto", { ascending: true })
    .returns<SupabaseProdutoVariacaoRow[]>();

  if (error) {
    console.log("[Produtos][Variações] leitura falhou.", { error });
    return {
      variacoes: [] as ProdutoVariacaoDetalhada[],
      warning: "Não foi possível carregar variações reais de public.produto_variacoes."
    };
  }

  return {
    variacoes: (data ?? []).map(mapSupabaseProdutoVariacaoRowToVariacao).filter((item): item is ProdutoVariacaoDetalhada => Boolean(item)),
    warning: null
  };
}

async function fetchProdutoRelations() {
  const [fotosResult, variacoesResult] = await Promise.all([
    fetchFotosProdutos(),
    fetchProdutoVariacoes()
  ]);

  return {
    relationsByIdProduto: groupRelations(fotosResult.fotos, variacoesResult.variacoes),
    warnings: [fotosResult.warning, variacoesResult.warning].filter(Boolean) as string[]
  };
}

export async function listProdutos(params: ProdutosListParams = {}): Promise<Produto[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const pageSize = Math.min(Math.max(params.pageSize ?? DEFAULT_PAGE_SIZE, 1), DEFAULT_PAGE_SIZE);
  const pageIndex = Math.max(params.pageIndex ?? 0, 0);
  const from = pageIndex * pageSize;
  const to = from + pageSize - 1;

  let request = client
    .from("produtos")
    .select(PRODUTOS_SELECT);

  if (typeof params.ativo === "boolean") {
    request = request.eq("ativo", params.ativo);
  }

  if (typeof params.isEstoque === "boolean") {
    request = request.eq("is_estoque", params.isEstoque);
  }

  if (typeof params.isVariacao === "boolean") {
    request = request.eq("is_variacao", params.isVariacao);
  }

  if (params.categoria && params.categoria !== "TODAS") {
    request = request.eq("categoria", params.categoria);
  }

  const { data, error } = await request
    .order("id_produto", { ascending: true })
    .range(from, to)
    .returns<SupabaseProdutoRow[]>();
  if (error) {
    console.log("[Produtos][List] leitura real falhou.", { error });
    return [];
  }

  const relationsResult = await fetchProdutoRelations();
  let produtos = mapSupabaseProdutoRowsToProdutos(data ?? [], relationsResult.relationsByIdProduto);

  if (params.search) {
    produtos = produtos.filter((produto) => produtoMatchesSearch(produto, params.search ?? ""));
  }

  if (typeof params.hasFotos === "boolean") {
    produtos = produtos.filter((produto) => (params.hasFotos ? produto.fotos.length > 0 : produto.fotos.length === 0));
  }

  return produtos;
}

export async function getProdutoByIdProduto(idProduto: number): Promise<Produto | null> {
  const client = getSupabaseClient();
  if (!client || !Number.isFinite(idProduto)) {
    return null;
  }

  const [produtoResult, relationsResult] = await Promise.all([
    client
      .from("produtos")
      .select(PRODUTOS_SELECT)
      .eq("id_produto", idProduto)
      .limit(1)
      .returns<SupabaseProdutoRow[]>(),
    fetchProdutoRelations()
  ]);

  if (produtoResult.error) {
    console.log("[Produtos][Detail] leitura real falhou.", { error: produtoResult.error, idProduto });
    return null;
  }

  const row = produtoResult.data?.[0];
  if (!row) {
    return null;
  }

  return mapSupabaseProdutoRowToProduto(row, relationsResult.relationsByIdProduto.get(idProduto));
}

export async function getProdutosResumo(): Promise<ProdutosResumo> {
  const client = getSupabaseClient();
  if (!client) {
    return buildEmptyResult().resumo;
  }

  const [ativosResult, variacoesResult, estoqueResult, fotosResult] = await Promise.all([
    client.from("produtos").select("id", { count: "exact", head: true }).eq("ativo", true),
    client.from("produtos").select("id", { count: "exact", head: true }).eq("is_variacao", true),
    client.from("produtos").select("id", { count: "exact", head: true }).eq("is_estoque", true),
    client.from("fotosProdutos").select("idProduto").returns<SupabaseProdutoFotoRow[]>()
  ]);

  const produtoIdsComFoto = new Set((fotosResult.data ?? []).map((foto) => Number(foto.idProduto)).filter(Number.isFinite));

  return {
    ativos: ativosResult.count ?? 0,
    comVariacoes: variacoesResult.count ?? 0,
    estoque: estoqueResult.count ?? 0,
    comFotos: fotosResult.error ? 0 : produtoIdsComFoto.size
  };
}

export async function listCategoriasProdutos(): Promise<string[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from("categorias")
    .select("categoria")
    .order("categoria", { ascending: true })
    .returns<Array<{ categoria: string | null }>>();

  if (error) {
    console.log("[Produtos][Categorias] leitura de public.categorias falhou.", { error });
    return [];
  }

  return Array.from(new Set((data ?? []).map((row) => row.categoria?.trim()).filter((item): item is string => Boolean(item))));
}

export async function getProdutosReadOnlyList(): Promise<ProdutosReadResult> {
  const client = getSupabaseClient();
  if (!client) {
    return buildEmptyResult(["Supabase indisponível. Nenhum produto real foi carregado."]);
  }

  try {
    const [produtos, resumo, categorias] = await Promise.all([
      listProdutos({ pageSize: DEFAULT_PAGE_SIZE }),
      getProdutosResumo(),
      listCategoriasProdutos()
    ]);

    const categoriasFromProdutos = produtos.map((produto) => produto.categoria).filter(Boolean);

    return {
      source: "supabase",
      produtos,
      resumo: produtos.length ? resumo : buildResumoFromProdutos(produtos),
      categorias: Array.from(new Set([...categorias, ...categoriasFromProdutos])).sort((a, b) => a.localeCompare(b, "pt-BR")),
      warnings: [`Leitura real aplicada em public.produtos com ${produtos.length} registros.`]
    };
  } catch (error) {
    console.log("[Produtos][List] erro inesperado na leitura real.", { error });
    return buildEmptyResult(["Não foi possível carregar produtos reais neste momento."]);
  }
}
