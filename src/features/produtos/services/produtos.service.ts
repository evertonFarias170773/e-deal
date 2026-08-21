import { getSupabaseClient } from "@/lib/supabase/client";
import {
  mapSupabaseProdutoFotoRowToFoto,
  mapSupabaseProdutoRowToProduto,
  mapSupabaseProdutoRowsToProdutos,
  mapSupabaseProdutoVariacaoRowToVariacao,
  type ProdutosReadResult,
  type ProdutosResumo,
  parseDecimalInput
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

type ProdutoWriteField =
  | "id_produto"
  | "nomeReal"
  | "categoria"
  | "formato"
  | "descricao"
  | "personalizacao"
  | "apelidos"
  | "ativo"
  | "is_estoque"
  | "is_variacao"
  | "nivelSeg"
  | "fraseCons"
  | "prazo"
  | "peso"
  | "valorUnt"
  | "valorFixo"
  | "valor_custo"
  | "cod_beneficio"
  | "ncm"
  | "descri_ncm"
  | "cest"
  | "origem"
  | "cod_origem"
  | "cod_bar"
  | "und_medida"
  | "is_multiplo"
  | "cfop_interno"
  | "cfop_interestadual"
  | "unidade_comercial"
  | "unidade_tributavel"
  | "icms_origem"
  | "icms_situacao_tributaria"
  | "pis_situacao_tributaria"
  | "cofins_situacao_tributaria"
  | "informacoes_fiscais"
  | "id_formato"
  | "id_modelo_cor"
  | "quantidade_minima_venda"
  | "tipo_blocagem"
  | "id_gabarito"
  | "setor_pcp";

export type ProdutoWriteInput = Partial<Record<ProdutoWriteField, string | number | boolean | string[] | null>>;

export type ProdutoWritePayload = Partial<Record<ProdutoWriteField, string | number | boolean | null>>;

export type ProdutoWriteResult = {
  success: boolean;
  operation: "INSERT" | "UPDATE" | "DELETE";
  table: "public.produtos";
  payload?: ProdutoWritePayload;
  allowedFields: readonly ProdutoWriteField[];
  rejectedFields: string[];
  message: string;
  produto?: Produto;
  conflict?: {
    idProduto: number;
    nomeReal: string;
  };
  blocked?: true;
  status?: string | number;
};

const DEFAULT_PAGE_SIZE = 100;
export const PRODUCT_IMAGES_BUCKET = "e-deal";
export const PRODUCT_IMAGES_FOLDER = "produtos";
const PRODUCT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const PRODUTOS_INSERT_FIELD_WHITELIST = [
  "id_produto",
  "nomeReal",
  "categoria",
  "formato",
  "descricao",
  "personalizacao",
  "apelidos",
  "ativo",
  "is_estoque",
  "is_variacao",
  "nivelSeg",
  "fraseCons",
  "prazo",
  "peso",
  "valorUnt",
  "valorFixo",
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
  "informacoes_fiscais",
  "id_gabarito",
  "setor_pcp"
] as const satisfies readonly ProdutoWriteField[];

export const PRODUTOS_UPDATE_FIELD_WHITELIST = [
  "nomeReal",
  "categoria",
  "formato",
  "descricao",
  "personalizacao",
  "apelidos",
  "ativo",
  "is_estoque",
  "is_variacao",
  "nivelSeg",
  "fraseCons",
  "prazo",
  "peso",
  "valorUnt",
  "valorFixo",
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
  "informacoes_fiscais",
  "id_formato",
  "id_modelo_cor",
  "quantidade_minima_venda",
  "tipo_blocagem",
  "id_gabarito",
  "setor_pcp"
] as const satisfies readonly ProdutoWriteField[];

export const PRODUTOS_DELETE_BLOCKED_MESSAGE =
  "DELETE físico em public.produtos está bloqueado nesta fase. Use inativação controlada em etapa própria.";

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
  "informacoes_fiscais",
  "id_formato",
  "id_modelo_cor",
  "quantidade_minima_venda",
  "tipo_blocagem",
  "id_gabarito",
  "setor_pcp"
].join(",");

