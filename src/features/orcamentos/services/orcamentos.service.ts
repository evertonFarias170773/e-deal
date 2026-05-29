import { getSupabaseClient } from "@/lib/supabase/client";
import { propostasMock, calculateResumo } from "@/lib/mocks/propostas.mock";
import type {
  SupabasePagamentoTipoCobrancaRow,
  SupabasePropostaRow,
  SupabaseProdutoPropostaRow,
  SupabaseProdutoPropostaVariacaoRow
} from "@/features/orcamentos/types.supabase";
import {
  mapMockPropostaToListItem,
  mapSupabasePropostaRowsToListItems,
  type OrcamentoListItem,
  type OrcamentoListSource
} from "@/features/orcamentos/mappers";
import { getCadastroCompleto } from "@/features/cadastros/services/cadastros.service";
import { getProdutoByIdProduto } from "@/features/produtos/services/produtos.service";
import { listVariacoesGlobais } from "@/features/produtos/services/produto-variacoes.service";
import { buildPropostaInformalText } from "@/features/orcamentos/orcamento-utils";
import { listarCotacoesFrete } from "@/features/orcamentos/services/frete.service";
import type { Cadastro } from "@/features/cadastros/types";
import type { Produto } from "@/features/produtos/types";
import type {
  Proposta,
  PropostaFormState,
  PropostaItem,
  PropostaVariacaoEscolhida,
  PropostaFrete,
  PropostaStatus
} from "@/features/orcamentos/types";


export type OrcamentosReadResult = {
  source: OrcamentoListSource;
  propostas: OrcamentoListItem[];
  warnings: string[];
  detectedColumns: string[];
  errorMessage?: string;
  diagnostics: OrcamentosDiagnostics;
};

export type OrcamentosDiagnostics = {
  source: OrcamentoListSource;
  hasSupabaseUrl: boolean;
  hasSupabaseAnonKey: boolean;
  clientImportPath: string;
  clientShape: string;
  queryExecuted: boolean;
  registrosRetornados: number;
  firstRowColumns: string[];
  supabaseError: string | null;
  fallbackReason: string | null;
  smoke: OrcamentosSmokeDiagnostics;
};

export type OrcamentosSmokeDiagnostics = {
  resultExists: boolean;
  resultKeys: string[];
  dataIsArray: boolean;
  dataCount: number;
  firstIdInts: Array<number | string | null>;
  errorMessage: string | null;
  status: number | null;
  statusText: string | null;
};

function cloneMockList() {
  return propostasMock.map((proposta) => mapMockPropostaToListItem(proposta));
}

function getErrorMessage(error: unknown) {
  if (!error) {
    return null;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : JSON.stringify(error);
  }

  return JSON.stringify(error);
}

function normalizeSmokeIdInt(value: unknown): number | string | null {
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }

  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : value.toString();
  }

  return null;
}

function buildMockResult(warnings: string[] = [], diagnostics?: Partial<OrcamentosDiagnostics>): OrcamentosReadResult {
  return {
    source: "mock",
    propostas: cloneMockList(),
    warnings,
    detectedColumns: [],
    diagnostics: {
      source: "mock",
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      clientImportPath: "@/lib/supabase/client",
      clientShape: "desconhecido",
      queryExecuted: Boolean(diagnostics?.queryExecuted),
      registrosRetornados: diagnostics?.registrosRetornados ?? 0,
      firstRowColumns: diagnostics?.firstRowColumns ?? [],
      supabaseError: diagnostics?.supabaseError ?? null,
      fallbackReason: diagnostics?.fallbackReason ?? null,
      smoke: diagnostics?.smoke ?? {
        resultExists: false,
        resultKeys: [],
        dataIsArray: false,
        dataCount: 0,
        firstIdInts: [],
        errorMessage: null,
        status: null,
        statusText: null
      }
    }
  };
}

function logSupabaseEnv() {
  const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasSupabaseAnonKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  let supabaseUrlHost: string | null = null;

  if (hasSupabaseUrl) {
    try {
      supabaseUrlHost = new URL(String(process.env.NEXT_PUBLIC_SUPABASE_URL)).host;
    } catch {
      supabaseUrlHost = "url-invalida";
    }
  }

  console.log("[Orcamentos][Env]", {
    hasSupabaseUrl,
    hasSupabaseAnonKey,
    supabaseUrlHost,
    supabaseAnonKeyPresent: hasSupabaseAnonKey
  });

  return {
    hasSupabaseUrl,
    hasSupabaseAnonKey
  };
}

function normalizeTipoCobranca(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value).trim();
  if (!text) {
    return "";
  }

  return text.toUpperCase();
}

function uniqueTiposCobranca(values: string[]) {
  return Array.from(new Set(values.map(normalizeTipoCobranca).filter(Boolean)));
}

function joinTiposCobranca(values: string[]) {
  const unique = uniqueTiposCobranca(values);
  return unique.length ? unique.join(" / ") : "Não gerada";
}

type OrcamentosPeriodoFilter = {
  periodoKey: string;
  inicioIso: string;
  fimExclusivoIso: string;
};

