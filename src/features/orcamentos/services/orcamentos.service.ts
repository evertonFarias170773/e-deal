import { getSupabaseClient } from "@/lib/supabase/client";
import { calculateResumo } from "@/features/orcamentos/orcamento-utils";
import type {
  SupabasePagamentoTipoCobrancaRow,
  SupabasePropostaRow,
  SupabaseProdutoPropostaRow,
  SupabaseProdutoPropostaVariacaoRow
} from "@/features/orcamentos/types.supabase";
import {
  mapSupabasePropostaRowsToListItems,
  type OrcamentoListItem,
  type OrcamentoListSource
} from "@/features/orcamentos/mappers";
import { getCadastroCompleto } from "@/features/cadastros/services/cadastros.service";
import { getProdutoByIdProduto } from "@/features/produtos/services/produtos.service";
import { listVariacoesGlobais } from "@/features/produtos/services/produto-variacoes.service";
import { buildPropostaInformalText } from "@/features/orcamentos/orcamento-utils";
import { listarCotacoesFrete } from "@/features/orcamentos/services/frete.service";
import type { Cadastro, CadastroEndereco } from "@/features/cadastros/types";
import type { Produto } from "@/features/produtos/types";
import type {
  Proposta,
  PropostaFormState,
  PropostaItem,
  PropostaVariacaoEscolhida,
  PropostaFrete,
  PropostaStatus,
  TipoDescontoProposta
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
  const clientShape = `from:${hasFrom ? "sim" : "nao"}`;
  const periodoFilter = buildPeriodoFilter(periodo);
  const queryLimit = periodoFilter ? 1000 : limit;

  const smoke: OrcamentosSmokeDiagnostics = {
    resultExists: false,
    resultKeys: [],
    dataIsArray: false,
    dataCount: 0,
    firstIdInts: [],
    errorMessage: null,
    status: null,
    statusText: null
  };

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
        smoke
      }
    };
  }

  try {
    const columnsToSelect = "id, id_int, id_cliente, cliente, created_at, updated_at, vendedor, status_interno, valor_total, valor, is_avulso, empresa, valor_frete";

    console.log("[Orcamentos][Query]", {
      table: "propostas",
      select: columnsToSelect,
      orderBy: "id_int.desc",
      limit: queryLimit,
      periodoSelecionado: periodoFilter?.periodoKey ?? "all",
      campoData: "created_at",
      inicioIso: periodoFilter?.inicioIso ?? null,
      fimExclusivoIso: periodoFilter?.fimExclusivoIso ?? null
    });

    let query = client
      .from("propostas")
      .select(columnsToSelect)
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
    return {
      source: "supabase",
      propostas: [],
      warnings: [
        "A conexão com o banco de dados Supabase falhou na leitura real das propostas."
      ],
      detectedColumns: [],
      errorMessage: fetched.diagnostics.supabaseError || "Erro de conexão com o banco de dados Supabase",
      diagnostics: fetched.diagnostics as OrcamentosDiagnostics
    };
  }

  if (!rows.length) {
    return buildEmptyRealResult(rows, periodo, fetched as { diagnostics: Partial<OrcamentosDiagnostics> });
  }

  const real = buildRealResult(rows);
  if (!real) {
    return {
      source: "supabase",
      propostas: [],
      warnings: [
        "Falha ao mapear propostas do Supabase."
      ],
      detectedColumns: [],
      errorMessage: "Erro ao processar mapeamento das propostas",
      diagnostics: fetched.diagnostics as OrcamentosDiagnostics
    };
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
    console.warn("[OrcamentosService] Supabase client não inicializado.");
    return null;
  }

  try {
    // 1. Fetch proposal row
    const { data: proposalRow, error: proposalError } = await client
      .from("propostas")
      .select("*")
      .eq("id_int", idInt)
      .single();

    if (proposalError || !proposalRow) {
      console.warn(`[OrcamentosService] Proposta #${idInt} não encontrada no banco.`);
      return null;
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

    const isClienteNaoCadastrado = proposalRow.id_cliente === null || proposalRow.id_cliente === undefined || Number(proposalRow.id_cliente) === 0;

    // 4. Fetch customer details
    const { cadastro } = !isClienteNaoCadastrado
      ? await getCadastroCompleto(proposalRow.id_cliente)
      : { cadastro: null };
    
    // Construct fallback customer if not found in db
    const fallbackCliente: Cadastro = {
      id: isClienteNaoCadastrado ? "cli_nao_cadastrado" : `cli_${proposalRow.id_cliente}`,
      idCliente: (isClienteNaoCadastrado ? null : proposalRow.id_cliente) as unknown as number,
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

    // Resolve address: prioritise id_endereco_ent (exact ID match)
    let address: CadastroEndereco | undefined;

    if (proposalRow.id_endereco_ent) {
      // 1. Try to find in client's already-loaded enderecos
      address = clientObj.enderecos.find((e) => e.id === proposalRow.id_endereco_ent);

      if (!address) {
        // 2. Fetch directly from enderecos by id (handles comprador addresses or other cases)
        const { data: endData } = await client
          .from("enderecos")
          .select("id, cep, endereco, numero, complemento, bairro, cidade, uf, tipo_endereco, recebedor, cpf_recebedor")
          .eq("id", proposalRow.id_endereco_ent)
          .maybeSingle();

        if (endData) {
          address = {
            id: endData.id,
            cep: endData.cep || "",
            endereco: endData.endereco || "",
            numero: endData.numero || "",
            complemento: endData.complemento || "",
            bairro: endData.bairro || "",
            cidade: endData.cidade || "",
            uf: endData.uf || "",
            tipo: ((endData.tipo_endereco ?? "").toLowerCase() as CadastroEndereco["tipo"]) || "entrega",
            recebedor: endData.recebedor || undefined,
            cpfRecebedor: endData.cpf_recebedor || undefined,
          };
        }
      }
    }

    // 3. Fall back to CEP match
    if (!address) {
      address = clientObj.enderecos.find((e) => e.cep === proposalRow.cep);
    }

    // 4. Last resort: first address or empty placeholder
    if (!address) {
      address = clientObj.enderecos.find((e) => e.tipo === "entrega" || e.tipo === "principal") ||
        clientObj.enderecos[0] || {
          id: "end_default",
          tipo: "principal" as CadastroEndereco["tipo"],
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
        cfop_interno: item.cfop || "",
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

      const finalProduct = product
        ? {
            ...product,
            ncm: item.ncm || product.ncm || "",
            cfop_interno: item.cfop || product.cfop_interno || ""
          }
        : fallbackProduct;

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
        id_produto_proposta_origem: Number(item.id),
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
    const subtotalProdutos = proposalRow.is_avulso
      ? Number(proposalRow.valor ?? 0)
      : mappedItens.reduce((sum, it) => sum + it.subtotal, 0);

    // Fetch discount
    let descontoGeralTipo: "VALOR" | "PERCENTUAL" = "VALOR";
    let descontoGeralValor = 0;
    let descontoGeralCalculado = 0;

    const { data: discountRow, error: discountError } = await client
      .from("desconto_proposta")
      .select("*")
      .eq("id_int", idInt)
      .eq("tipo_desconto", "DESCONTO_GERAL")
      .maybeSingle();

    if (discountError) {
      console.error("[OrcamentosService] Erro ao buscar desconto da proposta:", discountError);
    } else if (discountRow) {
      const valorPercentual = Number(discountRow.valor_percentual ?? 0);
      const valorNominal = Number(discountRow.valor_nominal ?? 0);

      if (valorPercentual > 0) {
        descontoGeralTipo = "PERCENTUAL";
        descontoGeralValor = valorPercentual;
        descontoGeralCalculado = (subtotalProdutos * valorPercentual) / 100;
      } else {
        descontoGeralTipo = "VALOR";
        descontoGeralValor = valorNominal;
        descontoGeralCalculado = valorNominal;
      }
    }

    const pesoTotal = proposalRow.is_avulso
      ? 0
      : mappedItens.reduce((sum, it) => sum + it.pesoTotal, 0);

    let valorTotal = proposalRow.is_avulso
      ? Number(proposalRow.valor_total ?? (subtotalProdutos + freteValor - descontoGeralCalculado))
      : (subtotalProdutos + freteValor - descontoGeralCalculado);

    // Guardrail: never show only freight as total if there are products
    if (valorTotal === freteValor && subtotalProdutos > 0) {
      valorTotal = subtotalProdutos + freteValor - descontoGeralCalculado;
    }

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
        descontoGeralTipo: descontoGeralTipo,
        descontoGeralValor: descontoGeralValor,
        descontoGeral: descontoGeralCalculado,
        frete: freteValor,
        valorTotal,
        pesoTotal,
        prazoProducao: "7 dias",
        prazoEntrega: chosenFrete.prazo
      },
      descontoGeralTipo: descontoGeralTipo,
      descontoGeralValor: descontoGeralValor,
      formaPagamento: proposalRow.forma_pagamento || "A combinar",
      cobrancaStatus: "NAO_GERADA",
      observacoes: proposalRow.obs_proposta || "",
      is_avulso: proposalRow.is_avulso === true,
      clienteNaoCadastrado: isClienteNaoCadastrado,
      id_faturado: proposalRow.id_faturado ?? null,
    };

    return proposta;
  } catch (err) {
    console.error(`[OrcamentosService] Erro ao carregar proposta #${idInt} real:`, err);
    return null;
  }
}

function isNonEmpty(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
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

  const isUpdate = formState.id_int && Number.isInteger(Number(formState.id_int));
  let id_int: number | null = isUpdate ? Number(formState.id_int) : null;

  if (isUpdate && id_int) {
    // Revalidação de segurança no service antes de salvar
    const { data: billings, error: billingsError } = await client
      .from("pagamentos_v2")
      .select("id")
      .eq("id_int", id_int)
      .limit(1);

    if (billingsError) {
      console.error("Erro ao verificar cobranças antes de salvar proposta:", billingsError);
    } else if (billings && billings.length > 0) {
      return {
        success: false,
        errorMessage: "Esta proposta possui cobrança gerada. Para alterar, exclua primeiro a cobrança pendente."
      };
    }
  }

  try {
    let clienteNome = "";
    let cadastro = null;
    if (formState.clienteNaoCadastrado) {
      if (!isNonEmpty(formState.nomeClienteLivre)) {
        return { success: false, errorMessage: "O nome do cliente/empresa é obrigatório." };
      }
      clienteNome = formState.nomeClienteLivre!;
    } else {
      if (!isNonEmpty(formState.clienteId)) {
        return { success: false, errorMessage: "Cliente é obrigatório e deve possuir cadastro válido." };
      }
      const fetched = await getCadastroCompleto(formState.clienteId);
      cadastro = fetched.cadastro;
      if (!cadastro) {
        return { success: false, errorMessage: "Cliente é obrigatório e deve possuir cadastro válido." };
      }
      clienteNome = cadastro.nome;
    }

    if (!formState.isAvulso) {
      if (!formState.itens || formState.itens.length === 0) {
        return { success: false, errorMessage: "Pelo menos 1 produto é obrigatório." };
      }

      const hasInvalidQty = formState.itens.some((item) => item.quantidade <= 0);
      if (hasInvalidQty) {
        return { success: false, errorMessage: "A quantidade de todos os produtos deve ser maior que 0." };
      }

      const hasInvalidSubtotal = formState.itens.some((item) => item.subtotal <= 0);
      if (hasInvalidSubtotal) {
        return { success: false, errorMessage: "O subtotal de cada produto deve ser maior que R$ 0,00." };
      }
    }

    if (!isNonEmpty(formState.vendedor)) {
      return { success: false, errorMessage: "Selecione um vendedor antes de salvar o orçamento." };
    }

    if (!isNonEmpty(formState.empresa)) {
      return { success: false, errorMessage: "A empresa é obrigatória." };
    }

    // Find the contact selected
    let contatoNome = "";
    if (formState.clienteNaoCadastrado) {
      contatoNome = "Contato Rápido";
    } else {
      if (!isNonEmpty(formState.contatoId)) {
        return { success: false, errorMessage: "Selecione um contato antes de salvar o orçamento." };
      }
      const selectedContact = cadastro?.contatos.find((c) => c.id === formState.contatoId);
      contatoNome = selectedContact ? selectedContact.nome : (formState.contatoId || "");
    }

    // Find the address selected (searching client addresses and comprador addresses if comprador selected)
    let cepText = "";
    if (formState.clienteNaoCadastrado) {
      if (!isNonEmpty(formState.cepLivre)) {
        return { success: false, errorMessage: "O CEP é obrigatório para cálculo de frete." };
      }
      cepText = formState.cepLivre!.replace(/\D/g, "");
      if (cepText.length !== 8) {
        return { success: false, errorMessage: "O CEP informado deve conter 8 dígitos." };
      }
    } else {
      if (!isNonEmpty(formState.enderecoId)) {
        return { success: false, errorMessage: "Selecione um endereço de entrega antes de salvar o orçamento." };
      }
      let compradorAddresses: CadastroEndereco[] = [];
      if (formState.compradorId && cadastro) {
        const vinculo = (cadastro as Cadastro).vinculosComerciais?.find((v) => v.id === formState.compradorId);
        if (vinculo) {
          try {
            const { cadastro: compradorCadastro } = await getCadastroCompleto(vinculo.idClienteRelacionado);
            if (compradorCadastro) {
              compradorAddresses = compradorCadastro.enderecos || [];
            }
          } catch (err) {
            console.error("Erro ao carregar endereços do comprador ao salvar proposta:", err);
          }
        }
      }
      const allAddresses = [...((cadastro as Cadastro)?.enderecos || []), ...compradorAddresses];
      const selectedAddress = allAddresses.find((e) => e.id === formState.enderecoId);
      cepText = selectedAddress ? selectedAddress.cep : "";
    }

    // Find the chosen freight option details
    if (!formState.isAvulso) {
      if (!isNonEmpty(formState.freteEscolhidoId)) {
        return { success: false, errorMessage: "Selecione ou informe o frete antes de salvar o orçamento." };
      }
    }
    const chosenFrete = formState.isAvulso ? undefined : formState.fretes.find((f) => f.id === formState.freteEscolhidoId);
    if (formState.isAvulso) {
      const valFrete = Number(String(formState.valorFreteManual || "").replace(",", "."));
      if (isNaN(valFrete) || valFrete < 0 || String(formState.valorFreteManual || "").trim() === "") {
        return { success: false, errorMessage: "Selecione ou informe o frete antes de salvar o orçamento." };
      }
      if (!isNonEmpty(formState.observacoesFreteManual)) {
        return { success: false, errorMessage: "Selecione ou informe o frete antes de salvar o orçamento." };
      }
    } else {
      if (!chosenFrete) {
        return { success: false, errorMessage: "Selecione ou informe o frete antes de salvar o orçamento." };
      }
    }

    const freteValor = formState.isAvulso
      ? (Number(String(formState.valorFreteManual || "0").replace(",", ".")) || 0)
      : (chosenFrete ? chosenFrete.valor : 0);
    
    // Map internal freight name
    let freteNome = "RETIRADA";
    if (formState.isAvulso) {
      freteNome = formState.observacoesFreteManual || "Frete Manual";
    } else if (chosenFrete) {
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

    // Calculo de valores resumo e totais
    const subtotalProdutosBase = formState.isAvulso
      ? (Number(String(formState.valorProdutosManual || "0").replace(",", ".")) || 0)
      : (formState.itens.reduce((total, item) => total + item.subtotal, 0));

    const resumo = formState.isAvulso ? {
      subtotalProdutos: subtotalProdutosBase,
      subtotalBrutoProdutos: subtotalProdutosBase,
      descontosIndividuais: 0,
      acrescimoBonus: 0,
      descontoGeralTipo: "VALOR" as TipoDescontoProposta,
      descontoGeralValor: 0,
      descontoGeral: 0,
      frete: freteValor,
      valorTotal: subtotalProdutosBase + freteValor,
      pesoTotal: 0,
      prazoProducao: "A combinar",
      prazoEntrega: "A combinar"
    } : calculateResumo(
      formState.itens,
      formState.fretes,
      Number(formState.descontoGeralValor) || 0,
      formState.descontoGeralTipo
    );

    const subtotalProdutos = resumo.subtotalProdutos;
    const valorTotal = resumo.valorTotal;

    if (subtotalProdutos <= 0) {
      return {
        success: false,
        errorMessage: formState.isAvulso
          ? "Informe o valor dos produtos antes de salvar a proposta avulsa."
          : "O subtotal dos produtos deve ser maior que R$ 0,00."
      };
    }
    if (valorTotal <= 0) {
      return { success: false, errorMessage: "O valor total da proposta deve ser maior que R$ 0,00." };
    }

    const hasWeightAndCep = !formState.isAvulso && resumo.pesoTotal > 0 && cepText && isNonEmpty(cepText);
    if (hasWeightAndCep && !chosenFrete) {
      return { success: false, errorMessage: "Selecione ou informe o frete antes de salvar o orçamento." };
    }

    // Generate informal WhatsApp text
    const informalText = buildPropostaInformalText({
      id_int: formState.id_int || "NOVO",
      clienteNome,
      itens: formState.itens,
      frete: formState.isAvulso ? {
        id: "frete_manual",
        id_int: Number(formState.id_int) || 0,
        transportadora: formState.observacoesFreteManual || "Frete Manual",
        servico: "",
        valor: freteValor,
        prazo: "A combinar",
        observacao: "",
        escolhido: true,
        pesoUsado: 0
      } : chosenFrete,
      resumo,
      formaPagamento: formState.formaPagamento || "A combinar",
      isAvulso: formState.isAvulso,
      contatoNome: contatoNome
    });

    if (!isNonEmpty(informalText)) {
      return { success: false, errorMessage: "O texto/resumo informal da proposta é obrigatório." };
    }

    const { data: { session } } = await client.auth.getSession();
    const userId = session?.user?.id;

    if (!isUpdate && !userId) {
      return { success: false, errorMessage: "Usuário não identificado. Faça login novamente antes de criar a proposta." };
    }

    let id_faturado: number | null = null;
    if (!formState.clienteNaoCadastrado && cadastro) {
      const vinculo = (cadastro as Cadastro).vinculosComerciais?.find((v) => v.id === formState.compradorId);
      if (vinculo) {
        id_faturado = vinculo.idClienteRelacionado;
      } else {
        id_faturado = Number(formState.clienteId);
      }
    }

    const propostaData: SupabasePropostaRow = {
      id_cliente: formState.clienteNaoCadastrado ? null : Number(formState.clienteId),
      id_faturado: id_faturado,
      id_endereco_ent: formState.enderecoId || null,
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
      is_avulso: formState.isAvulso || false
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
      propostaData.user_id = userId;
      propostaData.proposta = informalText || "Orçamento conforme solicitação.";
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

    // Persistir o frete escolhido no banco de dados (public.cotacao_frete)
    if (formState.isAvulso || chosenFrete) {
      try {
        // Deletar os fretes antigos apenas daquela proposta
        const { error: deleteError } = await client
          .from("cotacao_frete")
          .delete()
          .eq("id_int", id_int!);

        if (deleteError) {
          console.error("Erro ao limpar cotações de frete antigas:", deleteError);
          throw new Error(`Erro ao limpar cotações antigas de frete: ${deleteError.message}`);
        }

        // Inserir apenas o frete escolhido atual
        const insertPayload: Record<string, unknown> = {
          id_int: id_int!,
          servico: formState.isAvulso ? (formState.observacoesFreteManual || "Frete Manual") : (chosenFrete?.servico || ""),
          valor: freteValor,
          prazo: formState.isAvulso ? "A combinar" : (chosenFrete?.prazo || "A combinar"),
          cep: cepText || null,
          peso: formState.isAvulso ? 0 : (resumo.pesoTotal || null),
          escolhido: true
        };

        if (!formState.isAvulso && chosenFrete?.id_cotacao !== undefined) {
          insertPayload.id_cotacao = chosenFrete.id_cotacao;
        }

        const { error: insertFreteError } = await client
          .from("cotacao_frete")
          .insert(insertPayload);

        if (insertFreteError) {
          console.error("Erro ao inserir cotação de frete escolhida:", insertFreteError);
          throw new Error(`Erro ao salvar cotação de frete escolhida: ${insertFreteError.message}`);
        }
      } catch (freteErr) {
        console.error("Erro ao persistir cotação de frete no banco:", freteErr);
        throw freteErr;
      }
    }

    // 3. RECONCILE ITEMS in public.produtos_proposta
    if (formState.isAvulso) {
      // Deletar qualquer item existente se houver
      const { error: deleteItemsError } = await client
        .from("produtos_proposta")
        .delete()
        .eq("id_int", id_int!);
      
      if (deleteItemsError) {
        console.error("[OrcamentosService] Erro ao limpar itens de proposta avulsa:", deleteItemsError);
      }
    } else {
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

        const itemData = {
          id_int: id_int!,
          id_produto: item.id_produto,
          nome_produto: item.nome,
          modelo_descri: item.descricaoModelo,
          valor_unt: item.valorUnitario,
          qtd: item.quantidade,
          fixo: item.valorFixo,
          valor_sub_total: (item.valorUnitario * item.quantidade) + item.valorFixo,
          peso_uni: pesoUni,
          peso_base: pesoBase,
          peso_extra: pesoExtra,
          valor_base: item.valorUnitario - valorExtra,
          valor_extra: valorExtra,
          ncm: item.produto.ncm || null,
          cfop: item.produto.cfop_interno || null
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
    }

    if (formState.isAvulso) {
      const { error: finalUpdateError } = await client
        .from("propostas")
        .update({
          is_avulso: true,
          valor: subtotalProdutos,
          valor_frete: freteValor,
          valor_total: valorTotal
        })
        .eq("id_int", id_int!);

      if (finalUpdateError) {
        console.error("[OrcamentosService] Erro no update final da proposta avulsa:", finalUpdateError);
        throw new Error(`Erro ao finalizar gravação da proposta avulsa: ${finalUpdateError.message}`);
      }
    }

    // --- PERSISTÊNCIA DO DESCONTO GERAL DA PROPOSTA ---
    const descontoValor = Number(formState.descontoGeralValor) || 0;
    const isPercent = formState.descontoGeralTipo === "PERCENTUAL";
    const valorNominal = isPercent ? 0 : descontoValor;
    const valorPercentual = isPercent ? descontoValor : 0;

    // 1. Verificar se já existe um registro DESCONTO_GERAL para o id_int
    const { data: existingDiscount, error: checkError } = await client
      .from("desconto_proposta")
      .select("id")
      .eq("id_int", id_int!)
      .eq("tipo_desconto", "DESCONTO_GERAL")
      .maybeSingle();

    if (checkError) {
      console.error("[OrcamentosService] Erro ao verificar desconto_proposta:", checkError);
    }

    if (existingDiscount) {
      // 2. Fazer UPDATE
      const { error: updateDiscountError } = await client
        .from("desconto_proposta")
        .update({
          valor_nominal: valorNominal,
          valor_percentual: valorPercentual,
          descricao: "Desconto geral da proposta",
          validade: null
        })
        .eq("id", existingDiscount.id);

      if (updateDiscountError) {
        console.error("[OrcamentosService] Erro ao atualizar desconto_proposta:", updateDiscountError);
        throw new Error(`Erro ao atualizar desconto geral da proposta: ${updateDiscountError.message}`);
      }
    } else if (descontoValor > 0) {
      // 3. Fazer INSERT
      const { error: insertDiscountError } = await client
        .from("desconto_proposta")
        .insert({
          id_int: id_int!,
          tipo_desconto: "DESCONTO_GERAL",
          valor_nominal: valorNominal,
          valor_percentual: valorPercentual,
          descricao: "Desconto geral da proposta"
        });

      if (insertDiscountError) {
        console.error("[OrcamentosService] Erro ao criar desconto_proposta:", insertDiscountError);
        throw new Error(`Erro ao criar desconto geral da proposta: ${insertDiscountError.message}`);
      }
    }

    return { success: true, id_int: id_int! };
  } catch (err) {
    console.error("[OrcamentosService] Falha ao salvar proposta:", err);
    if (!isUpdate && id_int) {
      console.warn(`[OrcamentosService] Falha durante salvamento de itens. Removendo proposta #${id_int} órfã.`);
      try {
        await client.from("propostas").delete().eq("id_int", id_int);
      } catch (cleanErr) {
        console.error("[OrcamentosService] Erro ao realizar cleanup da proposta órfã:", cleanErr);
      }
    }
    const msg = err instanceof Error ? err.message : "Erro interno desconhecido.";
    return { success: false, errorMessage: msg };
  }
}

export type UsuarioVendedor = {
  user_id: string;
  email: string;
  nome_usuario: string;
  is_vendedor: boolean;
  id_empresa: number | null;
  setor: string | null;
};

export async function listVendedoresReais(): Promise<UsuarioVendedor[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from("usuarios")
    .select("user_id, email, nome_usuario, is_vendedor, id_empresa, setor")
    .eq("is_vendedor", true)
    .order("nome_usuario");

  if (error) {
    console.error("[OrcamentosService] Erro ao buscar vendedores reais:", error);
    return [];
  }

  return (data || []) as UsuarioVendedor[];
}

export async function gerarPDFProposta(
  idInt: number,
  idEmpresa: number | string | null | undefined
): Promise<{ success: boolean; url?: string; errorMessage?: string }> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return { success: false, errorMessage: "Configurações do Supabase ausentes no cliente." };
    }

    if (!idInt) {
      return { success: false, errorMessage: "ID da proposta inválido." };
    }

    const idEmpresaNum = idEmpresa !== null && idEmpresa !== undefined ? Number(idEmpresa) : null;

    if (idEmpresaNum === null || isNaN(idEmpresaNum) || ![1, 2, 3].includes(idEmpresaNum)) {
      return { success: false, errorMessage: "Empresa inválida ou não suportada para geração de PDF." };
    }

    let idModelo = 10;
    if (idEmpresaNum === 2) {
      idModelo = 11;
    } else if (idEmpresaNum === 3) {
      idModelo = 12;
    }

    const url = `${supabaseUrl}/functions/v1/proposta_comencial`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${anonKey}`
      },
      body: JSON.stringify({
        id_int: idInt,
        id_modelo: idModelo
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, errorMessage: `Edge Function retornou erro HTTP ${response.status}: ${text || response.statusText}` };
    }

    const data = await response.json();
    if (data && data.success && data.url) {
      // Registrar timeline de forma assíncrona (não-bloqueante)
      void registrarMensagemSistemaProposta({
        idInt: idInt,
        mensagem: "PDF da proposta gerado.",
        setor: "Comercial"
      }).catch((err) => console.warn("[PDF Timeline Error]", err));

      return { success: true, url: data.url };
    }

    return { 
      success: false, 
      errorMessage: data?.message || data?.error || "A resposta da Edge Function não continha a URL do PDF." 
    };
  } catch (error) {
    console.error("[OrcamentosService] Erro ao gerar PDF da proposta:", error);
    return { 
      success: false, 
      errorMessage: error instanceof Error ? error.message : "Erro desconhecido ao chamar Edge Function." 
    };
  }
}

export async function duplicarProposta(
  idIntOrigem: number
): Promise<{ success: boolean; novoIdInt?: number; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase não configurado." };
  }

  if (!idIntOrigem || idIntOrigem <= 0) {
    return { success: false, errorMessage: "ID de origem inválido." };
  }

  try {
    const { data, error } = await client.rpc("copiar_proposta_v2", {
      p_id_int_origem: idIntOrigem
    });

    if (error) {
      console.error("[OrcamentosService] Erro ao duplicar proposta:", error);
      let msg = error.message || "Erro desconhecido ao duplicar proposta.";
      if (msg.includes("já é cópia") || msg.toLowerCase().includes("ja e copia")) {
        msg = "Não é permitido duplicar uma proposta que já é cópia.";
      }
      return { success: false, errorMessage: msg };
    }

    const novoIdInt = Number(data);
    if (!novoIdInt || isNaN(novoIdInt)) {
      return { success: false, errorMessage: "Retorno da duplicação inválido." };
    }

    // Copiar desconto geral se existir e não foi copiado pela RPC
    try {
      const { data: origDiscount } = await client
        .from("desconto_proposta")
        .select("*")
        .eq("id_int", idIntOrigem)
        .eq("tipo_desconto", "DESCONTO_GERAL")
        .maybeSingle();

      if (origDiscount) {
        // Verificar se já foi copiado pela RPC
        const { data: newDiscount } = await client
          .from("desconto_proposta")
          .select("id")
          .eq("id_int", novoIdInt)
          .eq("tipo_desconto", "DESCONTO_GERAL")
          .maybeSingle();

        if (!newDiscount) {
          await client.from("desconto_proposta").insert({
            id_int: novoIdInt,
            tipo_desconto: "DESCONTO_GERAL",
            valor_nominal: origDiscount.valor_nominal,
            valor_percentual: origDiscount.valor_percentual,
            descricao: origDiscount.descricao || "Desconto geral da proposta"
          });
        }
      }
    } catch (discountCopyErr) {
      console.error("[OrcamentosService] Erro ao duplicar desconto geral da proposta:", discountCopyErr);
    }

    // Registrar mensagens nos chats de forma assíncrona (não-bloqueante)
    void registrarMensagemSistemaProposta({
      idInt: idIntOrigem,
      mensagem: `Proposta duplicada. Nova proposta gerada: #${novoIdInt}.`,
      setor: "Comercial"
    }).catch((err) => console.warn("[Duplicação Timeline Error Original]", err));

    void registrarMensagemSistemaProposta({
      idInt: novoIdInt,
      mensagem: `Proposta duplicada a partir da proposta #${idIntOrigem}.`,
      setor: "Comercial"
    }).catch((err) => console.warn("[Duplicação Timeline Error Nova]", err));

    return { success: true, novoIdInt };
  } catch (err) {
    console.error("[OrcamentosService] Erro inesperado ao duplicar proposta:", err);
    return { 
      success: false, 
      errorMessage: err instanceof Error ? err.message : "Erro interno desconhecido." 
    };
  }
}

