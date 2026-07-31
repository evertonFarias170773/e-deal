import { getSupabaseClient } from "@/lib/supabase/client";
import type {
  SupabaseCadastrosClientesListaRow,
  SupabaseCadastrosAbcClienteRow,
  SupabaseCadastrosAbcCidadeRow
} from "@/features/cadastros/types.supabase";

const PAGE_SIZE_MAX = 200;

/** Colunas da lista. Uma constante só, para a consulta principal e a do ID exato
 *  nunca divergirem. */
const COLUNAS_LISTA =
  "id,id_cliente,id_cliente_text,nome,fantasia,apelido,documento,documento_numeros,tipo_pessoa,categoria,ativo,cidade_uf,nome_vendedor,whatsapp_1,whatsapp_2,telefone_fixo,credito,limite_credito,risco_credito,data_fundacao,aniversariante_hoje,qtd_pedidos,data_ult_pedido,busca_geral";

export type CadastrosReadSource = "supabase" | "mock";

export type CadastrosListaItem = {
  id: string;
  idCliente: number;
  idClienteText: string;
  nome: string;
  fantasia?: string;
  apelido?: string;
  documento: string;
  documentoNumeros: string;
  tipoPessoa: string;
  /** public.clientes.categoria — CLIENTE, TRANSPORTADORA… */
  categoria: string;
  ativo: boolean;
  cidadeUf: string;
  nomeVendedor: string;
  whatsapp1?: string;
  whatsapp2?: string;
  telefoneFixo?: string;
  credito: number;
  limiteCredito: number;
  riscoCredito: string;
  dataFundacao?: string | null;
  aniversarianteHoje: boolean;
  qtdPedidos: number;
  dataUltPedido: string | null;
  buscaGeral: string;
};

/** Tipos de cadastro existentes em public.clientes.categoria. */
export const CADASTRO_TIPOS = ["CLIENTE", "TRANSPORTADORA"] as const;
export type CadastroTipo = (typeof CADASTRO_TIPOS)[number];

export type CadastrosListQuery = {
  pageIndex: number;
  pageSize?: number;
  search?: string;
  idClienteSearch?: string;
  /** Vazio = todos os tipos. */
  tipo?: CadastroTipo | "";
  /** Falso (padrão) = só ativos. */
  mostrarInativos?: boolean;
};

export type CadastrosReadResult = {
  source: CadastrosReadSource;
  cadastros: CadastrosListaItem[];
  totalCount: number;
  hasNextPage: boolean;
  pageIndex: number;
  pageSize: number;
  loadedCount: number;
  warnings: string[];
  errorMessage?: string;
};

export type CadastrosDashboardClienteResumo = {
  posicao: number;
  idCliente: number;
  nome: string;
  fantasia?: string;
  cidadeUf: string;
  valorTotal: number;
  quantidadePedidos: number;
  ultimoPedido: string | null;
};

export type CadastrosDashboardCidadeResumo = {
  posicao: number;
  cidadeUf: string;
  valorTotal: number;
  quantidadePedidos: number;
  quantidadeClientes: number;
  ultimoPedido: string | null;
};

export type CadastrosDashboardResumo = {
  source: CadastrosReadSource;
  activeCount: number;
  topClientes: CadastrosDashboardClienteResumo[];
  topCidades: CadastrosDashboardCidadeResumo[];
  aniversariantesHoje: CadastrosListaItem[];
  warnings: string[];
};

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