function getSaoPauloMidnightIso(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1, 3, 0, 0)).toISOString();
}

function buildPeriodoFilter(periodo: string): OrcamentosPeriodoFilter | null {
  if (!periodo || periodo === "all") {
    return null;
  }

  const [yearText, monthText] = periodo.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  const inicioIso = getSaoPauloMidnightIso(year, month);
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

  return {
    periodoKey: periodo,
    inicioIso,
    fimExclusivoIso: getSaoPauloMidnightIso(nextMonth.year, nextMonth.month)
  };
}

async function fetchPropostaRows(periodo = "all", limit = 500) {
  const env = logSupabaseEnv();
  const client = getSupabaseClient();
  const hasFrom = Boolean(client && typeof client.from === "function");
  const smokeQuery = client && hasFrom ? client.from("propostas").select("id_int").limit(5) : null;
  const hasReturns = Boolean(smokeQuery && typeof smokeQuery.returns === "function");
  const clientShape = `from:${hasFrom ? "sim" : "nao"}; returns:${hasReturns ? "sim" : "nao"}`;
  const periodoFilter = buildPeriodoFilter(periodo);
  const queryLimit = periodoFilter ? Math.max(limit, 5000) : limit;

  if (!client) {
    const fallbackReason = !env.hasSupabaseUrl || !env.hasSupabaseAnonKey ? "envs ausentes" : "client compartilhado retornou null";
    console.log("[Orcamentos][Fallback] client nao inicializou.", { motivo: fallbackReason });
    return {
      rows: null,
      diagnostics: {
        source: "mock",
        hasSupabaseUrl: env.hasSupabaseUrl,
        hasSupabaseAnonKey: env.hasSupabaseAnonKey,
        clientImportPath: "@/lib/supabase/client",
        clientShape,
        queryExecuted: false,
        registrosRetornados: 0,
        firstRowColumns: [],
        supabaseError: null,
        fallbackReason,
        smoke: {
          resultExists: false,
          resultKeys: [],
          dataIsArray: false,
          dataCount: 0,
          firstIdInts: [],
          errorMessage: null,
          status: null,
          statusText: null
        }
      }
    };
  }

  try {
    if (!smokeQuery || !hasReturns) {
      return {
        rows: null,
        diagnostics: {
          source: "mock",
          hasSupabaseUrl: env.hasSupabaseUrl,
          hasSupabaseAnonKey: env.hasSupabaseAnonKey,
          clientImportPath: "@/lib/supabase/client",
          clientShape,
          queryExecuted: false,
          registrosRetornados: 0,
          firstRowColumns: [],
          supabaseError: "Client sem suporte a query builder esperado (from/select/limit/returns)",
          fallbackReason: "client incompatível",
          smoke: {
            resultExists: false,
            resultKeys: [],
            dataIsArray: false,
            dataCount: 0,
            firstIdInts: [],
            errorMessage: "client shape inesperado",
            status: null,
            statusText: null
          }
        }
      };
    }

    const { data: smokeData, error: smokeError } = await smokeQuery.returns<
      Array<{ id_int: number | string | null }>
    >();

    const smoke: OrcamentosSmokeDiagnostics = {
      resultExists: true,
      resultKeys: ["data", "error"],
      dataIsArray: Array.isArray(smokeData),
      dataCount: Array.isArray(smokeData) ? smokeData.length : 0,
      firstIdInts: Array.isArray(smokeData)
        ? smokeData.slice(0, 5).map((row) => row?.id_int ?? null)
        : [],
      errorMessage:
        getErrorMessage(smokeError),
      status: null,
      statusText: null
    };

    console.log("[Orcamentos][Smoke]", {
      resultExists: smoke.resultExists,
      resultKeys: smoke.resultKeys,
      dataIsArray: smoke.dataIsArray,
      dataCount: smoke.dataCount,
      firstIdInts: smoke.firstIdInts,
      errorMessage: smoke.errorMessage,
      status: smoke.status,
      statusText: smoke.statusText
    });

    if (smoke.errorMessage) {
      return {
        rows: null,
        diagnostics: {
          source: "mock",
          hasSupabaseUrl: env.hasSupabaseUrl,
          hasSupabaseAnonKey: env.hasSupabaseAnonKey,
          clientImportPath: "@/lib/supabase/client",
          clientShape,
          queryExecuted: true,
          registrosRetornados: 0,
          firstRowColumns: [],
          supabaseError: smoke.errorMessage,
          fallbackReason: "smoke query com erro",
          smoke
        }
      };
    }

    if (!smoke.dataIsArray) {
      return {
        rows: null,
        diagnostics: {
          source: "mock",
          hasSupabaseUrl: env.hasSupabaseUrl,
          hasSupabaseAnonKey: env.hasSupabaseAnonKey,
          clientImportPath: "@/lib/supabase/client",
          clientShape,
          queryExecuted: true,
          registrosRetornados: 0,
          firstRowColumns: [],
          supabaseError: "Campo data nao veio como array no smoke test",
          fallbackReason: "payload invalido",
          smoke
        }
      };
    }

    console.log("[Orcamentos][Query]", {
      table: "propostas",
      select: "*",
      orderBy: "id_int.desc",
      limit: queryLimit,
      periodoSelecionado: periodoFilter?.periodoKey ?? "all",
      campoData: "created_at",
      inicioIso: periodoFilter?.inicioIso ?? null,
      fimExclusivoIso: periodoFilter?.fimExclusivoIso ?? null
    });

    let query = client
      .from("propostas")
      .select("*")
      .order("id_int", { ascending: false })
      .limit(queryLimit);

    if (periodoFilter) {
      query = query.gte("created_at", periodoFilter.inicioIso).lt("created_at", periodoFilter.fimExclusivoIso);
    }

    const { data, error } = await query.returns<SupabasePropostaRow[]>();

    if (error) {
      const supabaseError = getErrorMessage(error) ?? "Erro desconhecido no Supabase";
      console.log("[Orcamentos][SupabaseError]", {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : "SupabaseError",
        stack: error instanceof Error ? error.stack : null
      });
      return {
        rows: null,
        diagnostics: {
          source: "mock",
          hasSupabaseUrl: env.hasSupabaseUrl,
          hasSupabaseAnonKey: env.hasSupabaseAnonKey,
          queryExecuted: true,
          registrosRetornados: 0,
          firstRowColumns: [],
          supabaseError,
          fallbackReason: "query com erro",
          smoke
        }
      };
    }

    if (!Array.isArray(data)) {
      console.log("[Orcamentos][Fallback] payload invalido retornado pelo Supabase.", {
        payloadType: typeof data
      });
      return {
        rows: null,
        diagnostics: {
          source: "mock",
          hasSupabaseUrl: env.hasSupabaseUrl,
          hasSupabaseAnonKey: env.hasSupabaseAnonKey,
          queryExecuted: true,
          registrosRetornados: 0,
          firstRowColumns: [],
          supabaseError: "Payload invalido retornado pelo Supabase",
          fallbackReason: "payload invalido",
          smoke
        }
      };
    }

    const proposalRows = data as SupabasePropostaRow[];
    const proposalIds = uniqueTiposCobranca(
      proposalRows
        .map((row) => row.id_int)
        .filter((value): value is number | string | bigint => value !== null && value !== undefined)
        .map((value) => String(value))
    );

    const paymentMap = new Map<string, string[]>();

    if (proposalIds.length) {
      console.log("[Orcamentos][Query]", {
        table: "pagamentos_v2",
        select: "id_int,tipo_cobranca",
        filter: `id_int in (${proposalIds.join(",")})`
      });

      const { data: paymentData, error: paymentError } = await client
        .from("pagamentos_v2")
        .select("id_int,tipo_cobranca")
        .in("id_int", proposalIds)
        .returns<SupabasePagamentoTipoCobrancaRow[]>();

      if (paymentError) {
        console.log("[Orcamentos][PagamentosV2Error]", {
          message: paymentError instanceof Error ? paymentError.message : String(paymentError)
        });
      } else if (Array.isArray(paymentData)) {
        paymentData.forEach((row) => {
          const idInt = row.id_int === null || row.id_int === undefined ? "" : String(row.id_int);
          const tipo = normalizeTipoCobranca(row.tipo_cobranca);
          if (!idInt || !tipo) {
            return;
          }

          const current = paymentMap.get(idInt) ?? [];
          if (!current.includes(tipo)) {
            paymentMap.set(idInt, [...current, tipo]);
          }
        });
      }
    }

    const enrichedRows = proposalRows.map((row) => ({
      ...row,
      tipos_cobranca: paymentMap.get(String(row.id_int ?? "")) ?? []
    }));

    console.log("[Orcamentos][SupabaseRows]", {
      registros: enrichedRows.length,
      colunas: enrichedRows.length ? Object.keys(enrichedRows[0]).sort() : [],
      primeiroIdInt: enrichedRows.length ? (enrichedRows[0] as SupabasePropostaRow).id_int ?? null : null,
      pagamentosAgrupados: Array.from(paymentMap.entries()).slice(0, 5).map(([idInt, tipos]) => ({
        idInt,
        tipos,
        label: joinTiposCobranca(tipos)
      }))
    });

    return {
      rows: enrichedRows as SupabasePropostaRow[],
      diagnostics: {
        source: "supabase",
        hasSupabaseUrl: env.hasSupabaseUrl,
        hasSupabaseAnonKey: env.hasSupabaseAnonKey,
        clientImportPath: "@/lib/supabase/client",
        clientShape,
        queryExecuted: true,
        registrosRetornados: enrichedRows.length,
        firstRowColumns: enrichedRows.length ? Object.keys(enrichedRows[0]).sort() : [],
        supabaseError: null,
        fallbackReason: enrichedRows.length === 0 ? "sem registros" : null,
        smoke
      }
    };
  } catch {
    console.log("[Orcamentos][Fallback] excecao ao consultar Supabase.", { motivo: "fetch ou query falhou" });
    return {
      rows: null,
      diagnostics: {
        source: "mock",
        hasSupabaseUrl: env.hasSupabaseUrl,
        hasSupabaseAnonKey: env.hasSupabaseAnonKey,
        clientImportPath: "@/lib/supabase/client",
        clientShape,
        queryExecuted: true,
        registrosRetornados: 0,
        firstRowColumns: [],
        supabaseError: "Excecao ao consultar Supabase",
        fallbackReason: "excecao na consulta",
        smoke: {
          resultExists: false,
          resultKeys: [],
          dataIsArray: false,
          dataCount: 0,
          firstIdInts: [],
          errorMessage: "Excecao no smoke/query",
          status: null,
          statusText: null
        }
      }
    };
  }
}