export interface PropostaChatAnexo {
  url: string;
  name: string;
  type: string;
  size: number;
}

export interface PropostaChatMessage {
  id: number;
  id_int: number;
  mensagem: string;
  tipo: "MENSAGEM" | "SISTEMA" | "FINANCEIRO" | "PRODUCAO";
  autor_uid: string | null;
  autor_nome: string | null;
  autor_email: string | null;
  setor: string | null;
  created_at: string;
  updated_at: string | null;
  editado: boolean;
  visivel_externo: boolean;
  anexos: PropostaChatAnexo[] | null;
  id_cliente: number | null;
  avatar: string | null;
  is_pendente: boolean;
  is_recusado: boolean;
}

export async function listPropostaChatMessages(
  idInt: number
): Promise<{ success: boolean; data: PropostaChatMessage[]; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, data: [], errorMessage: "Cliente Supabase não configurado." };
  }

  try {
    const { data, error } = await client
      .from("propostas_chat")
      .select("*")
      .eq("id_int", idInt)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[OrcamentosService] Erro ao buscar mensagens do chat:", error);
      return { success: false, data: [], errorMessage: error.message };
    }

    return { success: true, data: data as PropostaChatMessage[] };
  } catch (err) {
    console.error("[OrcamentosService] Exceção ao buscar mensagens do chat:", err);
    return { 
      success: false, 
      data: [], 
      errorMessage: err instanceof Error ? err.message : "Erro inesperado ao listar mensagens." 
    };
  }
}