function normalizeSearchTerm(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[%*,#]/g, "");
}

/** Limite de public.clientes.id_cliente (integer / int4). */
const INT4_MAX = 2147483647;

/**
 * Filtro da busca única. Um termo só de dígitos é ID do cliente ou documento —
 * restringir a esses dois campos evita que o registro certo se perca no meio de
 * dezenas de acertos parciais em telefone e nome (buscar "8469" casava 119
 * cadastros pela busca_geral, e o cliente 8469 caía fora da primeira página).
 * Termos com letras seguem na busca_geral, que já cobre nome, fantasia, apelido,
 * documento, cidade, telefones e e-mail.
 */
function montarFiltroBusca(termo: string): {
  tipo: "digitos" | "texto";
  expressao: string;
  /** ID que o filtro busca de forma exata. Vazio quando não há cláusula de ID. */
  idExato: string;
} {
  const digitos = termo.replace(/\D/g, "");
  const soDigitos = digitos.length > 0 && digitos === termo;

  if (soDigitos) {
    const clausulas = [`documento_numeros.ilike.%${digitos}%`];
    const cabeEmInt4 = Number(digitos) <= INT4_MAX;
    if (cabeEmInt4) {
      clausulas.unshift(`id_cliente_text.eq.${digitos}`);
    }
    return { tipo: "digitos", expressao: clausulas.join(","), idExato: cabeEmInt4 ? digitos : "" };
  }

  return { tipo: "texto", expressao: `busca_geral.ilike.%${termo.toLowerCase()}%`, idExato: "" };
}

function normalizeRankingPosicao(value: unknown, fallback = 0) {
  const parsed = toNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizeRankingDate(value: unknown) {
  const text = toText(value);
  return text || null;
}

function normalizeBool(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    return ["true", "t", "1", "sim", "s", "yes", "y"].includes(value.trim().toLowerCase());
  }

  return false;
}

function buildMockDashboardResumo(): CadastrosDashboardResumo {
  return {
    source: "supabase",
    activeCount: 0,
    topClientes: [],
    topCidades: [],
    aniversariantesHoje: [],
    warnings: ["Sem dados para ranking."]
  };
}

function mapClienteListaRow(row: SupabaseCadastrosClientesListaRow): CadastrosListaItem {
  const idCliente = normalizeRankingPosicao(row.id_cliente, 0);
  const documentoNumeros = toText(row.documento_numeros) || toText(row.documento).replace(/\D/g, "");
  return {
    id: toText(row.id) || `cad_${idCliente || "0"}`,
    idCliente,
    idClienteText: toText(row.id_cliente_text) || idCliente.toString(),
    nome: toText(row.nome) || "Cliente não informado",
    fantasia: toText(row.fantasia) || undefined,
    apelido: toText(row.apelido) || undefined,
    documento: toText(row.documento) || documentoNumeros,
    documentoNumeros,
    tipoPessoa: toText(row.tipo_pessoa) || "",
    categoria: toText(row.categoria) || "",
    // A view compartilhada não expõe `ativo` na projeção antiga; ausente = ativo.
    ativo: row.ativo === undefined || row.ativo === null ? true : normalizeBool(row.ativo),
    cidadeUf: toText(row.cidade_uf) || "Não informado",
    nomeVendedor: toText(row.nome_vendedor) || "Não informado",
    whatsapp1: toText(row.whatsapp_1) || undefined,
    whatsapp2: toText(row.whatsapp_2) || undefined,
    telefoneFixo: toText(row.telefone_fixo) || undefined,
    credito: toNumber(row.credito, 0),
    limiteCredito: toNumber(row.limite_credito, 0),
    riscoCredito: toText(row.risco_credito) || "MEDIO",
    dataFundacao: toText(row.data_fundacao) || null,
    aniversarianteHoje: normalizeBool(row.aniversariante_hoje),
    qtdPedidos: normalizeRankingPosicao(row.qtd_pedidos, 0),
    dataUltPedido: normalizeRankingDate(row.data_ult_pedido),
    buscaGeral: toText(row.busca_geral)
  };
}

async function fetchDashboardResumoSupabase(
  client: NonNullable<ReturnType<typeof getSupabaseClient>>
): Promise<CadastrosDashboardResumo> {
  const [activeCountResult, clientesViewResult, cidadesViewResult, aniversariantesResult] = await Promise.all([
    client.from("vw_cadastros_clientes_lista").select("id", { count: "exact", head: true }),
    client
      .from("vw_cadastros_abc_clientes")
      .select("posicao,id_cliente,cliente,qtd_pedidos,valor_total,ultimo_pedido")
      .lte("posicao", 3)
      .order("posicao", { ascending: true })
      .returns<SupabaseCadastrosAbcClienteRow[]>(),
    client
      .from("vw_cadastros_abc_cidades")
      .select("posicao,cidade_uf,qtd_pedidos,qtd_clientes,valor_total,ultimo_pedido")
      .lte("posicao", 3)
      .order("posicao", { ascending: true })
      .returns<SupabaseCadastrosAbcCidadeRow[]>(),
    client
      .from("vw_cadastros_clientes_lista")
      .select("id,id_cliente,id_cliente_text,nome,fantasia,apelido,data_fundacao")
      .eq("aniversariante_hoje", true)
      .order("nome", { ascending: true })
      .returns<SupabaseCadastrosClientesListaRow[]>()
  ]);

  if (activeCountResult.error) {
    throw activeCountResult.error;
  }

  if (clientesViewResult.error) {
    throw clientesViewResult.error;
  }

  if (cidadesViewResult.error) {
    throw cidadesViewResult.error;
  }

  if (aniversariantesResult.error) {
    throw aniversariantesResult.error;
  }

  const topClientes = (clientesViewResult.data ?? []).map((row) => ({
    posicao: normalizeRankingPosicao(row.posicao, 0),
    idCliente: normalizeRankingPosicao(row.id_cliente, 0),
    nome: toText(row.cliente) || "Cliente não informado",
    fantasia: undefined,
    cidadeUf: "",
    valorTotal: toNumber(row.valor_total, 0),
    quantidadePedidos: normalizeRankingPosicao(row.qtd_pedidos, 0),
    ultimoPedido: normalizeRankingDate(row.ultimo_pedido)
  }));

  const topCidades = (cidadesViewResult.data ?? []).map((row) => ({
    posicao: normalizeRankingPosicao(row.posicao, 0),
    cidadeUf: toText(row.cidade_uf) || "Cidade não informada",
    valorTotal: toNumber(row.valor_total, 0),
    quantidadePedidos: normalizeRankingPosicao(row.qtd_pedidos, 0),
    quantidadeClientes: normalizeRankingPosicao(row.qtd_clientes, 0),
    ultimoPedido: normalizeRankingDate(row.ultimo_pedido)
  }));

  const aniversariantesHoje = (aniversariantesResult.data ?? []).map((row) => mapClienteListaRow(row));

  const hasRankingData = topClientes.length > 0 || topCidades.length > 0;

  return {
    source: "supabase",
    activeCount: activeCountResult.count ?? 0,
    topClientes,
    topCidades,
    aniversariantesHoje,
    warnings: hasRankingData ? ["Leitura real aplicada em views read-only de ranking."] : ["Sem dados para ranking."]
  };
}

export async function getCadastrosReadOnlyList(query: CadastrosListQuery): Promise<CadastrosReadResult> {
  const pageSize = Math.min(Math.max(query.pageSize ?? PAGE_SIZE_MAX, 1), PAGE_SIZE_MAX);
  const pageIndex = Math.max(query.pageIndex, 0);
  const client = getSupabaseClient();

  if (!client) {
    return {
      source: "supabase",
      cadastros: [],
      totalCount: 0,
      hasNextPage: false,
      pageIndex,
      pageSize,
      loadedCount: 0,
      warnings: ["Supabase indisponível. Nenhum dado foi carregado."]
    };
  }

  const searchTerm = normalizeSearchTerm(query.search ?? "");
  const idClienteDigits = normalizeSearchTerm(query.idClienteSearch ?? "").replace(/\D/g, "");

  const filtroBusca = searchTerm ? montarFiltroBusca(searchTerm) : null;

  // Busca por dígitos: o registro de ID exato é fixado no topo da primeira
  // página. Sem isso ele fica inalcançável — a ordem é `id_cliente` desc, então
  // um ID curto cai no fim do conjunto (buscar "469" trazia 488 linhas com o
  // cadastro certo na posição 484, e "8" trazia 43.089 com ele na 43.083).
  const idExato = filtroBusca?.idExato ?? "";
  const fixarIdExato = Boolean(idExato);

  // A consulta principal exclui o registro fixado em TODAS as páginas, para ele
  // não reaparecer na posição natural. A primeira página cede uma vaga a ele, e
  // por isso as seguintes começam uma linha antes — nenhum registro se perde.
  const vagaDoIdExato = fixarIdExato ? 1 : 0;
  const from = pageIndex * pageSize - (pageIndex > 0 ? vagaDoIdExato : 0);
  const to = from + pageSize - 1 - (pageIndex === 0 ? vagaDoIdExato : 0);

  // Uma lista só de filtros, aplicada igual na consulta principal e na do ID
  // exato — é o que garante que a linha fixada respeita ativo, tipo e o filtro
  // de ID vindo da URL.
  const filtrosDaLista: Array<{ op: "eq" | "ilike"; coluna: string; valor: string | boolean }> = [];
  // Inativos ocultos por padrão. `eq(true)` — e não `neq(false)` — para também
  // deixar fora quem tem `ativo` nulo, igual ao `ativo = true` da view antiga.
  if (!query.mostrarInativos) {
    filtrosDaLista.push({ op: "eq", coluna: "ativo", valor: true });
  }
  if (query.tipo) {
    filtrosDaLista.push({ op: "eq", coluna: "categoria", valor: query.tipo });
  }
  // Compatibilidade: links antigos ainda podem trazer o filtro de ID separado.
  if (idClienteDigits) {
    filtrosDaLista.push({ op: "ilike", coluna: "id_cliente_text", valor: `${idClienteDigits}%` });
  }

  try {
    // Fonte: public.vw_cadastros_lista_completa (migration
    // 20260729_vw_cadastros_lista_completa.sql). Mesmas colunas da view
    // compartilhada, mas sem fixar `categoria = 'CLIENTE' AND ativo = true` na
    // definição — é o que permite o filtro por tipo e o "Mostrar inativos". A
    // vw_cadastros_clientes_lista segue intacta e ainda serve o dashboard aqui
    // mesmo (contagem de ativos e aniversariantes) e o Maestro.
    let request = client
      .from("vw_cadastros_lista_completa")
      .select(COLUNAS_LISTA, { count: "exact" })
      // nullsFirst: false — em DESC o Postgres põe NULL primeiro, e um cadastro
      // sem id_cliente abria a lista dos "mais recentes".
      .order("id_cliente", { ascending: false, nullsFirst: false });

    for (const filtro of filtrosDaLista) {
      request =
        filtro.op === "eq"
          ? request.eq(filtro.coluna, filtro.valor)
          : request.ilike(filtro.coluna, String(filtro.valor));
    }

    if (filtroBusca) {
      request = request.or(filtroBusca.expressao);
    }

    if (fixarIdExato) {
      // Segundo or(), que o PostgREST combina com E. A cláusula `is.null` mantém
      // os cadastros sem id_cliente, que um neq puro descartaria junto.
      request = request.or(`id_cliente_text.is.null,id_cliente_text.neq.${idExato}`);
    }

    request = request.range(from, to);

    // O registro exato já pertence ao conjunto da busca — o or() de
    // montarFiltroBusca o inclui. Esta leitura de uma linha só o antecipa; roda
    // em todas as páginas para o total continuar batendo em todas elas.
    let requestIdExato = client
      .from("vw_cadastros_lista_completa")
      .select(COLUNAS_LISTA)
      .eq("id_cliente_text", idExato);

    for (const filtro of filtrosDaLista) {
      requestIdExato =
        filtro.op === "eq"
          ? requestIdExato.eq(filtro.coluna, filtro.valor)
          : requestIdExato.ilike(filtro.coluna, String(filtro.valor));
    }

    const consultaIdExato = fixarIdExato
      ? requestIdExato.limit(1).returns<SupabaseCadastrosClientesListaRow[]>()
      : null;

    const [{ data, error, count }, resultadoIdExato] = await Promise.all([
      request.returns<SupabaseCadastrosClientesListaRow[]>(),
      consultaIdExato
    ]);

    if (error) {
      throw error;
    }

    let cadastros = (data ?? []).map(mapClienteListaRow);

    const linhaExata = resultadoIdExato?.data?.[0];
    if (linhaExata && pageIndex === 0) {
      const item = mapClienteListaRow(linhaExata);
      cadastros = [item, ...cadastros.filter((c) => c.id !== item.id)].slice(0, pageSize);
    }

    const totalPrincipal = typeof count === "number" ? count : cadastros.length;
    const totalCount = totalPrincipal + (linhaExata ? 1 : 0);

    return {
      source: "supabase",
      cadastros,
      totalCount,
      // Aritmética da consulta principal: o registro fixado não entra na conta,
      // porque ela foi excluída do conjunto paginado.
      hasNextPage: from + (data ?? []).length < totalPrincipal,
      pageIndex,
      pageSize,
      loadedCount: cadastros.length,
      warnings: [
        `Leitura real aplicada em public.vw_cadastros_lista_completa com paginação server-side de ${pageSize} registros.`
      ]
    };
  } catch (error) {
    console.log("[Cadastros][List] erro na leitura real - fallback vazio ativado.", { error });
    return {
      source: "supabase",
      cadastros: [],
      totalCount: 0,
      hasNextPage: false,
      pageIndex,
      pageSize,
      loadedCount: 0,
      warnings: ["Não foi possível carregar a lista neste momento."]
    };
  }
}

export async function getCadastrosDashboardResumo(): Promise<CadastrosDashboardResumo> {
  const client = getSupabaseClient();
  if (!client) {
    return buildMockDashboardResumo();
  }

  try {
    return await fetchDashboardResumoSupabase(client);
  } catch (error) {
    console.log("[Cadastros][Resumo] erro na leitura real - fallback vazio ativado.", { error });
    return buildMockDashboardResumo();
  }
}