function detectColumns(rows: SupabasePropostaRow[]) {
  return rows.length ? Object.keys(rows[0]).sort() : [];
}

function buildRealResult(rows: SupabasePropostaRow[]): OrcamentosReadResult | null {
  const propostas = mapSupabasePropostaRowsToListItems(rows);

  if (!propostas.length) {
    console.log("[Orcamentos][Fallback] mapper retornou lista vazia.", {
      registrosOriginais: rows.length,
      colunas: rows.length ? Object.keys(rows[0]).sort() : []
    });
    return null;
  }

  console.log("[Orcamentos][Mapper]", {
    propostasMapeadas: propostas.length,
    primeiroIdInt: propostas[0]?.id_int ?? null,
    source: "supabase"
  });

  return {
    source: "supabase",
    propostas,
    warnings: [
      `Leitura real aplicada em public.propostas com ${propostas.length} registros.`,
      `Colunas detectadas: ${detectColumns(rows).join(", ")}`
    ],
    detectedColumns: detectColumns(rows),
    diagnostics: {
      source: "supabase",
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      clientImportPath: "@/lib/supabase/client",
      clientShape: "from:sim; returns:sim",
      queryExecuted: true,
      registrosRetornados: rows.length,
      firstRowColumns: rows.length ? Object.keys(rows[0]).sort() : [],
      supabaseError: null,
      fallbackReason: null,
      smoke: {
        resultExists: true,
        resultKeys: ["data", "error"],
        dataIsArray: true,
        dataCount: rows.length,
        firstIdInts: rows.slice(0, 5).map((row) => normalizeSmokeIdInt(row.id_int)),
        errorMessage: null,
        status: null,
        statusText: null
      }
    }
  };
}