function isValidUUID(val: string | null | undefined): boolean {
  if (!val) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(val);
}

export async function sendPropostaChatMessage(payload: {
  id_int: number;
  mensagem: string;
  tipo: "MENSAGEM" | "SISTEMA" | "FINANCEIRO" | "PRODUCAO";
  autor_uid: string | null;
  autor_nome: string | null;
  autor_email: string | null;
  setor: string | null;
  avatar: string | null;
  visivel_externo: boolean;
  anexos: PropostaChatAnexo[] | null;
  id_cliente: number | null;
}): Promise<{ success: boolean; data?: PropostaChatMessage; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase não configurado." };
  }

  // Se a mensagem for vazia e tiver anexos, gravar mensagem padrão
  let msg = payload.mensagem?.trim() || "";
  if (!msg && payload.anexos && payload.anexos.length > 0) {
    msg = "Enviou um anexo.";
  }

  const isValidUserUuid = isValidUUID(payload.autor_uid);

  try {
    const { data, error } = await client
      .from("propostas_chat")
      .insert([
        {
          id_int: payload.id_int,
          mensagem: msg,
          tipo: payload.tipo,
          autor_uid: isValidUserUuid ? payload.autor_uid : null,
          autor_nome: payload.autor_nome,
          autor_email: payload.autor_email,
          setor: payload.setor,
          avatar: payload.avatar,
          visivel_externo: payload.visivel_externo,
          anexos: payload.anexos,
          id_cliente: payload.id_cliente
        }
      ])
      .select("*")
      .single();

    if (error) {
      console.error("[OrcamentosService] Erro ao enviar mensagem:", error);
      return { success: false, errorMessage: error.message };
    }

    return { success: true, data: data as PropostaChatMessage };
  } catch (err) {
    console.error("[OrcamentosService] Exceção ao enviar mensagem:", err);
    return { 
      success: false, 
      errorMessage: err instanceof Error ? err.message : "Erro inesperado ao enviar mensagem." 
    };
  }
}