const FOTOS_SELECT = "id,nomeProduto,imagensURL,idProduto";
const VARIACOES_SELECT = "id,id_produto,id_variacao,nome,is_obrigatorio,is_multiplo";

function normalizeProdutoWriteValue(field: ProdutoWriteField, value: ProdutoWriteInput[ProdutoWriteField]) {
  if (value === undefined || value === null) {
    return null;
  }

  if (field === "apelidos") {
    return Array.isArray(value) ? value.map(String).join(", ") : String(value);
  }

  if (
    field === "peso" ||
    field === "valorUnt" ||
    field === "valorFixo" ||
    field === "valor_custo"
  ) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    return parseDecimalInput(String(value));
  }

  if (
    field === "id_produto" ||
    field === "cod_origem" ||
    field === "id_formato" ||
    field === "id_modelo_cor" ||
    field === "quantidade_minima_venda" ||
    field === "id_gabarito"
  ) {
    if (typeof value === "string" && !value.trim()) {
      return null;
    }
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }

  if (field === "ativo" || field === "is_estoque" || field === "is_variacao" || field === "is_multiplo") {
    return typeof value === "string" ? value === "true" || value === "SIM" : Boolean(value);
  }

  const text = String(value).trim();
  return text || null;
}

function prepareProdutoWritePayload(input: ProdutoWriteInput, allowedFields: readonly ProdutoWriteField[]) {
  const allowed = new Set<string>(allowedFields);
  const payload: ProdutoWritePayload = {};
  const rejectedFields = Object.keys(input).filter((field) => !allowed.has(field));

  for (const field of allowedFields) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) {
      continue;
    }

    payload[field] = normalizeProdutoWriteValue(field, input[field]);
  }

  return {
    payload,
    rejectedFields
  };
}

function getSupabaseWriteStatus(error: { code?: string | null; status?: number } | null | undefined) {
  return error?.status ?? error?.code ?? undefined;
}

function getProdutoStorageErrorMessage(errorMessage: string) {
  const normalized = errorMessage.toLowerCase();
  if (normalized.includes("bucket not found")) {
    return `Bucket de imagens de produtos não encontrado no Supabase. Confirme se o bucket \`${PRODUCT_IMAGES_BUCKET}\` existe no Storage.`;
  }

  return errorMessage || `Não foi possível enviar a imagem para o bucket ${PRODUCT_IMAGES_BUCKET}.`;
}

function sanitizeStorageFileName(fileName: string) {
  const parts = fileName.split(".");
  const extension = parts.length > 1 ? parts.pop() : "";
  const baseName = parts.join(".") || "imagem";
  const normalizedBaseName = baseName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const normalizedExtension = extension?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

  return `${normalizedBaseName || "imagem"}${normalizedExtension ? `.${normalizedExtension}` : ""}`;
}

function buildEmptyResult(warnings: string[] = [], error: string | null = null): ProdutosReadResult {
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
    warnings,
    error
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
    console.error("[Produtos][List] leitura real falhou.", error);
    throw new Error(error.message || "Erro ao consultar a tabela public.produtos.");
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

export function prepareProdutoInsert(input: ProdutoWriteInput): ProdutoWriteResult {
  const { payload, rejectedFields } = prepareProdutoWritePayload(input, PRODUTOS_INSERT_FIELD_WHITELIST);

  return {
    success: false,
    operation: "INSERT",
    table: "public.produtos",
    payload,
    allowedFields: PRODUTOS_INSERT_FIELD_WHITELIST,
    rejectedFields,
    message: "INSERT real em public.produtos liberado somente por whitelist."
  };
}

export function prepareProdutoUpdate(input: ProdutoWriteInput): ProdutoWriteResult {
  const { payload, rejectedFields } = prepareProdutoWritePayload(input, PRODUTOS_UPDATE_FIELD_WHITELIST);

  return {
    success: false,
    operation: "UPDATE",
    table: "public.produtos",
    payload,
    allowedFields: PRODUTOS_UPDATE_FIELD_WHITELIST,
    rejectedFields,
    message: "UPDATE real em public.produtos liberado somente por whitelist."
  };
}

export async function produtoIdExists(idProduto: number): Promise<{ exists: boolean; produto?: Pick<Produto, "id_produto" | "nomeReal">; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      exists: false,
      errorMessage: "Cliente Supabase indisponível para validar ID do produto."
    };
  }

  if (!Number.isInteger(idProduto) || idProduto <= 0) {
    return {
      exists: false,
      errorMessage: "ID do produto inválido."
    };
  }

  const { data, error } = await client
    .from("produtos")
    .select("id_produto,nomeReal")
    .eq("id_produto", idProduto)
    .limit(1)
    .returns<Array<{ id_produto: number | null; nomeReal: string | null }>>();

  if (error) {
    return {
      exists: false,
      errorMessage: error.message || "Não foi possível validar se o ID do produto já existe."
    };
  }

  const row = data?.[0];
  return {
    exists: Boolean(row),
    produto: row
      ? {
          id_produto: Number(row.id_produto) || idProduto,
          nomeReal: row.nomeReal ?? ""
        }
      : undefined
  };
}