function buildEmptyRealResult(
  rows: SupabasePropostaRow[],
  periodo: string,
  fetched: { diagnostics: Partial<OrcamentosDiagnostics> }
) {
  const periodoFilter = buildPeriodoFilter(periodo);

  return {
    source: "supabase",
    propostas: [],
    warnings: [
      periodoFilter
        ? `Nenhuma proposta encontrada para o período ${periodoFilter.periodoKey}.`
        : "Nenhuma proposta encontrada na consulta atual."
    ],
    detectedColumns: detectColumns(rows),
    diagnostics: {
      source: "supabase",
      hasSupabaseUrl: fetched.diagnostics.hasSupabaseUrl ?? Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasSupabaseAnonKey:
        fetched.diagnostics.hasSupabaseAnonKey ?? Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      clientImportPath: fetched.diagnostics.clientImportPath ?? "@/lib/supabase/client",
      clientShape: fetched.diagnostics.clientShape ?? "desconhecido",
      queryExecuted: fetched.diagnostics.queryExecuted ?? true,
      registrosRetornados: fetched.diagnostics.registrosRetornados ?? rows.length,
      firstRowColumns: fetched.diagnostics.firstRowColumns ?? detectColumns(rows),
      supabaseError: fetched.diagnostics.supabaseError ?? null,
      fallbackReason: "sem registros",
      smoke: {
        resultExists: true,
        resultKeys: ["data", "error"],
        dataIsArray: true,
        dataCount: rows.length,
        firstIdInts: [],
        errorMessage: null,
        status: null,
        statusText: null
      }
    }
  } satisfies OrcamentosReadResult;
}

export async function getOrcamentosReadOnlyData(periodo = "all"): Promise<OrcamentosReadResult> {
  const fetched = await fetchPropostaRows(periodo);
  const rows = fetched.rows;

  if (!rows) {
    return buildMockResult([
      "Supabase ausente ou consulta falhou. Fallback mock ativado para a lista de orcamentos."
    ], fetched.diagnostics as Partial<OrcamentosDiagnostics>);
  }

  if (!rows.length) {
    if (periodo !== "all") {
      return buildEmptyRealResult(rows, periodo, fetched as { diagnostics: Partial<OrcamentosDiagnostics> });
    }

    return buildMockResult([
      "A tabela public.propostas retornou 0 registros. Fallback mock ativado."
    ], {
      ...fetched.diagnostics,
      fallbackReason: "sem registros",
      registrosRetornados: 0,
      source: "mock"
    });
  }

  const real = buildRealResult(rows);
  if (!real) {
    return buildMockResult([
      "Falha ao mapear propostas do Supabase. Fallback mock ativado."
    ], fetched.diagnostics as Partial<OrcamentosDiagnostics>);
  }

  return {
    ...real,
    diagnostics: {
      ...fetched.diagnostics,
      source: "supabase",
      fallbackReason: null
    }
  };
}