export async function uploadChatAnexo(
  idInt: number,
  file: File
): Promise<{ success: boolean; anexo?: PropostaChatAnexo; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase não configurado." };
  }

  // Sanitizar nome do arquivo:
  const parts = file.name.split(".");
  const extension = parts.length > 1 ? parts.pop() : "";
  const baseName = parts.join(".") || "anexo";
  const normalizedBaseName = baseName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const normalizedExtension = extension?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const sanitizedName = normalizedExtension 
    ? `${normalizedBaseName}.${normalizedExtension}`
    : normalizedBaseName;

  const timestamp = Date.now();
  const filePath = `propostas/${idInt}/${timestamp}_${sanitizedName}`;
  const uploadPath = filePath;

  console.log("[CHAT_UPLOAD] bucket:", "chat-ideal");
  console.log("[CHAT_UPLOAD] path:", uploadPath);
  console.log("[CHAT_UPLOAD] file:", file);
  console.log("[CHAT_UPLOAD] contentType:", file.type);

  try {
    const uploadResult = await client.storage
      .from("chat-ideal")
      .upload(uploadPath, file, {
        cacheControl: "3600",
        contentType: file.type
      });

    const uploadData = uploadResult.data;
    const uploadError = uploadResult.error;

    console.log("[CHAT_UPLOAD] uploadData:", uploadData);
    if (uploadError || !uploadData) {
      console.error("[CHAT_UPLOAD] uploadError:", uploadError);
      return { success: false, errorMessage: uploadError?.message || "Erro no upload para o storage." };
    }

    const publicUrlResult = client.storage
      .from("chat-ideal")
      .getPublicUrl(uploadData.path);

    console.log("[CHAT_UPLOAD] publicUrlResult:", publicUrlResult);

    const publicUrl = publicUrlResult.data?.publicUrl;
    if (!publicUrl) {
      return { success: false, errorMessage: "Falha ao gerar URL pública do anexo." };
    }

    const anexo: PropostaChatAnexo = {
      url: publicUrl,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size
    };

    return { success: true, anexo };
  } catch (error) {
    console.error("[OrcamentosService] Exceção no upload do anexo:", error);
    return { 
      success: false, 
      errorMessage: error instanceof Error ? error.message : "Erro inesperado ao fazer upload do anexo." 
    };
  }
}