export async function createProdutoReal(input: ProdutoWriteInput): Promise<ProdutoWriteResult> {
  const client = getSupabaseClient();
  const prepared = prepareProdutoInsert(input);
  const idProduto = Number(prepared.payload?.id_produto);
  const nomeReal = String(prepared.payload?.nomeReal ?? "").trim();

  if (!client) {
    return {
      ...prepared,
      message: "Cliente Supabase indisponível para criar produto."
    };
  }

  if (!Number.isInteger(idProduto) || idProduto <= 0) {
    return {
      ...prepared,
      message: "Informe um ID de produto válido."
    };
  }

  if (!nomeReal) {
    return {
      ...prepared,
      message: "Informe o nome real do produto."
    };
  }

  const existingProduto = await produtoIdExists(idProduto);
  if (existingProduto.errorMessage) {
    return {
      ...prepared,
      message: existingProduto.errorMessage
    };
  }

  if (existingProduto.exists) {
    return {
      ...prepared,
      message: "Este ID de produto já está sendo usado. Informe outro ID.",
      conflict: existingProduto.produto
        ? {
            idProduto: existingProduto.produto.id_produto,
            nomeReal: existingProduto.produto.nomeReal
          }
        : undefined
    };
  }

  const { data, error } = await client
    .from("produtos")
    .insert(prepared.payload!)
    .select(PRODUTOS_SELECT)
    .single<SupabaseProdutoRow>();

  if (error) {
    return {
      ...prepared,
      message: error.message || "Não foi possível criar o produto no Supabase.",
      status: getSupabaseWriteStatus(error)
    };
  }

  if (!data) {
    return {
      ...prepared,
      message: "Supabase não retornou o produto criado."
    };
  }

  const produto = mapSupabaseProdutoRowToProduto(data);
  if (!produto) {
    return {
      ...prepared,
      message: "Produto criado, mas não foi possível mapear o retorno do Supabase."
    };
  }

  return {
    ...prepared,
    success: true,
    produto,
    message: "Produto criado com sucesso."
  };
}

export async function updateProdutoReal(idProduto: number, input: ProdutoWriteInput): Promise<ProdutoWriteResult> {
  const client = getSupabaseClient();
  const prepared = prepareProdutoUpdate(input);
  const nomeReal = Object.prototype.hasOwnProperty.call(prepared.payload ?? {}, "nomeReal")
    ? String(prepared.payload?.nomeReal ?? "").trim()
    : null;

  if (!client) {
    return {
      ...prepared,
      message: "Cliente Supabase indisponível para atualizar produto."
    };
  }

  if (!Number.isInteger(idProduto) || idProduto <= 0) {
    return {
      ...prepared,
      message: "ID do produto inválido para atualização."
    };
  }

  if (nomeReal !== null && !nomeReal) {
    return {
      ...prepared,
      message: "Informe o nome real do produto."
    };
  }

  const { data, error } = await client
    .from("produtos")
    .update(prepared.payload!)
    .eq("id_produto", idProduto)
    .select(PRODUTOS_SELECT)
    .single<SupabaseProdutoRow>();

  if (error) {
    return {
      ...prepared,
      message: error.message || "Não foi possível atualizar o produto no Supabase.",
      status: getSupabaseWriteStatus(error)
    };
  }

  if (!data) {
    return {
      ...prepared,
      message: "Supabase não retornou o produto atualizado."
    };
  }

  const produto = mapSupabaseProdutoRowToProduto(data);
  if (!produto) {
    return {
      ...prepared,
      message: "Produto atualizado, mas não foi possível mapear o retorno do Supabase."
    };
  }

  return {
    ...prepared,
    success: true,
    produto,
    message: "Produto atualizado com sucesso."
  };
}