export async function getPropostaDetailById(idInt: number): Promise<Proposta | null> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[OrcamentosService] Supabase client não inicializado. Carregando mock.");
    return propostasMock.find((p) => p.id_int === idInt) || null;
  }

  try {
    // 1. Fetch proposal row
    const { data: proposalRow, error: proposalError } = await client
      .from("propostas")
      .select("*")
      .eq("id_int", idInt)
      .single();

    if (proposalError || !proposalRow) {
      console.warn(`[OrcamentosService] Proposta #${idInt} não encontrada no banco. Usando mock.`);
      return propostasMock.find((p) => p.id_int === idInt) || null;
    }

    // 2. Fetch items
    const { data: itemRows, error: itemsError } = await client
      .from("produtos_proposta")
      .select("*")
      .eq("id_int", idInt)
      .returns<SupabaseProdutoPropostaRow[]>();

    if (itemsError) {
      console.error("[OrcamentosService] Erro ao buscar itens da proposta:", itemsError);
    }

    const items = itemRows || [];

    // 3. Fetch variations for all items of this proposal
    let variationRows: SupabaseProdutoPropostaVariacaoRow[] = [];
    if (items.length > 0) {
      const itemIds = items.map((it) => it.id);
      const { data: varRows, error: varError } = await client
        .from("produtos_proposta_variacao")
        .select("*")
        .in("id_produto_proposta", itemIds)
        .returns<SupabaseProdutoPropostaVariacaoRow[]>();

      if (varError) {
        console.error("[OrcamentosService] Erro ao buscar variações dos itens:", varError);
      } else if (varRows) {
        variationRows = varRows;
      }
    }

    // 4. Fetch customer details
    const { cadastro } = await getCadastroCompleto(proposalRow.id_cliente);
    
    // Construct fallback customer if not found in db
    const fallbackCliente: Cadastro = {
      id: `cli_${proposalRow.id_cliente}`,
      idCliente: proposalRow.id_cliente,
      nome: proposalRow.cliente || "Cliente Não Informado",
      categoria: "CLIENTE",
      documento: "",
      tipoPessoa: "FISICA",
      cidadeUf: "",
      vendedor: proposalRow.vendedor || "",
      ativo: true,
      restricao: false,
      verificado: false,
      riscoCredito: "BAIXO",
      limiteCredito: 0,
      creditoDisponivel: 0,
      padraoPagamento: "",
      ultimaCompra: "",
      totalCompras: 0,
      whatsapp: "",
      email: "",
      empresaPadrao: proposalRow.empresa || "",
      observacoes: "",
      enderecos: [],
      contatos: [],
      vinculosComerciais: []
    };

    const clientObj = cadastro || fallbackCliente;

    // Resolve contact and address
    let contact = clientObj.contatos.find((c) => c.nome === proposalRow.contato);
    if (!contact) {
      contact = clientObj.contatos[0] || {
        id: "cont_default",
        nome: proposalRow.contato || "Contato Principal",
        cargo: "Representante",
        whatsapp: "",
        email: ""
      };
    }

    let address = clientObj.enderecos.find((e) => e.cep === proposalRow.cep);
    if (!address) {
      address = clientObj.enderecos.find((e) => e.tipo === "entrega" || e.tipo === "principal") || clientObj.enderecos[0] || {
        id: "end_default",
        tipo: "principal",
        cep: proposalRow.cep || "",
        endereco: "Endereço principal",
        numero: "",
        bairro: "",
        cidade: "",
        uf: ""
      };
    }

    // Fetch global variations to get their nice names
    const globalVars = await listVariacoesGlobais();

    // Map database items and variations to UI PropostaItem
    const mappedItens: PropostaItem[] = [];

    for (const item of items) {
      const product = await getProdutoByIdProduto(item.id_produto);
      const fallbackProduct: Produto = {
        id: `prod_${item.id_produto}`,
        created_at: null,
        id_produto: item.id_produto,
        nomeReal: item.nome_produto || "Produto Desconhecido",
        categoria: "OUTROS",
        formato: item.modelo_descri || "",
        valorUnt: item.valor_base ?? item.valor_unt ?? 0,
        valorFixo: item.fixo ?? 0,
        valor_custo: 0,
        peso: item.peso_base ?? item.peso_uni ?? 0,
        prazo: "",
        nivelSeg: "NORMAL",
        fraseCons: "",
        descricao: "",
        personalizacao: "",
        apelidos: [],
        ativo: true,
        is_estoque: false,
        is_variacao: false,
        is_multiplo: false,
        cod_beneficio: "",
        ncm: item.ncm || "",
        descri_ncm: "",
        cest: "",
        origem: "",
        cod_origem: null,
        cod_bar: "",
        und_medida: "UN",
        cfop_interno: "",
        cfop_interestadual: "",
        unidade_comercial: "",
        unidade_tributavel: "",
        icms_origem: "",
        icms_situacao_tributaria: "",
        pis_situacao_tributaria: "",
        cofins_situacao_tributaria: "",
        informacoes_fiscais: "",
        fotos: [],
        variacoes: []
      };

      const finalProduct = product || fallbackProduct;

      // Extract variations selected for this item
      const itemVars = variationRows.filter((v) => v.id_produto_proposta === item.id);
      const variacoesEscolhidas: PropostaVariacaoEscolhida[] = itemVars.map((v) => {
        const globalVar = globalVars.find((gv) => gv.id_variacao === v.id_variacao);
        return {
          id: `pv_sel_${v.id}`,
          id_variacao: v.id_variacao,
          variacao: {
            id_variacao: v.id_variacao,
            nome: globalVar ? globalVar.nome : `Variação ${v.id_variacao}`,
            descricao: globalVar ? globalVar.descricao : "",
            is_ativo: globalVar ? globalVar.is_ativo : true
          },
          tipo: {
            id: String(v.id_tipo_variacao),
            id_variacao: v.id_variacao,
            variacao: v.nome_variacao || "",
            v_extra: Number(v.v_extra ?? 0),
            peso: Number(v.peso_uni ?? 0),
            ref: "",
            is_ativo: true
          }
        };
      });

      mappedItens.push({
        id: `item_${item.id}`,
        id_produto: item.id_produto,
        produto: finalProduct,
        nome: item.nome_produto || finalProduct.nomeReal,
        formato: finalProduct.formato || "",
        descricaoModelo: item.modelo_descri || "",
        quantidade: item.qtd || 0,
        valorUnitario: item.valor_unt || 0,
        valorFixo: item.fixo || 0,
        descontoTipo: "VALOR",
        descontoValor: 0,
        subtotalBruto: (item.valor_unt || 0) * (item.qtd || 0) + (item.fixo || 0),
        descontoValorCalculado: 0,
        acrescimoBonus: 0,
        subtotal: item.valor_sub_total || 0,
        prazo: finalProduct.prazo || "7 dias",
        pesoUnitario: item.peso_uni || 0,
        pesoTotal: item.peso_total || 0,
        variacoesEscolhidas
      });
    }

    // Determine status mapping
    const status = (proposalRow.status_interno || "NOVO") as PropostaStatus;

    // Reconstruct freight options
    let fretes: PropostaFrete[] = [];
    try {
      const realFretes = await listarCotacoesFrete(idInt);
      if (realFretes && realFretes.length > 0) {
        fretes = realFretes;
      }
    } catch (e) {
      console.error("[OrcamentosService] Erro ao listar cotacoes do banco, usando fallback mock:", e);
    }

    if (fretes.length === 0) {
      const rawFreteValor = Number(proposalRow.valor_frete ?? 0);
      const rawFreteEscolhido = proposalRow.frete_escolhido || "RETIRADA";

      fretes = [
        {
          id: "frete_retirada",
          id_int: idInt,
          transportadora: "Retirada Local",
          servico: "Retira na Fábrica",
          valor: rawFreteEscolhido === "RETIRADA" ? rawFreteValor : 0,
          prazo: "Imediato",
          observacao: "Sem custo de entrega",
          escolhido: rawFreteEscolhido === "RETIRADA",
          pesoUsado: 0
        },
        {
          id: "frete_sedex",
          id_int: idInt,
          transportadora: "Correios SEDEX",
          servico: "Entrega Expressa",
          valor: rawFreteEscolhido === "SEDEX" ? rawFreteValor : 80,
          prazo: "1 a 3 dias úteis",
          observacao: "Entrega rápida pelos Correios",
          escolhido: rawFreteEscolhido === "SEDEX",
          pesoUsado: 0
        },
        {
          id: "frete_pac",
          id_int: idInt,
          transportadora: "Correios PAC",
          servico: "Entrega Econômica",
          valor: rawFreteEscolhido === "PAC" ? rawFreteValor : 45,
          prazo: "5 a 10 dias úteis",
          observacao: "Entrega econômica pelos Correios",
          chosen: rawFreteEscolhido === "PAC", // Compatibility
          escolhido: rawFreteEscolhido === "PAC",
          pesoUsado: 0
        },
        {
          id: "frete_transportadora",
          id_int: idInt,
          transportadora: "Transportadora Parceira",
          servico: "Entrega Padrão",
          valor: !["RETIRADA", "SEDEX", "PAC"].includes(rawFreteEscolhido) ? rawFreteValor : 120,
          prazo: "4 a 7 dias úteis",
          observacao: "Transportadora parceira do ERP",
          escolhido: !["RETIRADA", "SEDEX", "PAC"].includes(rawFreteEscolhido),
          pesoUsado: 0
        }
      ];
    }

    const chosenFrete = fretes.find((f) => f.escolhido) || fretes[0];
    const freteEscolhidoId = chosenFrete ? chosenFrete.id : "";
    const freteValor = chosenFrete ? chosenFrete.valor : 0;

    // Calculate totals
    const subtotalProdutos = mappedItens.reduce((sum, it) => sum + it.subtotal, 0);
    const pesoTotal = mappedItens.reduce((sum, it) => sum + it.pesoTotal, 0);
    const valorTotal = subtotalProdutos + freteValor;

    const proposta: Proposta = {
      id: `prop_${idInt}`,
      id_int: idInt,
      cliente: clientObj,
      contato: contact,
      enderecoEntrega: address,
      compradorAutorizado: undefined,
      empresa: proposalRow.empresa || "Ideal Grafica",
      vendedor: proposalRow.vendedor || "Não informado",
      data: proposalRow.created_at || new Date().toISOString(),
      status,
      itens: mappedItens,
      fretes,
      freteEscolhidoId,
      resumo: {
        subtotalBrutoProdutos: subtotalProdutos,
        descontosIndividuais: 0,
        acrescimoBonus: 0,
        subtotalProdutos,
        descontoGeralTipo: "VALOR",
        descontoGeralValor: 0,
        descontoGeral: 0,
        frete: freteValor,
        valorTotal,
        pesoTotal,
        prazoProducao: "7 dias",
        prazoEntrega: chosenFrete.prazo
      },
      descontoGeralTipo: "VALOR",
      descontoGeralValor: 0,
      formaPagamento: proposalRow.forma_pagamento || "A combinar",
      cobrancaStatus: "NAO_GERADA",
      observacoes: proposalRow.obs_proposta || ""
    };

    return proposta;
  } catch (err) {
    console.error(`[OrcamentosService] Erro ao carregar proposta #${idInt} real:`, err);
    return propostasMock.find((p) => p.id_int === idInt) || null;
  }
}