export interface RegistrarMensagemSistemaParams {
  idInt: number;
  idCliente?: string | number | null;
  mensagem: string;
  setor?: string;
  anexos?: PropostaChatAnexo[] | null;
  // Parâmetros para expansão futura (não salvos no banco por enquanto)
  metadata?: Record<string, unknown>;
  entityType?: string;
  entityId?: string | number;
}

export async function registrarMensagemSistemaProposta(
  params: RegistrarMensagemSistemaParams
): Promise<{ success: boolean; data?: PropostaChatMessage; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase não configurado." };
  }

  const { idInt, idCliente, mensagem, setor, anexos } = params;
  const parsedIdCliente = idCliente && !isNaN(Number(idCliente)) ? Number(idCliente) : null;

  try {
    const { data, error } = await client
      .from("propostas_chat")
      .insert([
        {
          id_int: idInt,
          id_cliente: parsedIdCliente,
          mensagem: mensagem,
          tipo: "SISTEMA",
          autor_nome: "Sistema",
          setor: setor || "Sistema",
          visivel_externo: false,
          anexos: anexos || null
        }
      ])
      .select()
      .single();

    if (error) {
      console.warn("[timeline] Falha ao registrar mensagem do sistema:", error);
      return { success: false, errorMessage: error.message };
    }

    return { success: true, data: data as PropostaChatMessage };
  } catch (err) {
    console.warn("[timeline] Erro inesperado ao registrar mensagem do sistema:", err);
    return { success: false, errorMessage: err instanceof Error ? err.message : String(err) };
  }
}

