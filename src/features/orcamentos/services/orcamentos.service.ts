import { getSupabaseClient } from "@/lib/supabase/client";
import { propostasMock } from "@/lib/mocks/propostas.mock";
import type {
  SupabasePagamentoTipoCobrancaRow,
  SupabasePropostaRow
} from "@/features/orcamentos/types.supabase";
import {
  mapMockPropostaToListItem,
  mapSupabasePropostaRowsToListItems,
  type OrcamentoListItem,
  type OrcamentoListSource
} from "@/features/orcamentos/mappers";

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
  const smokeQuery = hasFrom ? client.from("propostas").select("id_int").limit(5) : null;
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
        smokeError instanceof Error
          ? smokeError.message
          : typeof smokeError?.message === "string"
            ? smokeError.message
            : typeof smokeError === "string"
              ? smokeError
            : smokeError
              ? JSON.stringify(smokeError)
              : null,
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
      const supabaseError =
        error instanceof Error
          ? error.message
          : typeof error?.message === "string"
            ? error.message
          : typeof error === "string"
            ? error
            : "Erro desconhecido no Supabase";
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
        firstIdInts: rows.slice(0, 5).map((row) => row.id_int ?? null),
        errorMessage: null,
        status: null,
        statusText: null
      }
    }
  };
}

function buildEmptyRealResult(rows: SupabasePropostaRow[], periodo: string, fetched: { diagnostics: OrcamentosDiagnostics }) {
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
      ...fetched.diagnostics,
      source: "supabase",
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
    ], fetched.diagnostics);
  }

  if (!rows.length) {
    if (periodo !== "all") {
      return buildEmptyRealResult(rows, periodo, fetched);
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
      "A consulta em public.propostas retornou dados, mas o mapeamento da lista ficou vazio. Fallback mock ativado."
    ], {
      ...fetched.diagnostics,
      fallbackReason: "mapper retornou vazio",
      source: "mock"
    });
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