/**
 * Inativar produto: `ativo = false`, pelo mesmo UPDATE de sempre.
 *
 * POR QUE EXISTE COMO FUNCAO PROPRIA
 *   Ate 21/08/2026 "Inativar produto" era um toast de mock nas duas telas do
 *   catalogo — e o pior dos tres mocks do modulo, porque a permissao
 *   `produtos.inativar` era checada de verdade: quem a tinha clicava, lia
 *   "acao mockada" e o produto seguia vendavel. Inativar so acontecia entrando
 *   em Editar e desmarcando o campo.
 *
 *   `ativo` ja estava em `PRODUTOS_UPDATE_FIELD_WHITELIST`, entao nao ha
 *   caminho novo aqui: e `updateProdutoReal` com um unico campo. O nome proprio
 *   existe para a intencao ficar num lugar so, e para deixar explicito o par
 *   com `deleteProdutoBlocked` logo abaixo — inativar e o que SUBSTITUI o
 *   DELETE fisico, que continua proibido porque o catalogo tem vinculo com
 *   propostas.
 *
 * O QUE INATIVAR DE FATO FAZ
 *   Some das buscas que filtram `ativo = true`: o seletor de produtos do
 *   Orcamento (`listProdutos({ ativo: true })`) e a busca de produtos da NF-e
 *   (`searchActiveProducts`). NAO afeta pedido nenhum ja existente — producao,
 *   detalhe e NF-e resolvem produto por `.in("id_produto", ...)`, sem olhar
 *   `ativo` —, e nao toca o snapshot em `produtos_proposta`.
 */
export async function inativarProdutoReal(idProduto: number): Promise<ProdutoWriteResult> {
  return updateProdutoReal(idProduto, { ativo: false });
}

export async function deleteProdutoBlocked(idProduto: number): Promise<ProdutoWriteResult> {
  // DELETE físico de produto é proibido nesta fase porque o catálogo pode ter vínculos com propostas.
  return {
    success: false,
    blocked: true,
    operation: "DELETE",
    table: "public.produtos",
    payload: {
      id_produto: idProduto
    },
    allowedFields: [],
    rejectedFields: [],
    message: PRODUTOS_DELETE_BLOCKED_MESSAGE
  };
}