export interface ChatReadRecord {
  last_read_id: number;
  last_read_created_at: string;
}

export function getChatReadLocalStorageKey(
  user: { id?: string | null; email?: string | null } | null | undefined
): string {
  const identifier = user?.id || user?.email || "mock-user";
  return `erpideal_chat_read:${identifier}`;
}

export function loadChatReadInfo(
  user: { id?: string | null; email?: string | null } | null | undefined
): Record<number, ChatReadRecord> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const key = getChatReadLocalStorageKey(user);
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored) || {};
    }
  } catch (err) {
    console.error("[ChatReadHelper] Erro ao ler localStorage:", err);
  }
  return {};
}

export function saveChatReadInfo(
  user: { id?: string | null; email?: string | null } | null | undefined,
  idInt: number,
  lastReadId: number,
  lastReadCreatedAt: string
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const key = getChatReadLocalStorageKey(user);
    const data = loadChatReadInfo(user);
    
    const existing = data[idInt];
    const newId = existing ? Math.max(existing.last_read_id, lastReadId) : lastReadId;
    
    let newDate = lastReadCreatedAt;
    if (existing?.last_read_created_at) {
      const existingTime = new Date(existing.last_read_created_at).getTime();
      const newTime = new Date(lastReadCreatedAt).getTime();
      if (existingTime > newTime) {
        newDate = existing.last_read_created_at;
      }
    }

    data[idInt] = {
      last_read_id: newId,
      last_read_created_at: newDate
    };
    
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error("[ChatReadHelper] Erro ao gravar no localStorage:", err);
  }
}

export interface PropostaChatResumo {
  id_int: number;
  total_mensagens: number;
  total_anexos: number;
  ultima_mensagem: string | null;
  ultima_data: string | null;
  has_pendente: boolean;
  has_recusado: boolean;
  nao_lidas_count: number;
  ultima_mensagem_id: number | null;
  ultima_mensagem_created_at: string | null;
}