export async function saveProposta(formState: PropostaFormState): Promise<{
  success: boolean;
  id_int?: number;
  errorMessage?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponível." };
  }

  try {
    // 1. Fetch customer to get customer's name
    const { cadastro } = await getCadastroCompleto(formState.clienteId);
    const clienteNome = cadastro ? cadastro.nome : "Cliente Desconhecido";

    // Find the contact selected
    const selectedContact = cadastro?.contatos.find((c) => c.id === formState.contatoId);
    const contatoNome = selectedContact ? selectedContact.nome : (formState.contatoId || "");

    // Find the address selected
    const selectedAddress = cadastro?.enderecos.find((e) => e.id === formState.enderecoId);
    const cepText = selectedAddress ? selectedAddress.cep : "";

    // Find the chosen freight option details
    const chosenFrete = formState.fretes.find((f) => f.id === formState.freteEscolhidoId);
    const freteValor = chosenFrete ? chosenFrete.valor : 0;
    
    // Map internal freight name
    let freteNome = "RETIRADA";
    if (chosenFrete) {
      if (chosenFrete.id === "frete_sedex" || chosenFrete.transportadora.toUpperCase().includes("SEDEX")) {
        freteNome = "SEDEX";
      } else if (chosenFrete.id === "frete_pac" || chosenFrete.transportadora.toUpperCase().includes("PAC")) {
        freteNome = "PAC";
      } else if (chosenFrete.id === "frete_retirada" || chosenFrete.transportadora.toUpperCase().includes("RETIRA")) {
        freteNome = "RETIRADA";
      } else {
        freteNome = chosenFrete.transportadora;
      }
    }

    // Calculo de valores totais
    const resumo = calculateResumo(
      formState.itens,
      formState.fretes,
      Number(formState.descontoGeralValor) || 0,
      formState.descontoGeralTipo
    );
    const subtotalProdutos = resumo.subtotalProdutos;
    const valorTotal = resumo.valorTotal;

    // Generate informal WhatsApp text
    const informalText = buildPropostaInformalText({
      id_int: formState.id_int || "NOVO",
      clienteNome,
      itens: formState.itens,
      frete: chosenFrete,
      resumo,
      formaPagamento: formState.formaPagamento || "A combinar"
    });

    const isUpdate = formState.id_int && Number.isInteger(Number(formState.id_int));
    let id_int = isUpdate ? Number(formState.id_int) : null;

    const propostaData = {
      id_cliente: Number(formState.clienteId),
      cliente: clienteNome,
      empresa: formState.empresa,
      vendedor: formState.vendedor,
      status_interno: formState.status,
      valor: subtotalProdutos,
      valor_total: valorTotal,
      obs_proposta: formState.observacoes,
      texto_whatsapp: informalText,
      frete_escolhido: freteNome,
      valor_frete: freteValor,
      contato: contatoNome,
      cep: cepText,
      is_avulso: false
    };

    if (isUpdate) {
      // 2a. UPDATE PROPOSTA
      const { error: updateError } = await client
        .from("propostas")
        .update(propostaData)
        .eq("id_int", id_int!);

      if (updateError) {
        throw new Error(`Erro ao atualizar proposta no banco: ${updateError.message}`);
      }
    } else {
      // 2b. INSERT PROPOSTA
      const { data: newProp, error: insertError } = await client
        .from("propostas")
        .insert(propostaData)
        .select("id_int")
        .single();

      if (insertError || !newProp) {
        throw new Error(`Erro ao criar proposta no banco: ${insertError?.message || "Sem retorno de ID"}`);
      }

      id_int = Number(newProp.id_int);
    }

    // 3. RECONCILE ITEMS in public.produtos_proposta
    // Fetch existing items for this proposal
    const { data: existingItems, error: fetchItemsError } = await client
      .from("produtos_proposta")
      .select("id")
      .eq("id_int", id_int!);

    if (fetchItemsError) {
      console.error("[OrcamentosService] Erro ao carregar itens existentes para conciliação:", fetchItemsError);
    }

    const existingIds = (existingItems || []).map((it) => it.id);
    const incomingItemIds: number[] = [];

    for (const item of formState.itens) {
      // Check if it is an existing item
      const parsedItemId = item.id.startsWith("item_") ? Number(item.id.replace("item_", "")) : null;
      const isExistingItem = parsedItemId && existingIds.includes(parsedItemId);

      // Calculos de peso e valor extra
      const pesoExtra = item.variacoesEscolhidas.reduce((sum, v) => sum + (v.tipo.peso || 0), 0);
      const pesoBase = Math.max(0, (item.produto.peso || 0));
      const pesoUni = pesoBase + pesoExtra;

      const valorExtra = item.variacoesEscolhidas.reduce((sum, v) => sum + (v.tipo.v_extra || 0), 0);
      const valorBase = Math.max(0, (item.produto.valorUnt || 0));
      const valorUnt = valorBase + valorExtra;

      const itemData = {
        id_int: id_int!,
        id_produto: item.id_produto,
        nome_produto: item.nome,
        modelo_descri: item.descricaoModelo,
        valor_unt: valorUnt,
        qtd: item.quantidade,
        fixo: item.valorFixo,
        valor_sub_total: item.subtotal,
        peso_uni: pesoUni,
        peso_total: pesoUni * item.quantidade,
        peso_base: pesoBase,
        peso_extra: pesoExtra,
        valor_base: valorBase,
        valor_extra: valorExtra,
        ncm: item.produto.nivelSeg || null,
        cfop: null
      };

      let dbItemId: number;

      if (isExistingItem) {
        // Update item
        dbItemId = parsedItemId!;
        const { error: itemUpdateError } = await client
          .from("produtos_proposta")
          .update(itemData)
          .eq("id", dbItemId);

        if (itemUpdateError) {
          throw new Error(`Erro ao atualizar item #${dbItemId} da proposta: ${itemUpdateError.message}`);
        }
        incomingItemIds.push(dbItemId);
      } else {
        // Insert item
        const { data: newItem, error: itemInsertError } = await client
          .from("produtos_proposta")
          .insert(itemData)
          .select("id")
          .single();

        if (itemInsertError || !newItem) {
          throw new Error(`Erro ao inserir item na proposta: ${itemInsertError?.message || "Sem ID de retorno"}`);
        }

        dbItemId = newItem.id;
        incomingItemIds.push(dbItemId);
      }

      // 4. PERSIST VARIATIONS for this item in public.produtos_proposta_variacao
      // A. Delete old variations for this item
      const { error: deleteVarsError } = await client
        .from("produtos_proposta_variacao")
        .delete()
        .eq("id_produto_proposta", dbItemId);

      if (deleteVarsError) {
        console.error(`[OrcamentosService] Erro ao deletar variações antigas do item #${dbItemId}:`, deleteVarsError);
      }

      // B. Insert new variations (snapshot historical)
      if (item.variacoesEscolhidas.length > 0) {
        const variationsToInsert = item.variacoesEscolhidas.map((escolha) => ({
          id_produto_proposta: dbItemId,
          id_variacao: escolha.id_variacao,
          id_tipo_variacao: Number(escolha.tipo.id),
          nome_variacao: escolha.tipo.variacao,
          v_extra: escolha.tipo.v_extra,
          peso_uni: escolha.tipo.peso
        }));

        const { error: insertVarsError } = await client
          .from("produtos_proposta_variacao")
          .insert(variationsToInsert);

        if (insertVarsError) {
          throw new Error(`Erro ao gravar variações do item #${dbItemId}: ${insertVarsError.message}`);
        }
      }
    }

    // 5. DELETE removed items
    const deletedItemIds = existingIds.filter((id) => !incomingItemIds.includes(id));
    if (deletedItemIds.length > 0) {
      const { error: deleteRemovedVarsError } = await client
        .from("produtos_proposta_variacao")
        .delete()
        .in("id_produto_proposta", deletedItemIds);

      if (deleteRemovedVarsError) {
        console.error("[OrcamentosService] Erro ao deletar variações dos itens excluídos:", deleteRemovedVarsError);
      }

      const { error: deleteRemovedItemsError } = await client
        .from("produtos_proposta")
        .delete()
        .in("id", deletedItemIds);

      if (deleteRemovedItemsError) {
        throw new Error(`Erro ao excluir itens removidos da proposta: ${deleteRemovedItemsError.message}`);
      }
    }

    return { success: true, id_int: id_int! };
  } catch (err) {
    console.error("[OrcamentosService] Falha ao salvar proposta:", err);
    const msg = err instanceof Error ? err.message : "Erro interno desconhecido.";
    return { success: false, errorMessage: msg };
  }
}