export async function uploadProdutoFotoReal({
  idProduto,
  nomeProduto,
  file
}: {
  idProduto: number;
  nomeProduto: string;
  file: File;
}): Promise<{ success: boolean; foto?: ProdutoFoto; message: string; path?: string; publicUrl?: string; status?: string | number }> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      message: "Cliente Supabase indisponível para enviar foto."
    };
  }

  if (!Number.isInteger(idProduto) || idProduto <= 0) {
    return {
      success: false,
      message: "Salve ou informe um ID de produto válido antes de enviar a foto."
    };
  }

  if (!PRODUCT_IMAGE_MIME_TYPES.includes(file.type)) {
    return {
      success: false,
      message: "Selecione uma imagem JPG, PNG ou WEBP."
    };
  }

  const filePath = `${PRODUCT_IMAGES_FOLDER}/${idProduto}/${Date.now()}-${sanitizeStorageFileName(file.name)}`;
  const uploadResult = await client.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(filePath, file, {
      cacheControl: "3600",
      contentType: file.type
    });

  if (uploadResult.error) {
    console.log("[Produtos][Fotos] upload no Storage falhou.", {
      bucket: PRODUCT_IMAGES_BUCKET,
      path: filePath,
      error: uploadResult.error
    });

    return {
      success: false,
      message: getProdutoStorageErrorMessage(uploadResult.error.message),
      path: filePath,
      status: getSupabaseWriteStatus(uploadResult.error)
    };
  }

  const publicUrlResult = client.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .getPublicUrl(uploadResult.data.path);
  const publicUrl = publicUrlResult.data.publicUrl;

  if (!publicUrl) {
    return {
      success: false,
      message: "Upload concluído, mas não foi possível gerar a URL pública da imagem.",
      path: uploadResult.data.path
    };
  }

  const fotoPayload = {
    idProduto,
    nomeProduto: nomeProduto || `Produto ${idProduto}`,
    imagensURL: publicUrl
  };

  const { data, error } = await client
    .from("fotosProdutos")
    .insert(fotoPayload)
    .select(FOTOS_SELECT)
    .single<SupabaseProdutoFotoRow>();

  if (error) {
    return {
      success: false,
      message: error.message || "Imagem enviada, mas não foi possível registrar a foto em public.fotosProdutos.",
      path: uploadResult.data.path,
      publicUrl,
      status: getSupabaseWriteStatus(error)
    };
  }

  const foto = data ? mapSupabaseProdutoFotoRowToFoto(data) : null;
  if (!foto) {
    return {
      success: false,
      message: "Foto registrada, mas não foi possível mapear o retorno do Supabase.",
      path: uploadResult.data.path,
      publicUrl
    };
  }

  return {
    success: true,
    foto: {
      ...foto,
      principal: false
    },
    message: "Foto enviada com sucesso.",
    path: uploadResult.data.path,
    publicUrl
  };
}

export async function getProdutosReadOnlyList(): Promise<ProdutosReadResult> {
  const client = getSupabaseClient();
  if (!client) {
    return buildEmptyResult(
      ["Supabase indisponível. Nenhum produto real foi carregado."],
      "Supabase indisponível."
    );
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
      warnings: [`Leitura real aplicada em public.produtos com ${produtos.length} registros.`],
      error: null
    };
  } catch (error) {
    const err = error as Error;
    console.error("[Produtos][List] erro inesperado na leitura real.", err);
    return buildEmptyResult(
      ["Não foi possível carregar produtos reais neste momento."],
      err?.message || "Erro inesperado ao listar produtos."
    );
  }
}

export type FormatoProducao = {
  id: string;
  id_formato_num: number;
  name: string;
};

export type CorProducao = {
  id: string;
  id_modelo_cor_num: number;
  name: string;
  formato_id: string | null;
};

export async function listarFormatosProducao(): Promise<FormatoProducao[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("producao_formatos")
    .select("id, id_formato_num, name")
    .order("id_formato_num", { ascending: true });
  if (error) {
    console.error("[Produtos] erro ao listar formatos:", error);
    return [];
  }
  return data ?? [];
}

export async function listarCoresProducao(): Promise<CorProducao[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("producao_cores")
    .select("id, id_modelo_cor_num, name, formato_id")
    .order("id_modelo_cor_num", { ascending: true });
  if (error) {
    console.error("[Produtos] erro ao listar cores:", error);
    return [];
  }
  return data ?? [];
}

export interface GabaritoProducao {
  id: string;
  id_gabarito: number | null;
  name: string;
}

export async function listarGabaritos(): Promise<GabaritoProducao[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("producao_numeracoes")
    .select("*")
    .order("name", { ascending: true });
  if (error) {
    console.error("[Produtos] erro ao listar gabaritos:", error);
    return [];
  }
  return (data || []).map((d) => ({
    id: String(d.id),
    id_gabarito: "id_gabarito" in d ? (d.id_gabarito !== null ? Number(d.id_gabarito) : null) : null,
    name: String(d.name || "")
  }));
}