export async function getPropostaChatResumos(
  idInts: number[],
  currentUserUid?: string | null,
  readInfo?: Record<number, ChatReadRecord>
): Promise<Record<number, PropostaChatResumo>> {
  const result: Record<number, PropostaChatResumo> = {};
  if (!idInts || idInts.length === 0) {
    return result;
  }

  const client = getSupabaseClient();
  if (!client) {
    return result;
  }

  try {
    const { data, error } = await client
      .from("propostas_chat")
      .select("id_int, id, created_at, mensagem, anexos, is_pendente, is_recusado, autor_uid")
      .in("id_int", idInts)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[OrcamentosService] Erro ao buscar resumos do chat em lote:", error);
      return result;
    }

    if (!data || data.length === 0) {
      return result;
    }

    for (const row of data) {
      const idInt = Number(row.id_int);
      if (isNaN(idInt)) continue;

      if (!result[idInt]) {
        result[idInt] = {
          id_int: idInt,
          total_mensagens: 0,
          total_anexos: 0,
          ultima_mensagem: null,
          ultima_data: null,
          has_pendente: false,
          has_recusado: false,
          nao_lidas_count: 0,
          ultima_mensagem_id: null,
          ultima_mensagem_created_at: null
        };
      }

      const resumo = result[idInt];
      resumo.total_mensagens += 1;

      // Tratar anexos com segurança:
      // - null = 0
      // - array = tamanho do array
      // - objeto inválido = 0
      let anexoCount = 0;
      if (row.anexos !== null && row.anexos !== undefined) {
        if (Array.isArray(row.anexos)) {
          anexoCount = row.anexos.length;
        }
      }
      resumo.total_anexos += anexoCount;

      resumo.ultima_mensagem = row.mensagem || null;
      resumo.ultima_data = row.created_at || null;
      resumo.ultima_mensagem_id = row.id;
      resumo.ultima_mensagem_created_at = row.created_at || null;

      if (row.is_pendente === true) {
        resumo.has_pendente = true;
      }
      if (row.is_recusado === true) {
        resumo.has_recusado = true;
      }

      // Calcular quantidade de mensagens não lidas
      // 1. Ignorar mensagens enviadas pelo próprio usuário
      const isPropria = currentUserUid && row.autor_uid === currentUserUid;
      if (!isPropria) {
        // 2. Se houver informações de leitura para essa proposta
        const propRead = readInfo?.[idInt];
        if (propRead) {
          const isPostId = row.id > propRead.last_read_id;
          const isPostDate = propRead.last_read_created_at && row.created_at
            ? new Date(row.created_at).getTime() > new Date(propRead.last_read_created_at).getTime()
            : true;

          // Se for posterior pelo ID e pela data (salvo como fallback defensivo)
          if (isPostId && isPostDate) {
            resumo.nao_lidas_count += 1;
          }
        } else {
          // Se localStorage falhar ou não possuir registro, assume tudo como não lido
          resumo.nao_lidas_count += 1;
        }
      }
    }

    return result;
  } catch (err) {
    console.error("[OrcamentosService] Exceção ao buscar resumos do chat em lote:", err);
    return result;
  }
}

export interface ChatUsuario {
  user_id: string;
  email: string;
  nome_usuario: string;
  setor?: string | null;
  avatar?: string | null;
}

export async function listAllUsuarios(): Promise<ChatUsuario[]> {
  const client = getSupabaseClient();
  const mockUsers: ChatUsuario[] = [
    {
      user_id: "d3b07384-d113-4ec5-a55e-85a02e693b31",
      nome_usuario: "Everton Martins",
      email: "everton@ideal.local",
      setor: "ADMIN",
      avatar: null
    },
    {
      user_id: "a8a760c6-3023-455e-b9b5-685b5420d440",
      nome_usuario: "Caroline Silva",
      email: "caroline@ideal.local",
      setor: "COMERCIAL",
      avatar: null
    },
    {
      user_id: "b5d7d9a1-cb6c-48be-8f35-4cb5c8a417cd",
      nome_usuario: "Marielle Fonseca",
      email: "marielle@ideal.local",
      setor: "FINANCEIRO",
      avatar: null
    }
  ];

  if (!client) {
    return mockUsers;
  }

  try {
    const { data, error } = await client
      .from("usuarios")
      .select("user_id, email, nome_usuario, setor, avatar")
      .order("nome_usuario", { ascending: true });

    if (error) {
      console.warn("[OrcamentosService] Erro ao buscar usuários no Supabase, usando mock:", error);
      return mockUsers;
    }

    if (!data || data.length === 0) {
      console.log("[OrcamentosService] Nenhum usuário retornado do Supabase, usando mock.");
      return mockUsers;
    }

    return data as ChatUsuario[];
  } catch (err) {
    console.error("[OrcamentosService] Exceção ao buscar usuários:", err);
    return mockUsers;
  }
}

export async function createPropostaChatMentions(
  chatId: number,
  idInt: number,
  mentions: Array<{
    user_id: string;
    nome_usuario: string;
    email: string;
  }>,
  author: {
    id?: string | null;
    name?: string | null;
  } | null
): Promise<{ success: boolean; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponível." };
  }

  if (!mentions || mentions.length === 0) {
    return { success: true };
  }

  // Deduplicate mentions by user_id
  const uniqueMentionsMap = new Map<string, typeof mentions[0]>();
  for (const m of mentions) {
    if (m.user_id) {
      uniqueMentionsMap.set(m.user_id, m);
    }
  }
  const uniqueMentions = Array.from(uniqueMentionsMap.values());

  // Filter out mock UUIDs to avoid DB constraint failures
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  const validByUserId = author?.id && uuidRegex.test(author.id) ? author.id : null;

  const rows = uniqueMentions
    .filter((m) => uuidRegex.test(m.user_id))
    .map((m) => ({
      chat_id: chatId,
      id_int: idInt,
      mentioned_user_id: m.user_id,
      mentioned_user_name: m.nome_usuario,
      mentioned_user_email: m.email,
      mentioned_by_user_id: validByUserId,
      mentioned_by_name: author?.name || null,
      source_type: "CHAT"
    }));

  // Log mock mentions in local development
  const mockMentions = uniqueMentions.filter((m) => !uuidRegex.test(m.user_id));
  if (mockMentions.length > 0) {
    console.log(
      "[OrcamentosService] Simulação de menções locais (IDs mockados ignorados no insert do Supabase):",
      mockMentions.map((m) => `${m.nome_usuario} (${m.user_id})`)
    );
  }

  if (rows.length === 0) {
    return { success: true };
  }

  try {
    const { error } = await client
      .from("propostas_chat_mentions")
      .insert(rows);

    if (error) {
      console.error("[OrcamentosService] Erro ao gravar menções no Supabase:", error);
      return { success: false, errorMessage: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("[OrcamentosService] Exceção ao gravar menções:", err);
    return { success: false, errorMessage: String(err) };
  }
}

export async function markPropostaChatMentionsAsRead(
  userId: string | null | undefined,
  idInt: number
): Promise<{ success: boolean; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponível." };
  }

  if (!userId) {
    return { success: true };
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    console.log(`[OrcamentosService] markPropostaChatMentionsAsRead: UID mockado '${userId}' ignorado.`);
    return { success: true };
  }

  try {
    const { error } = await client
      .from("propostas_chat_mentions")
      .update({ read_at: new Date().toISOString() })
      .eq("mentioned_user_id", userId)
      .eq("id_int", idInt)
      .is("read_at", null);

    if (error) {
      console.error("[OrcamentosService] Erro ao marcar menções como lidas:", error);
      return { success: false, errorMessage: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("[OrcamentosService] Exceção ao marcar menções como lidas:", err);
    return { success: false, errorMessage: String(err) };
  }
}

export interface PropostaChatMentionJoined {
  id: number;
  chat_id: number;
  id_int: number;
  mentioned_user_id: string;
  mentioned_user_name: string;
  mentioned_user_email: string;
  mentioned_by_user_id: string | null;
  mentioned_by_name: string | null;
  read_at: string | null;
  source_type: string;
  created_at: string;
  propostas_chat?: {
    mensagem: string;
    tipo: string;
  } | null;
}

export async function listPropostaChatMentionsForUser(
  userId: string
): Promise<PropostaChatMentionJoined[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    return [];
  }

  try {
    const { data, error } = await client
      .from("propostas_chat_mentions")
      .select(`
        id,
        chat_id,
        id_int,
        mentioned_user_id,
        mentioned_user_name,
        mentioned_user_email,
        mentioned_by_user_id,
        mentioned_by_name,
        read_at,
        source_type,
        created_at,
        propostas_chat (
          mensagem,
          tipo
        )
      `)
      .eq("mentioned_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[OrcamentosService] Erro ao buscar menções do usuário:", error);
      return [];
    }

    return (data || []) as unknown as PropostaChatMentionJoined[];
  } catch (err) {
    console.error("[OrcamentosService] Exceção ao buscar menções do usuário:", err);
    return [];
  }
}

export async function getEligiblePropostas(): Promise<Proposta[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[OrcamentosService] Supabase client não inicializado em getEligiblePropostas.");
    return [];
  }

  try {
    const { data: proposalRows, error } = await client
      .from("propostas")
      .select("id_int")
      .in("status_interno", ["APROVADO", "AGUARDANDO"])
      .order("id_int", { ascending: false });

    if (error || !proposalRows) {
      console.error("[OrcamentosService] Erro ao buscar propostas elegíveis:", error);
      return [];
    }

    const propostas: Proposta[] = [];
    for (const row of proposalRows) {
      const prop = await getPropostaDetailById(row.id_int);
      if (prop) {
        propostas.push(prop);
      }
    }

    return propostas;
  } catch (err) {
    console.error("[OrcamentosService] Exceção em getEligiblePropostas:", err);
    return [];
  }
}
export async function insertEnderecoProposta(
  endereco: Omit<CadastroEndereco, "id"> & { id_cliente: number }
): Promise<{ success: boolean; data?: CadastroEndereco; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponível." };
  }

  const { data, error } = await client
    .from("enderecos")
    .insert([
      {
        id_cliente: endereco.id_cliente,
        cep: endereco.cep,
        endereco: endereco.endereco,
        numero: endereco.numero,
        complemento: endereco.complemento || null,
        bairro: endereco.bairro,
        cidade: endereco.cidade,
        uf: endereco.uf,
        tipo_endereco: endereco.tipo || "Entrega",
        recebedor: endereco.recebedor || null,
        cpf_recebedor: endereco.cpfRecebedor || null,
      },
    ])
    .select("id, cep, endereco, numero, complemento, bairro, cidade, uf, tipo_endereco, recebedor, cpf_recebedor")
    .single();

  if (error) {
    console.error("[OrcamentosService] Erro ao salvar endereco:", error);
    return { success: false, errorMessage: error.message || "Erro ao salvar endereço no banco." };
  }

  if (!data) {
    return { success: false, errorMessage: "Endereço não retornado após inserção." };
  }

  const mappedEndereco: CadastroEndereco = {
    id: data.id,
    cep: data.cep || "",
    endereco: data.endereco || "",
    numero: data.numero || "",
    complemento: data.complemento || "",
    bairro: data.bairro || "",
    cidade: data.cidade || "",
    uf: data.uf || "",
    tipo: (data.tipo_endereco?.toLowerCase() as any) || "entrega",
    recebedor: data.recebedor || "",
    cpfRecebedor: data.cpf_recebedor || "",
  };

  return { success: true, data: mappedEndereco };
}

export async function updateEnderecoProposta(
  id: string,
  endereco: Omit<CadastroEndereco, "id">
): Promise<{ success: boolean; data?: CadastroEndereco; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponível." };
  }

  const { data, error } = await client
    .from("enderecos")
    .update({
      cep: endereco.cep,
      endereco: endereco.endereco,
      numero: endereco.numero,
      complemento: endereco.complemento || null,
      bairro: endereco.bairro,
      cidade: endereco.cidade,
      uf: endereco.uf,
      tipo_endereco: endereco.tipo || "Entrega",
      recebedor: endereco.recebedor || null,
      cpf_recebedor: endereco.cpfRecebedor || null,
    })
    .eq("id", id)
    .select("id, cep, endereco, numero, complemento, bairro, cidade, uf, tipo_endereco, recebedor, cpf_recebedor")
    .single();

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[OrcamentosService] Erro ao atualizar endereco:", error);
    }
    return { success: false, errorMessage: error.message || "Erro ao atualizar endereço no banco." };
  }

  if (!data) {
    return { success: false, errorMessage: "Endereço não retornado após atualização." };
  }

  const mappedEndereco: CadastroEndereco = {
    id: data.id,
    cep: data.cep || "",
    endereco: data.endereco || "",
    numero: data.numero || "",
    complemento: data.complemento || "",
    bairro: data.bairro || "",
    cidade: data.cidade || "",
    uf: data.uf || "",
    recebedor: data.recebedor || "",
    cpfRecebedor: data.cpf_recebedor || "",
    tipo: (data.tipo_endereco?.toLowerCase() as any) || "entrega",
  };

  return { success: true, data: mappedEndereco };
}

export async function updatePropostaFiscalDados(
  idInt: number,
  idFaturado: number,
  idEnderecoEnt: string | null
): Promise<{ success: boolean; data?: any; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponível." };
  }

  const updatePayload: any = { id_faturado: idFaturado };
  if (idEnderecoEnt !== null && idEnderecoEnt !== undefined) {
    updatePayload.id_endereco_ent = idEnderecoEnt;
  }

  const { data, error } = await client
    .from("propostas")
    .update(updatePayload)
    .eq("id_int", idInt)
    .select("id_int, id_cliente, id_faturado, id_endereco_ent")
    .single();

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[OrcamentosService] Erro ao atualizar dados fiscais da proposta:", error);
    }
    return { success: false, errorMessage: error.message || "Erro ao atualizar dados fiscais no banco." };
  }

  return { success: true, data };
}


