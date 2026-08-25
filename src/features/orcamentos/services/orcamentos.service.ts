import { SupabaseClient } from "@supabase/supabase-js";
import { PROPOSTA_STATUS_GROUP_ATIVO_CLIENTE } from "@/features/orcamentos/constants";
import { getSupabaseClient } from "@/lib/supabase/client";
import { categoriaEfetiva, ehTransporteCategoria, type TransporteCategoria } from "@/features/orcamentos/lib/transporte-categoria";
import { calculateResumo, calculateItemSubtotal } from "@/features/orcamentos/orcamento-utils";
import {
  aplicarModalidadeNosFretes,
  faltaTransportadoraEmFob,
  motivoBloqueioModalidade,
  nomeTransportadoraCadastro,
  nomeTransporteEfetivo,
  podeEditarModalidade,
  valorFreteEfetivo,
  type ModalidadeFrete
} from "@/features/orcamentos/lib/modalidade-frete";
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
import { buildPropostaInformalText, formatVariacoesItem, getClienteBonusPercent, isItemPrateleira, STATUS_INICIAL_MODELO } from "@/features/orcamentos/orcamento-utils";
import { listarCotacoesFrete } from "@/features/orcamentos/services/frete.service";
import { parseCurrencyBR } from "@/lib/formatters/currency";
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


/** Limite de public.propostas.id_cliente (integer / int4). */
const MAX_INT4 = 2147483647;

export type OrcamentosReadFilters = {
  search?: string;
  status?: string;
  modelo?: string;
  vendedor?: string;
  filterTipoCobranca?: string;
  activeCard?: "ORCAMENTOS" | "EM_ARTE" | "LIBERADAS" | "REVISAO_ATENDENTE" | "EM_PRODUCAO" | null;
  /**
   * Busca ampla: há texto na pesquisa ou dropdown específico selecionado.
   * Nesse modo o período é ignorado e a consulta varre o lote de até
   * LOTE_BUSCA_AMPLA registros, do mais recentemente atualizado ao mais antigo.
   */
  ignorarPeriodo?: boolean;
  /**
   * Visibilidade dos pedidos de TESTE encerrados (`encerrado_teste_em`).
   *
   *   OCULTAR (padrao) — fora da lista. Encerrado nao polui a operacao.
   *   SOMENTE          — so os encerrados. E a opcao "ENCERRADOS" do drop de
   *                      modelos, o atalho para revisar e reabrir.
   *   INCLUIR          — nao filtra. Usado quando ha termo de busca: quem
   *                      procura um numero ou nome especifico quer achar, mesmo
   *                      que o registro esteja encerrado.
   *
   * Mudou em 20/08/2026: antes o padrao era mostrar tudo com badge, e um botao
   * separado recortava so os encerrados. O badge continua — ele e o que permite
   * reconhecer e reabrir o registro depois de encontra-lo.
   */
  encerradosTeste?: "OCULTAR" | "SOMENTE" | "INCLUIR";
};

/** Teto de registros varridos quando o período é ignorado (busca ampla). */
const LOTE_BUSCA_AMPLA = 200;

export type OrcamentosReadResult = {
  source: OrcamentoListSource;
  propostas: OrcamentoListItem[];
  warnings: string[];
  detectedColumns: string[];
  errorMessage?: string;
  diagnostics: OrcamentosDiagnostics;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
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

/**
 * Teto de ids de socio dobrados na busca. A condicao vai na URL do PostgREST;
 * sem limite, um termo curto como "ltda" traria milhares de ids e estouraria a
 * requisicao. 200 cobre com folga qualquer busca util — ao atingir o teto,
 * avisamos no log em vez de truncar em silencio.
 */
const LIMITE_IDS_SOCIO_BUSCA = 200;

/**
 * IDs de clientes cujo nome casa com o termo. Serve so a busca por SOCIO
 * PAGADOR: `propostas.id_faturado` guarda o id, e o nome vive em `clientes`.
 * Somente leitura.
 */
async function buscarIdsClientesPorNome(
  client: NonNullable<ReturnType<typeof getSupabaseClient>>,
  termo: string
): Promise<number[]> {
  const alvo = termo.trim();
  if (alvo.length < 2) return [];
  try {
    const { data, error } = await client
      .from("clientes")
      .select("id_cliente")
      .or(`nome.ilike.%${alvo}%,fantasia.ilike.%${alvo}%,apelido.ilike.%${alvo}%`)
      .limit(LIMITE_IDS_SOCIO_BUSCA);

    if (error) {
      console.warn("[OrcamentosService] Falha ao resolver socios na busca:", error.message);
      return [];
    }
    const ids = (data ?? [])
      .map((linha) => Number(linha.id_cliente))
      .filter((id) => Number.isFinite(id) && id > 0);

    // TETO ATINGIDO = DESISTE DA AMPLIACAO, em vez de aplicar um recorte
    // arbitrario. Medido em 21/08/2026: termos correntes como "silva" (6.831
    // clientes), "santos" (3.962), "eduardo" (805) e "joao" (526) estouram o
    // teto com folga. Como a consulta nao tem ordenacao definida, os 200
    // primeiros seriam um subconjunto imprevisivel — a mesma busca poderia
    // trazer socios diferentes a cada execucao.
    //
    // Desistir e seguro porque a condicao de socio SOMA ao `.or()`: sem ela a
    // busca continua exatamente como era antes desta mudanca, achando por
    // numero, cliente e vendedor. O usuario perde so o alcance extra, e o log
    // diz o porque — nada fica silenciosamente pela metade.
    if (ids.length >= LIMITE_IDS_SOCIO_BUSCA) {
      console.warn(
        `[OrcamentosService] Termo "${alvo}" casa com ${LIMITE_IDS_SOCIO_BUSCA}+ clientes; ` +
          `a busca por SOCIO PAGADOR foi desligada para este termo (seria um recorte arbitrario). ` +
          `A busca por numero, cliente e vendedor segue normal. Use um termo mais especifico.`
      );
      return [];
    }
    return ids;
  } catch (e) {
    console.warn("[OrcamentosService] Excecao ao resolver socios na busca:", e);
    return [];
  }
}

async function fetchPropostaRows(
  periodo = "all",
  page = 1,
  pageSize = 200,
  filters?: OrcamentosReadFilters
) {
  const env = logSupabaseEnv();
  const client = getSupabaseClient();
  const hasFrom = Boolean(client && typeof client.from === "function");
  const clientShape = `from:${hasFrom ? "sim" : "nao"}`;
  // Busca ampla (texto ou dropdown ativo): o período deixa de recortar a consulta.
  const buscaAmpla = filters?.ignorarPeriodo === true;
  const periodoFilter = buscaAmpla ? null : buildPeriodoFilter(periodo);

  const safePageSize = Math.min(Math.max(1, pageSize), 200);
  const safePage = Math.max(1, page);
  // Na busca ampla o resultado é sempre o lote único de até LOTE_BUSCA_AMPLA
  // registros — não há paginação além dele.
  const from = buscaAmpla ? 0 : (safePage - 1) * safePageSize;
  const to = buscaAmpla ? LOTE_BUSCA_AMPLA - 1 : safePage * safePageSize - 1;

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
    return {
      rows: null,
      totalCount: 0,
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
    // `encerrado_teste_em/por` viajam para a lista de proposito: aqui o pedido de
    // teste NAO some, ganha badge. Orcamentos e o unico lugar onde ele continua
    // visivel depois de marcado — e portanto o unico de onde da para reabrir.
    const columnsToSelect = "id, id_int, id_cliente, cliente, created_at, updated_at, vendedor, status_interno, valor_total, valor, is_avulso, empresa, valor_frete, em_arte, is_prd_aprovado, encerrado_teste_em, encerrado_teste_por, id_faturado";

    let query = client
      .from("propostas")
      .select(columnsToSelect, { count: "exact" });

    if (periodoFilter) {
      query = query.gte("created_at", periodoFilter.inicioIso).lt("created_at", periodoFilter.fimExclusivoIso);
    }

    if (filters?.vendedor && filters.vendedor !== "TODOS") {
      query = query.ilike("vendedor", filters.vendedor);
    }

    if (filters?.modelo && filters.modelo !== "TODOS_MODELOS") {
      if (filters.modelo === "AVULSO") {
        query = query.eq("is_avulso", true);
      } else if (filters.modelo === "PROPOSTA") {
        query = query.or("is_avulso.is.null,is_avulso.eq.false");
      }
    }

    // Encerrados fora da lista por padrao. Ver `encerradosTeste` no tipo.
    // Declarado aqui, antes do bloco de status, porque o `else` que exclui
    // CANCELADO consulta esta mesma decisao.
    const visibilidadeEncerrados = filters?.encerradosTeste ?? "OCULTAR";
    if (visibilidadeEncerrados === "SOMENTE") {
      query = query.not("encerrado_teste_em", "is", null);
    } else if (visibilidadeEncerrados === "OCULTAR") {
      query = query.is("encerrado_teste_em", null);
    }

    if (filters?.activeCard) {
      const card = filters.activeCard;
      if (card === "EM_ARTE") {
        query = query.or("status_interno.eq.NOVO / EM ARTE,status_interno.eq.AGUARDANDO / EM ARTE,status_interno.eq.LIBERADO / EM ARTE,em_arte.eq.true");
      } else if (card === "LIBERADAS") {
        query = query.or("status_interno.eq.LIBERADO,status_interno.eq.LIBERADO / EM ARTE");
      } else if (card === "REVISAO_ATENDENTE") {
        query = query.eq("status_interno", "REVISAO ATENDENTE");
      } else if (card === "EM_PRODUCAO") {
        query = query.in("status_interno", ["REVISAO PRODUCAO", "EM PRODUCAO", "EM IMPRESSAO", "EM IMPRESSAO / PENDENTE", "EM ACABAMENTO", "EM ACABAMENTO / PENDENTE"]);
      }
    } else if (filters?.status && filters.status !== "TODOS") {
      if (filters.status === "EM ARTE") {
        query = query.or("status_interno.ilike.%EM ARTE%,em_arte.eq.true");
      } else {
        query = query.eq("status_interno", filters.status);
      }
    } else if (visibilidadeEncerrados !== "SOMENTE") {
      query = query.neq("status_interno", "CANCELADO");
    }
    // Em "SOMENTE", CANCELADO nao e excluido: quem abre a lista de encerrados
    // quer a lista COMPLETA deles, inclusive os cancelados — senao um marcado
    // por engano ficaria fora do unico atalho que o encontra.

    if (filters?.search && filters.search.trim()) {
      const term = filters.search.trim();
      const num = Number(term);

      // SOCIO PAGADOR na busca: `propostas.id_faturado` guarda o ID de quem
      // paga, nao o nome — entao o nome so pode ser alcancado invertendo a
      // consulta. Pre-consulta `clientes` pelo termo e dobra os ids achados no
      // MESMO `.or()`, como `id_faturado.in.(...)`. Mesmo padrao que o filtro de
      // tipo de cobranca ja usa com `pagamentos_v2`.
      //
      // SOMA, nao substitui: continua achando por numero, cliente e vendedor.
      const idsSocio = await buscarIdsClientesPorNome(client, term);
      const condicaoSocio = idsSocio.length > 0 ? `id_faturado.in.(${idsSocio.join(",")})` : null;

      if (Number.isInteger(num) && num > 0) {
        // id_int (nº da proposta) e id_cliente são colunas numéricas → comparação exata,
        // igual ao comportamento já existente do nº da proposta.
        const condicoes = [`id_int.eq.${num}`];
        // id_cliente é integer (int4): fora da faixa o Postgres aborta a consulta inteira.
        if (num <= MAX_INT4) condicoes.push(`id_cliente.eq.${num}`);
        condicoes.push(`cliente.ilike.%${term}%`, `vendedor.ilike.%${term}%`);
        if (condicaoSocio) condicoes.push(condicaoSocio);
        query = query.or(condicoes.join(","));
      } else {
        const condicoes = [`cliente.ilike.%${term}%`, `vendedor.ilike.%${term}%`];
        if (condicaoSocio) condicoes.push(condicaoSocio);
        query = query.or(condicoes.join(","));
      }
    }

    if (filters?.filterTipoCobranca && filters.filterTipoCobranca !== "TODOS") {
      const searchTipo = filters.filterTipoCobranca === "CARTAO" ? "CARD" : filters.filterTipoCobranca;
      const { data: paymentRows } = await client
        .from("pagamentos_v2")
        .select("id_int")
        .ilike("tipo_cobranca", `%${searchTipo}%`);
      
      const matchedIds = Array.from(new Set((paymentRows || []).map(p => p.id_int).filter(Boolean)));
      if (matchedIds.length > 0) {
        query = query.in("id_int", matchedIds);
      } else {
        query = query.in("id_int", [-1]);
      }
    }

    if (buscaAmpla) {
      // Da atualização mais recente para a mais antiga. `updated_at` é o campo
      // real de última atualização (mesmo usado na ordenação da lista).
      // nullsFirst: false mantém os registros sem updated_at no fim.
      query = query.order("updated_at", { ascending: false, nullsFirst: false });
      query = query.order("id_int", { ascending: false });
    } else {
      query = query.order("id_int", { ascending: false });
    }
    query = query.range(from, to);

    const { data, error, count } = await query.returns<SupabasePropostaRow[]>();
    const totalCount = count ?? (data?.length || 0);

    if (error) {
      const supabaseError = getErrorMessage(error) ?? "Erro desconhecido no Supabase";
      return {
        rows: null,
        totalCount: 0,
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
      return {
        rows: null,
        totalCount: 0,
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
    /**
     * Propostas com dinheiro JÁ recebido e ainda sem conferência do financeiro.
     *
     * `propostas.status_interno` não distingue isso: a regra do banco
     * (`atualizar_status_financeiro_proposta`) mantém AGUARDANDO tanto para
     * "cliente ainda não pagou" quanto para "pagou, falta o financeiro
     * confirmar". Um pagamento às 18h com o financeiro já fora da empresa fica
     * horas indistinguível de uma proposta não paga — e o vendedor mexe na
     * proposta achando que o dinheiro não entrou.
     *
     * O status não é alterado aqui de propósito: só publicamos o sinal para a
     * lista exibir ao lado dele.
     */
    const pagoAConfirmarSet = new Set<string>();

    if (proposalIds.length) {
      const { data: paymentData, error: paymentError } = await client
        .from("pagamentos_v2")
        .select("id_int,tipo_cobranca,status,confirmado")
        .in("id_int", proposalIds)
        .returns<SupabasePagamentoTipoCobrancaRow[]>();

      if (!paymentError && Array.isArray(paymentData)) {
        paymentData.forEach((row) => {
          const rawStatus = row.status === null || row.status === undefined ? "" : String(row.status).trim().toUpperCase();
          if (rawStatus === "CANCELADO" || rawStatus === "EXTORNADO" || rawStatus === "RECUSADO") {
            return;
          }

          const idInt = row.id_int === null || row.id_int === undefined ? "" : String(row.id_int);
          if (!idInt) {
            return;
          }

          // Só PAID: A_VENCER não confirmado é faturamento a vencer, não
          // dinheiro em caixa, e sinalizar como pago seria pior que não sinalizar.
          if (rawStatus === "PAID" && row.confirmado !== true) {
            pagoAConfirmarSet.add(idInt);
          }

          const tipo = normalizeTipoCobranca(row.tipo_cobranca);
          if (!tipo) {
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
      tipos_cobranca: paymentMap.get(String(row.id_int ?? "")) ?? [],
      pago_a_confirmar: pagoAConfirmarSet.has(String(row.id_int ?? "")),
      em_arte: row.em_arte === true
    }));

    return {
      rows: enrichedRows as SupabasePropostaRow[],
      totalCount,
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
    return {
      rows: null,
      totalCount: 0,
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

export async function getOrcamentosReadOnlyData(
  periodo = "all",
  page = 1,
  pageSize = 200,
  filters?: OrcamentosReadFilters
): Promise<OrcamentosReadResult> {
  const safePageSize = Math.min(Math.max(1, pageSize), 200);
  const safePage = Math.max(1, page);
  const fetched = await fetchPropostaRows(periodo, safePage, safePageSize, filters);
  const rows = fetched.rows;
  // Na busca ampla o lote é único (até LOTE_BUSCA_AMPLA): o total exibido e a
  // paginação não podem prometer páginas que a consulta não vai entregar.
  const totalCount = filters?.ignorarPeriodo === true
    ? Math.min(fetched.totalCount || 0, LOTE_BUSCA_AMPLA)
    : fetched.totalCount || 0;
  const totalPages = Math.ceil(totalCount / safePageSize) || 1;

  const toNumber = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  if (!rows) {
    return {
      source: "supabase",
      propostas: [],
      warnings: [
        "A conexão com o banco de dados Supabase falhou na leitura real das propostas."
      ],
      detectedColumns: [],
      errorMessage: fetched.diagnostics.supabaseError || "Erro de conexão com o banco de dados Supabase",
      diagnostics: fetched.diagnostics as OrcamentosDiagnostics,
      totalCount: 0,
      page: safePage,
      pageSize: safePageSize,
      totalPages: 1
    };
  }

  if (!rows.length) {
    const emptyRes = buildEmptyRealResult(rows, periodo, fetched as { diagnostics: Partial<OrcamentosDiagnostics> });
    return {
      ...emptyRes,
      totalCount,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(1, totalPages)
    };
  }

  try {
    const client = getSupabaseClient();
    if (client) {
      const idsToFetch = rows
        .map((r) => r.id_int)
        .filter((id) => typeof id === "number") as number[];
      
      const clientIds = rows
        .map((r) => r.id_cliente)
        .filter((id) => typeof id === "number") as number[];

      if (idsToFetch.length > 0) {
        // Consultas em lote paralelas para evitar N+1 queries
        const [discountsRes, clientsRes, itemsRes] = await Promise.all([
          client
            .from("desconto_proposta")
            .select("id_int, valor_percentual, valor_nominal")
            .in("id_int", idsToFetch)
            .eq("tipo_desconto", "DESCONTO_GERAL"),
          client
            .from("clientes")
            .select("id_cliente, is_bonus, percentual_bunus, usa_preco_fixo")
            .in("id_cliente", clientIds),
          client
            .from("produtos_proposta")
            .select("id_int, valor_unt, qtd, fixo")
            .in("id_int", idsToFetch)
        ]);

        const discountMap = new Map();
        if (discountsRes.data) {
          discountsRes.data.forEach((d) => discountMap.set(d.id_int, d));
        }

        const clientBonusMap = new Map();
        if (clientsRes.data) {
          clientsRes.data.forEach((c) => {
            const bp = getClienteBonusPercent({
              usaPrecoFixo: c.usa_preco_fixo === true,
              is_bonus: c.is_bonus === true,
              bonusAtivo: c.is_bonus === true,
              percentualBonus: Number(c.percentual_bunus ?? 0)
            } as any);
            clientBonusMap.set(Number(c.id_cliente), bp);
          });
        }

        const itemsMap = new Map();
        if (itemsRes.data) {
          itemsRes.data.forEach((item) => {
            if (!itemsMap.has(item.id_int)) {
              itemsMap.set(item.id_int, []);
            }
            itemsMap.get(item.id_int).push(item);
          });
        }

        for (const row of rows) {
          const isAvulso = row.is_avulso === true || row.is_avulso === "true" || row.is_avulso === "1" || row.is_avulso === 1;
          const freteValor = toNumber(row.valor_frete);

          if (isAvulso) {
            const total = toNumber(row.valor_total ?? (toNumber(row.valor) + freteValor));
            row.valor_total = total;
            (row as any)._valor_total_calculado_view = total;
          } else {
            const items = itemsMap.get(row.id_int) || [];
            if (items.length === 0) {
              const total = toNumber(row.valor_total ?? (toNumber(row.valor) + freteValor));
              row.valor_total = total;
              (row as any)._valor_total_calculado_view = total;
            } else {
              const bonusPercent = clientBonusMap.get(Number(row.id_cliente)) || 0;

              let subtotalProdutos = 0;
              for (const item of items) {
                const itemObj = {
                  quantidade: item.qtd || 0,
                  valorUnitario: item.valor_unt || 0,
                  valorFixo: item.fixo || 0,
                  variacoesEscolhidas: []
                };
                const itemSubtotal = calculateItemSubtotal(itemObj, bonusPercent).subtotal;
                subtotalProdutos += itemSubtotal;
              }

              let descontoGeralCalculado = 0;
              const discount = discountMap.get(row.id_int);
              if (discount) {
                const valorPercentual = Number(discount.valor_percentual ?? 0);
                const valorNominal = Number(discount.valor_nominal ?? 0);
                if (valorPercentual > 0) {
                  descontoGeralCalculado = (subtotalProdutos * valorPercentual) / 100;
                } else {
                  descontoGeralCalculado = valorNominal;
                }
              }

              let totalCalculado = subtotalProdutos + freteValor - descontoGeralCalculado;
              if (totalCalculado === freteValor && subtotalProdutos > 0) {
                totalCalculado = subtotalProdutos + freteValor - descontoGeralCalculado;
              }
              totalCalculado = Math.max(0, totalCalculado);

              row.valor_total = totalCalculado;
              (row as any)._valor_total_calculado_view = totalCalculado;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("[OrcamentosService] Falha ao recalcular valor_total_calculado em lote", err);
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
      diagnostics: fetched.diagnostics as OrcamentosDiagnostics,
      totalCount,
      page: safePage,
      pageSize: safePageSize,
      totalPages
    };
  }

  return {
    ...real,
    totalCount,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    diagnostics: {
      ...fetched.diagnostics,
      source: "supabase",
      fallbackReason: null
    }
  };
}

export async function getPropostaDetailById(idInt: number, overrideClient?: SupabaseClient): Promise<Proposta | null> {
  const client = overrideClient || getSupabaseClient();
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
    let contact = proposalRow.id_contato 
      ? clientObj.contatos.find((c) => c.id === proposalRow.id_contato)
      : undefined;

    if (!contact) {
      contact = clientObj.contatos.find((c) => c.nome === proposalRow.contato);
    }

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

      const variationExtraForLegacy = variacoesEscolhidas.reduce((tot, v) => tot + (v.tipo?.v_extra || 0), 0);
      const derivedBase = (item.valor_unt || 0) - variationExtraForLegacy;
      const finalBase = item.valor_base != null ? Number(item.valor_base) : Math.max(0, derivedBase);

      mappedItens.push({
        id: `item_${item.id}`,
        id_produto_proposta_origem: Number(item.id),
        id_int: Number(item.id_int),
        id_produto: Number(item.id_produto),
        produto: finalProduct,
        // Snapshot gravado; propostas anteriores a coluna vem false (default),
        // ou seja, seguem exigindo arte — padrao seguro.
        isEstoque: item.is_estoque === true,
        nome: item.nome_produto || finalProduct.nomeReal,
        nome_produto: item.nome_produto || finalProduct.nomeReal,
        formato: finalProduct.formato || "",
        descricaoModelo: item.modelo_descri || "",
        quantidade: item.qtd || 0,
        qtd: item.qtd || 0,
        valorUnitario: finalBase,
        valorFixo: item.fixo || 0,
        subtotalBruto: finalBase * (item.qtd || 0) + (item.fixo || 0) + (variationExtraForLegacy * (item.qtd || 0)),
        acrescimoBonus: 0,
        subtotal: item.valor_sub_total || 0,
        prazo: finalProduct.prazo || "7 dias",
        pesoUnitario: item.peso_uni || 0,
        pesoTotal: item.peso_total || 0,
        variacoesEscolhidas,
        statusItem: item.status_item || "PENDENTE"
      });
    }

    // ─── Recalcular bônus do cliente em todos os itens carregados ─────────────
    // A tabela produtos_proposta não possui coluna para acrescimo_bonus.
    // O valor_sub_total gravado pode ser o bruto (sem bônus) em propostas antigas.
    // Recalculamos aqui usando o cadastro já carregado para restaurar os campos:
    //   acrescimoBonus e subtotal corretos na UI.
    // Isso também protege contra dupla aplicação: se o valor_sub_total já estava
    // correto (líquido com bônus), o recalculo garante consistência via valorUnitario + qtd.
    const bonusPercentLoad = clientObj ? getClienteBonusPercent(clientObj as Cadastro) : 0;
    if (bonusPercentLoad > 0) {
      for (const mappedItem of mappedItens) {
        const totals = calculateItemSubtotal(mappedItem, bonusPercentLoad);
        mappedItem.subtotalBruto = totals.subtotalBruto;
        mappedItem.acrescimoBonus = totals.acrescimoBonus;
        mappedItem.subtotal = totals.subtotal;
      }
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

      // QUAL opcao fica marcada e QUAL carrega o `valor_frete` salvo passou a
      // sair da CATEGORIA, nao da comparacao de texto.
      //
      // Antes eram comparacoes exatas e sensiveis a caixa contra "RETIRADA",
      // "SEDEX" e "PAC". As 27 propostas gravadas como `sedex`, `Sedex`,
      // `RETIRA BALCAO`, `Retirada Local` e `Retira` nao casavam, caiam no ramo
      // "transportadora" e levavam o valor do frete para a opcao errada.
      //
      // `categoriaEfetiva` usa `transporte_categoria` quando existe e, quando e
      // nula — toda proposta anterior a 22/08/2026, porque nao houve backfill —
      // cai na leitura tolerante. Rotulo que nao nomeia transporte ("Frete
      // Incluso", "A definir") devolve null e NAO marca opcao nenhuma, que e o
      // certo: ninguem escolheu.
      const categoriaDaProposta = categoriaEfetiva(
        (proposalRow as { transporte_categoria?: unknown }).transporte_categoria as string | null,
        proposalRow.frete_escolhido as string | null
      );
      // PAC nao tem categoria propria (e servico dos Correios, como o SEDEX).
      // Entre as duas opcoes de Correios da lista reconstruida, o rotulo antigo
      // e quem desempata; sem rotulo reconhecivel, SEDEX fica como o padrao
      // historico desta reconstrucao.
      const ehPac = /(^|[^A-Z])PAC([^A-Z]|$)/.test(String(rawFreteEscolhido).toUpperCase());

      // SEM CATEGORIA E SEM CLASSIFICACAO: repete EXATAMENTE a regra anterior.
      //
      // Medido em 22/08/2026 nas 6.114 propostas sem cotacao, que sao as unicas
      // em que esta reconstrucao roda: 5.930 tem rotulo nulo (a regra antiga
      // caia no default "RETIRADA") e 184 dizem "A definir" (caia em
      // transportadora). Deixar essas 184 sem nada marcado trocaria a opcao
      // pre-selecionada de transportadora para retirada — mudanca visivel, sem
      // nada a ganhar, num rotulo que significa justamente "ainda nao decidi".
      //
      // Entao a categoria manda quando existe, a leitura tolerante corrige as
      // grafias divergentes, e o que nao classifica fica como sempre esteve.
      const marcado = categoriaDaProposta
        ? {
            retirada: categoriaDaProposta === "RETIRA",
            sedex: categoriaDaProposta === "CORREIOS" && !ehPac,
            pac: categoriaDaProposta === "CORREIOS" && ehPac,
            transportadora:
              categoriaDaProposta === "TRANSPORTADORA" || categoriaDaProposta === "MOTOBOY"
          }
        : {
            retirada: rawFreteEscolhido === "RETIRADA",
            sedex: rawFreteEscolhido === "SEDEX",
            pac: rawFreteEscolhido === "PAC",
            transportadora: !["RETIRADA", "SEDEX", "PAC"].includes(rawFreteEscolhido)
          };

      fretes = [
        {
          id: "frete_retirada",
          id_int: idInt,
          transportadora: "Retirada Local",
          servico: "Retira na Fábrica",
          valor: marcado.retirada ? rawFreteValor : 0,
          prazo: "Imediato",
          observacao: "Sem custo de entrega",
          escolhido: marcado.retirada,
          pesoUsado: 0
        },
        {
          id: "frete_sedex",
          id_int: idInt,
          transportadora: "Correios SEDEX",
          servico: "Entrega Expressa",
          valor: marcado.sedex ? rawFreteValor : 80,
          prazo: "1 a 3 dias úteis",
          observacao: "Entrega rápida pelos Correios",
          escolhido: marcado.sedex,
          pesoUsado: 0
        },
        {
          id: "frete_pac",
          id_int: idInt,
          transportadora: "Correios PAC",
          servico: "Entrega Econômica",
          valor: marcado.pac ? rawFreteValor : 45,
          prazo: "5 a 10 dias úteis",
          observacao: "Entrega econômica pelos Correios",
          chosen: marcado.pac, // Compatibility
          escolhido: marcado.pac,
          pesoUsado: 0
        },
        {
          id: "frete_transportadora",
          id_int: idInt,
          transportadora: "Transportadora Parceira",
          servico: "Entrega Padrão",
          valor: marcado.transportadora ? rawFreteValor : 120,
          prazo: "4 a 7 dias úteis",
          observacao: "Transportadora parceira do ERP",
          escolhido: marcado.transportadora,
          pesoUsado: 0
        }
      ];
    }

    const chosenFrete = fretes.find((f) => f.escolhido) || fretes[0];
    const freteEscolhidoId = chosenFrete ? chosenFrete.id : "";
    const freteValor = chosenFrete ? chosenFrete.valor : 0;

    const activeItens = mappedItens.filter((it) => it.statusItem !== "CANCELADO");

    // Calculate totals
    const subtotalProdutos = proposalRow.is_avulso
      ? Number(proposalRow.valor ?? 0)
      : activeItens.reduce((sum, it) => sum + it.subtotal, 0);

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
      : activeItens.reduce((sum, it) => sum + it.pesoTotal, 0);

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
      modalidadeFrete: (proposalRow.modalidade_frete as ModalidadeFrete | null) ?? null,
      idTransportadoraCliente:
        proposalRow.id_transportadora_cliente != null ? Number(proposalRow.id_transportadora_cliente) : null,
      resumo: {
        subtotalBrutoProdutos: subtotalProdutos,
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
      obsTecnica: proposalRow.obs_tecnica || "",
      is_avulso: proposalRow.is_avulso === true,
      clienteNaoCadastrado: isClienteNaoCadastrado,
      id_faturado: proposalRow.id_faturado ?? null,
      status_interno: proposalRow.status_interno,
      is_prd_aprovado: proposalRow.is_prd_aprovado === true,
      frete_escolhido: (proposalRow.frete_escolhido as string | null) ?? null,
      // So o valor canonico entra; lixo na coluna cai para null e a tela trata
      // como "ninguem escolheu", em vez de exibir categoria invalida.
      transporteCategoria: ehTransporteCategoria(
        (proposalRow as { transporte_categoria?: unknown }).transporte_categoria
      )
        ? ((proposalRow as { transporte_categoria: TransporteCategoria }).transporte_categoria)
        : null,
      dbValorTotal: proposalRow.valor_total != null ? Number(proposalRow.valor_total) : null,
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

/**
 * Linha de `produtos_proposta` correspondente a um item do formulário.
 *
 * Extraída de dentro do `saveProposta` para virar fonte única: o salvamento
 * completo e o salvamento isolado de um item (`salvarItemProposta`) precisam
 * gravar exatamente as mesmas colunas. Se as duas montagens divergirem, o
 * mesmo item passa a ter dois resultados diferentes conforme o botão clicado.
 */
export function montarDadosItemProposta(item: PropostaItem, idInt: number) {
  const pesoExtra = item.variacoesEscolhidas.reduce((sum, v) => sum + (v.tipo.peso || 0), 0);
  const pesoBase = Math.max(0, (item.produto.peso || 0));
  const pesoUni = pesoBase + pesoExtra;

  const valorExtra = item.variacoesEscolhidas.reduce((sum, v) => sum + (v.tipo.v_extra || 0), 0);

  return {
    id_int: idInt,
    id_produto: item.id_produto,
    nome_produto: item.nome,
    modelo_descri: item.descricaoModelo,
    valor_unt: item.valorUnitario,
    qtd: item.quantidade,
    fixo: item.valorFixo,
    // valor_sub_total = subtotal líquido do item (já inclui desconto manual e bônus do cliente).
    // item.subtotal é o valor calculado por calculateItemSubtotal() na UI — não recalcular aqui
    // para evitar aplicação dupla do bônus (o save deve persistir o que o usuário confirmou).
    valor_sub_total: item.subtotal,
    peso_uni: pesoUni,
    peso_base: pesoBase,
    peso_extra: pesoExtra,
    // valor_base = preço unitário SEM variações. item.valorUnitario já é o
    // preço base (calculateItemSubtotal soma os acréscimos por fora), então
    // subtrair valorExtra aqui zerava o acréscimo: o trigger
    // calcular_valor_sub_total refaz valor_unt = valor_base + valor_extra e
    // o item voltava ao preço base ao recarregar.
    valor_base: item.valorUnitario,
    valor_extra: valorExtra,
    ncm: item.produto.ncm || null,
    cfop: item.produto.cfop_interno || null,
    status_item: item.statusItem || "PENDENTE",
    // Produto de prateleira congelado no item (mesmo espirito de ncm/cfop):
    // desmarcar o produto depois nao pode reabrir exigencia de arte em
    // proposta ja fechada. Item ja gravado mantem o que veio do banco.
    is_estoque: isItemPrateleira(item)
  };
}

/**
 * Grava UM item já existente da proposta, e só ele.
 *
 * POR QUE ISSO EXISTE
 *   A aba Pedido grava cada modelo direto no banco e, antes de gravar, pergunta
 *   ao banco qual a quantidade do item para calcular o saldo. Só que a
 *   quantidade digitada na aba Orçamento vivia apenas na memória até alguém
 *   clicar em "Salvar proposta" — então o card do modelo era validado contra um
 *   número velho e recusava uma quantidade que a tela já mostrava como válida
 *   ("excede o saldo disponível", com o cabeçalho exibindo o valor novo).
 *   Com o item gravado no "Salvar item", os dois lados passam a olhar o mesmo
 *   número.
 *
 * POR QUE AS VARIAÇÕES VÃO JUNTO
 *   `montarDadosItemProposta` deriva `valor_extra`, `peso_extra` e `peso_uni`
 *   das variações escolhidas, e o trigger `calcular_valor_sub_total` refaz o
 *   preço a partir desses campos. Gravar a linha-pai sem regravar
 *   `produtos_proposta_variacao` deixaria o preço refletindo uma variação que
 *   a tabela filha não conhece: ao recarregar, a tela reconstrói a variação da
 *   filha e a escolha do usuário desaparece, com o valor gravado errado. É a
 *   mesma dupla de escritas que o `saveProposta` sempre fez no mesmo laço —
 *   aqui ela é repetida para UM item.
 *
 * O QUE ELA NÃO FAZ, DE PROPÓSITO
 *   Não toca em `propostas`, cobranças, modelos nem na lista de itens
 *   removidos. Não é um "salvar proposta menor": é a gravação de uma linha e
 *   das variações dela.
 */
export async function salvarItemProposta(
  idProdutoProposta: number,
  item: PropostaItem,
  idInt: number
): Promise<{ success: boolean; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase não configurado." };
  }

  // `select` para distinguir "gravou" de "não achou a linha": sem ele o
  // Supabase devolve sucesso quando o UPDATE não atinge nada — por exemplo se
  // o item foi removido em outra aba —, e o card fecharia como se tivesse
  // gravado.
  const { data: atualizados, error } = await client
    .from("produtos_proposta")
    .update(montarDadosItemProposta(item, idInt))
    .eq("id", idProdutoProposta)
    .select("id");

  if (error) {
    console.error(`[OrcamentosService] Falha ao gravar o item #${idProdutoProposta}:`, error.message);
    return { success: false, errorMessage: error.message };
  }

  if (!atualizados || atualizados.length === 0) {
    return {
      success: false,
      errorMessage: "Este item não existe mais nesta proposta. Recarregue a página antes de continuar."
    };
  }

  const { error: erroApagarVariacoes } = await client
    .from("produtos_proposta_variacao")
    .delete()
    .eq("id_produto_proposta", idProdutoProposta);

  if (erroApagarVariacoes) {
    return {
      success: false,
      errorMessage: `Item gravado, mas as variações não puderam ser atualizadas: ${erroApagarVariacoes.message}`
    };
  }

  if (item.variacoesEscolhidas.length > 0) {
    const { error: erroGravarVariacoes } = await client
      .from("produtos_proposta_variacao")
      .insert(
        item.variacoesEscolhidas.map((escolha) => ({
          id_produto_proposta: idProdutoProposta,
          id_variacao: escolha.id_variacao,
          id_tipo_variacao: Number(escolha.tipo.id),
          nome_variacao: escolha.tipo.variacao,
          v_extra: escolha.tipo.v_extra,
          peso_uni: escolha.tipo.peso
        }))
      );

    if (erroGravarVariacoes) {
      return {
        success: false,
        errorMessage: `Item gravado, mas as variações não puderam ser atualizadas: ${erroGravarVariacoes.message}`
      };
    }
  }

  return { success: true };
}

export async function saveProposta(
  formState: PropostaFormState,
  injectedClient?: import('@supabase/supabase-js').SupabaseClient,
  injectedUserId?: string,
  options?: {
    /**
     * Quando true, ignora o bloqueio de salvamento parcial para propostas com
     * cobrança ativa. Use apenas quando o usuário tem permissão "propostas.editar_paga".
     * O chamador é responsável por verificar a permissão antes de passar force=true.
     */
    force?: boolean;
  }
): Promise<{
  success: boolean;
  id_int?: number;
  valor_total?: number;
  errorMessage?: string;
  /**
   * Modelos do pedido que foram inseridos agora: o tempId que a tela usa, o id
   * gerado no banco e o item ao qual ficaram vinculados. Quem chamou precisa
   * aplicar isso no estado (id + isPersisted) — sem essa devolução, o modelo
   * continua marcado como novo e um segundo save insere a mesma linha outra vez.
   */
  modelosSincronizados?: Array<{ tempId: string; id: number; idProdutoPropostaOrigem: number }>;
  /**
   * Itens que foram inseridos agora: o id local da tela (PropostaItem.id) e o id
   * gerado em produtos_proposta. Mesma razão dos modelos — sem devolver isto, o
   * item continua sem id_produto_proposta_origem no estado e o save seguinte o
   * trata como novo: insere outra linha e, no diff do passo 5b, apaga a linha
   * original (FK com ON DELETE CASCADE, levando modelos e variações junto).
   */
  itensSincronizados?: Array<{ itemId: string; id: number }>;
  /**
   * Preenchido quando o salvamento deu certo MAS a modalidade/transportadora
   * declarada na tela foi recusada pela trava de status — o resto foi gravado e
   * o que já estava em `propostas` permanece. Campo aditivo e opcional: quem não
   * lê (rota `editar-paga`, Maestro) segue igual.
   */
  avisoModalidade?: string;
}> {
  const client = injectedClient ?? getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponível." };
  }

  const isUpdate = formState.id_int && Number.isInteger(Number(formState.id_int));
  let id_int: number | null = isUpdate ? Number(formState.id_int) : null;

  let hasActiveCharge = false;

  if (isUpdate && id_int) {
    // Revalidação de segurança no service antes de salvar
    const { data: billings, error: billingsError } = await client
      .from("pagamentos_v2")
      .select("id, status")
      .eq("id_int", id_int);

    if (billingsError) {
      console.error("Erro ao verificar cobranças antes de salvar proposta:", billingsError);
    } else if (billings && billings.length > 0) {
      hasActiveCharge = billings.some(b => b.status !== "CANCELADO" && b.status !== "CANCELADA" && b.status !== "EXTORNADO" && b.status !== "RECUSADO");
      
      if (hasActiveCharge) {
        // Se force=true, o usuário tem permissão propostas.editar_paga — salva completo
        if (options?.force) {
          if (process.env.NODE_ENV === "development") {
            console.log("[DEV][saveProposta] force=true: ignorando lock de cobrança para id_int:", id_int, "— salvamento completo autorizado.");
          }
          // Continua para o fluxo normal de salvamento abaixo
        } else {
          if (process.env.NODE_ENV === "development") {
            console.log("[DEV][saveProposta] hasActiveCharge=true para id_int:", id_int, "→ return early, nenhum DELETE de produto será feito.");
          }
          // Salvamento Parcial Seguro (comportamento padrão sem permissão)
          const { error: partialUpdateError } = await client
            .from("propostas")
            .update({
              obs_proposta: formState.observacoes,
              // A orientacao tecnica acompanha o salvamento parcial: e o
              // unico texto que a producao le, e travar por causa de
              // cobranca ativa deixaria a bancada sem a instrucao.
              obs_tecnica: formState.obsTecnica
            })
            .eq("id_int", id_int);

          if (partialUpdateError) {
            return {
              success: false,
              errorMessage: "Erro ao salvar observações da proposta: " + partialUpdateError.message
            };
          }

          return {
            success: true,
            id_int: id_int,
            errorMessage: "Campos operacionais salvos. Produtos, valores, descontos e frete permanecem bloqueados porque existe cobrança gerada."
          };
        }
      }
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
      // Ordem: o nome resolvido pela tela primeiro (única fonte que enxerga
      // contato adicionado na própria proposta), depois o cadastro.
      //
      // O fallback NUNCA é o contatoId. Era: contato novo nasce com id
      // sintético `cont_prop_<timestamp>`, some da busca em cadastro.contatos
      // e o ID ia parar em `propostas.contato` — foi assim que a #20560 ficou
      // com "cont_prop_1786556302575" e a #20556 com "cont_default" no lugar
      // do nome. Sem nome resolvido, grava vazio: melhor um campo em branco
      // do que um identificador interno aparecendo para o cliente.
      const selectedContact = cadastro?.contatos.find((c) => c.id === formState.contatoId);
      contatoNome = (formState.contatoNome || "").trim() || (selectedContact?.nome || "").trim();
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

    // Proposta não-avulsa sem produtos itemizados: salvar é permitido (decisão
    // do dono em 10/08/2026). Sem itens não há peso, não há cotação de frete e
    // o subtotal é zero — as exigências de frete e de subtotal > 0 passariam a
    // travar a gravação para sempre, que era o que prendia essas propostas no
    // ciclo de "salvar antes de acessar Pagamentos".
    const propostaSemItens =
      !formState.isAvulso &&
      formState.itens.filter((item) => item.statusItem !== "CANCELADO").length === 0;

    // Find the chosen freight option details
    if (!formState.isAvulso && !propostaSemItens) {
      if (!isNonEmpty(formState.freteEscolhidoId)) {
        return { success: false, errorMessage: "Selecione ou informe o frete antes de salvar o orçamento." };
      }
    }
    const chosenFrete = formState.isAvulso ? undefined : formState.fretes.find((f) => f.id === formState.freteEscolhidoId);
    if (formState.isAvulso) {
      const valFrete = parseCurrencyBR(formState.valorFreteManual);
      if (valFrete === null || valFrete < 0) {
        return { success: false, errorMessage: "Selecione ou informe o frete antes de salvar o orçamento." };
      }
      if (!isNonEmpty(formState.observacoesFreteManual)) {
        return { success: false, errorMessage: "Selecione ou informe o frete antes de salvar o orçamento." };
      }
    } else if (!propostaSemItens) {
      if (!chosenFrete) {
        return { success: false, errorMessage: "Selecione ou informe o frete antes de salvar o orçamento." };
      }
    }

    // A modalidade do form vale sempre para o CÁLCULO (numa proposta travada ela
    // é o que veio do banco, exibido somente leitura). O que a trava muda é a
    // GRAVAÇÃO: fora da fase de orçamento os dois campos não entram no UPDATE —
    // travado significa "não altera", nunca "apaga o que o vendedor declarou".
    //
    // O status que decide a trava é o do BANCO AGORA, não o que a tela carregou
    // na abertura. Era essa a origem de 0 gravações em 8.182 propostas: um
    // formulário aberto ainda na fase de orçamento seguia com os botões
    // habilitados depois de a proposta avançar, aceitava o clique e descartava a
    // declaração em silêncio. Falha de leitura cai no status da tela — o
    // comportamento anterior, nunca pior que ele.
    let statusParaGate: string = formState.status;
    let modalidadePersistida: ModalidadeFrete | null = null;
    let transportadoraPersistida: number | null = null;
    let gateLidoDoBanco = false;

    if (isUpdate && id_int) {
      const { data: gateRow, error: gateError } = await client
        .from("propostas")
        .select("status_interno, modalidade_frete, id_transportadora_cliente")
        .eq("id_int", id_int)
        .maybeSingle();

      if (gateError) {
        console.warn("[OrcamentosService] Falha ao reler o status para o gate da modalidade:", gateError);
      } else if (gateRow) {
        gateLidoDoBanco = true;
        statusParaGate = String(gateRow.status_interno ?? formState.status);
        modalidadePersistida = (gateRow.modalidade_frete as ModalidadeFrete | null) ?? null;
        transportadoraPersistida =
          gateRow.id_transportadora_cliente !== null && gateRow.id_transportadora_cliente !== undefined
            ? Number(gateRow.id_transportadora_cliente)
            : null;
      }
    }

    const modalidadeEditavel = podeEditarModalidade(statusParaGate);
    const modalidadeFrete: ModalidadeFrete | null = formState.modalidadeFrete ?? null;
    const idTransportadoraCliente = formState.idTransportadoraCliente ?? null;

    // Declaração que a tela traz e o banco ainda não tem. Só ela vira aviso de
    // recusa: reenviar o que já está gravado não é alteração descartada.
    const declaracaoDivergePersistido =
      modalidadeFrete !== modalidadePersistida || idTransportadoraCliente !== transportadoraPersistida;

    /**
     * A modalidade que governa o DINHEIRO e o RÓTULO desta gravação.
     *
     * Enquanto editável é a da tela — o vendedor está declarando agora. Depois de
     * travada é a do BANCO, e a diferença não é cosmética: se a gravação da
     * declaração foi recusada e o cálculo seguisse a tela, o salvamento
     * reescreveria `valor_frete` e `frete_escolhido` de uma proposta FOB com o
     * valor cotado e o nome do serviço. Seria a mesma incoerência deste eixo
     * entrando pela porta dos fundos: banco dizendo FOB, dinheiro dizendo SEDEX.
     * Travado vale para tudo, não só para as duas colunas.
     *
     * Se a releitura falhou não há valor persistido confiável para usar: cai na
     * tela, que é o comportamento anterior.
     */
    const usarDeclaracaoPersistida = !modalidadeEditavel && gateLidoDoBanco;
    const modalidadeVigente = usarDeclaracaoPersistida ? modalidadePersistida : modalidadeFrete;
    const transportadoraVigente = usarDeclaracaoPersistida
      ? transportadoraPersistida
      : idTransportadoraCliente;

    /** Preenchido quando a trava recusa uma declaração nova — a tela avisa. */
    let avisoModalidade: string | undefined;

    if (modalidadeEditavel && faltaTransportadoraEmFob(modalidadeFrete, idTransportadoraCliente)) {
      return {
        success: false,
        errorMessage: "Em FOB, escolha a transportadora que vai retirar antes de salvar o orçamento."
      };
    }

    // FOB não cobra frete: o valor cotado continua visível na tela como
    // referência, mas o que a proposta grava é zero. Ponto único da regra —
    // `valor_frete`, `cotacao_frete.valor` e o resumo saem todos daqui.
    const freteValor = valorFreteEfetivo(
      formState.isAvulso
        ? (parseCurrencyBR(formState.valorFreteManual) ?? 0)
        : (chosenFrete ? chosenFrete.valor : 0),
      modalidadeVigente
    );

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

    // FOB: quem leva não é o serviço cotado, é a transportadora que o vendedor
    // declarou. `frete_escolhido` é lido pela lista, pelo Maestro e pelo
    // fallback de reconstrução dos fretes — gravar "SEDEX" num pedido que os
    // Correios nunca vão tocar era o começo da cadeia que terminava no PDF da OS
    // e na coluna FRETE da Expedição. Uma leitura só, e só em FOB.
    let nomeTransportadoraDeclarada: string | null = null;
    if (modalidadeVigente === "FOB" && transportadoraVigente !== null) {
      const { data: transpRow, error: transpError } = await client
        .from("clientes")
        .select("id_cliente, nome, fantasia")
        .eq("id_cliente", transportadoraVigente)
        .maybeSingle();

      if (transpError) {
        console.warn("[OrcamentosService] Falha ao resolver a transportadora declarada:", transpError);
      } else if (transpRow) {
        nomeTransportadoraDeclarada = nomeTransportadoraCadastro(transpRow);
      }
    }
    freteNome = nomeTransporteEfetivo(freteNome, modalidadeVigente, nomeTransportadoraDeclarada);

    // Calculo de valores resumo e totais
    const activeItens = formState.itens.filter((item) => item.statusItem !== "CANCELADO");

    const subtotalProdutosBase = formState.isAvulso
      ? (parseCurrencyBR(formState.valorProdutosManual) ?? 0)
      : (activeItens.reduce((total, item) => total + item.subtotal, 0));

    const resumo = formState.isAvulso ? {
      subtotalProdutos: subtotalProdutosBase,
      subtotalBrutoProdutos: subtotalProdutosBase,
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
      activeItens,
      aplicarModalidadeNosFretes(formState.fretes, modalidadeVigente),
      Number.isFinite(Number(formState.descontoGeralValor)) ? Number(formState.descontoGeralValor) : 0,
      formState.descontoGeralTipo
    );

    const subtotalProdutos = resumo.subtotalProdutos;
    const valorTotal = resumo.valorTotal;

    // Proposta sem itens não passa por estas duas exigências: ela vale o que já
    // está gravado (preservado logo abaixo), não o zero calculado agora.
    if (!propostaSemItens) {
      if (subtotalProdutos <= 0) {
        return {
          success: false,
          errorMessage: formState.isAvulso
            ? "Informe o valor dos produtos antes de salvar a proposta avulsa."
            : "O subtotal dos produtos deve ser maior que R$ 0,00."
        };
      }
      if (!Number.isFinite(valorTotal) || valorTotal <= 0) {
        return { success: false, errorMessage: "O valor total financeiro da proposta é inválido ou nulo. Verifique os valores informados." };
      }
    }

    const hasWeightAndCep = !formState.isAvulso && resumo.pesoTotal > 0 && cepText && isNonEmpty(cepText);
    if (hasWeightAndCep && !chosenFrete) {
      return { success: false, errorMessage: "Selecione ou informe o frete antes de salvar o orçamento." };
    }

    // Generate informal WhatsApp text
    const informalText = buildPropostaInformalText({
      id_int: formState.id_int || "NOVO",
      clienteNome,
      itens: activeItens,
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
      contatoNome: contatoNome,
      bonusPercent: cadastro ? getClienteBonusPercent(cadastro as any) : 0
    });

    if (!isNonEmpty(informalText)) {
      return { success: false, errorMessage: "O texto/resumo informal da proposta é obrigatório." };
    }

    // userId: usa injectedUserId se fornecido (Maestro server-side), senão lê da sessão
    let userId: string | undefined = injectedUserId;
    if (!userId) {
      const { data: { session } } = await client.auth.getSession();
      userId = session?.user?.id;
    }

    if (!isUpdate && !userId) {
      return { success: false, errorMessage: "Usuário não identificado. Faça login novamente antes de criar a proposta." };
    }

    let id_faturado: number | null = null;
    if (!formState.clienteNaoCadastrado && cadastro) {
      if (!isNonEmpty(formState.compradorId)) {
        return { success: false, errorMessage: "Selecione um responsável para nota fiscal antes de salvar o orçamento." };
      }
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
      id_contato: formState.clienteNaoCadastrado ? null : formState.contatoId,
      cliente: clienteNome,
      empresa: formState.empresa,
      vendedor: formState.vendedor,
      status_interno: formState.status,
      obs_proposta: formState.observacoes,
      obs_tecnica: formState.obsTecnica,
      texto_whatsapp: informalText,
      contato: contatoNome,
      cep: cepText,
      is_avulso: formState.isAvulso || false
    };

    // Update de proposta já existente que não tem itens: preservar os valores
    // financeiros gravados. Gravar o zero calculado mudaria o total da proposta
    // e derrubaria o saldo restante da cobrança — justamente o que o usuário
    // está tentando gerar. Se o usuário removeu os produtos agora, aí sim os
    // valores são recalculados normalmente.
    const removeuItensNesteSave = (formState.deletedProdutoPropostaIds || []).length > 0;
    const preservarFinanceiroGravado = Boolean(isUpdate) && propostaSemItens && !removeuItensNesteSave;

    if (!preservarFinanceiroGravado) {
      propostaData.valor = subtotalProdutos;
      propostaData.valor_total = valorTotal;
      propostaData.frete_escolhido = freteNome;
      propostaData.valor_frete = freteValor;
    }

    // Só entram no UPDATE enquanto a proposta está na fase de orçamento. Depois
    // de LIBERADO os campos ficam de fora e o que já está gravado permanece.
    if (modalidadeEditavel) {
      propostaData.modalidade_frete = modalidadeFrete;
      // Categoria do transporte: lista fechada, e NULA quando ninguem escolheu.
      // "Nao escolheu" e "escolheu retirada" sao estados diferentes — por isso
      // NAO se replica aqui o default de "RETIRADA" que `frete_escolhido` tem.
      // `frete_escolhido` continua sendo gravada como sempre, logo acima.
      propostaData.transporte_categoria = ehTransporteCategoria(formState.transporteCategoria)
        ? formState.transporteCategoria
        : null;
      propostaData.id_transportadora_cliente = idTransportadoraCliente;
    } else if (declaracaoDivergePersistido) {
      // A trava continua valendo — a proposta não é rebaixada e o que já estava
      // gravado permanece. O que muda é que a recusa passa a ser DITA: descartar
      // a declaração em silêncio foi o que fez o vendedor acreditar, por toda a
      // 20890, que tinha marcado FOB.
      avisoModalidade = motivoBloqueioModalidade(statusParaGate);
    }

    let persistedValorTotal = valorTotal;

    if (isUpdate) {
      // 2a. UPDATE PROPOSTA
      const { data: updatedProp, error: updateError } = await client
        .from("propostas")
        .update(propostaData)
        .eq("id_int", id_int!)
        .select("valor_total")
        .single();

      if (updateError) {
        throw new Error(`Erro ao atualizar proposta no banco: ${updateError.message}`);
      }
      if (updatedProp?.valor_total != null) {
        persistedValorTotal = Number(updatedProp.valor_total);
      }
    } else {
      // 2b. INSERT PROPOSTA
      propostaData.user_id = userId;
      propostaData.proposta = informalText || "Orçamento conforme solicitação.";
      const { data: newProp, error: insertError } = await client
        .from("propostas")
        .insert(propostaData)
        .select("id_int, valor_total")
        .single();

      if (insertError || !newProp) {
        throw new Error(`Erro ao criar proposta no banco: ${insertError?.message || "Sem retorno de ID"}`);
      }

      id_int = Number(newProp.id_int);
      if (newProp?.valor_total != null) {
        persistedValorTotal = Number(newProp.valor_total);
      }
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
          // Peso COTADO, não o peso de agora. Esta linha é a única memória de
          // com quanto o frete foi calculado: gravar o peso atual aqui apagava
          // a própria evidência da divergência — depois de qualquer salvamento
          // a proposta parecia estar com o frete em dia, mesmo com a
          // quantidade alterada, e o aviso de "frete desatualizado" nunca
          // disparava.
          //
          // `||` e não `??`: os fretes sintetizados para proposta sem linha em
          // cotacao_frete nascem com pesoUsado 0, e `??` gravaria esse zero —
          // que é justamente o valor que desliga qualquer comparação.
          peso: formState.isAvulso ? 0 : (chosenFrete?.pesoUsado || resumo.pesoTotal || null),
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

    // Modelos inseridos nesta gravação (tempId da tela -> id do banco).
    const modelosSincronizados: Array<{ tempId: string; id: number; idProdutoPropostaOrigem: number }> = [];
    // Itens inseridos nesta gravação (id local da tela -> produtos_proposta.id).
    const itensSincronizados: Array<{ itemId: string; id: number }> = [];

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
        // Use the preserved ID or fallback to parsing for legacy compatibility
        let parsedItemId: number | null = item.id_produto_proposta_origem || null;
        if (!parsedItemId && item.id.startsWith("item_")) {
          const possibleId = Number(item.id.replace("item_", ""));
          if (!isNaN(possibleId)) parsedItemId = possibleId;
        }
        const isExistingItem = parsedItemId && existingIds.includes(parsedItemId);

        const itemData = montarDadosItemProposta(item, id_int!);

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
          // Devolve o id real para a tela casar com a linha local. O id local
          // (item.id) não é alterado: ele continua sendo a chave de render e o
          // vínculo item_temp_id dos modelos ainda não sincronizados.
          itensSincronizados.push({ itemId: item.id, id: dbItemId });
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

        // C. Gravar modelos novos atrelados a este produto
        // Texto consolidado das variações DESTE item (não do produto): o mesmo
        // produto pode aparecer em várias linhas com variações diferentes.
        const variacoesTextoItem = formatVariacoesItem(item) || null;

        if (formState.pedidosModelos) {
          const modelosDoItem = formState.pedidosModelos.filter(m =>
            (m.id_produto_proposta_origem && m.id_produto_proposta_origem === parsedItemId) ||
            (m.item_temp_id && m.item_temp_id === item.id)
          );

          const modelosNovos = modelosDoItem.filter(m => !m.isPersisted);
          const modelosExistentes = modelosDoItem.filter(m => m.isPersisted && m.id && m.id > 0);

          // C.1 Modelos já gravados: o save da proposta precisa levar as edições
          // feitas na aba Pedido. Antes só os novos eram inseridos, então mudar
          // a cor ou a quantidade de um modelo existente e salvar a proposta não
          // gravava nada — a alteração revertia no recarregamento.
          for (const m of modelosExistentes) {
            const { error: updateModeloError } = await client
              .from("pedidos_modelos")
              .update({
                nome_modelo: m.nome_modelo,
                padrao: m.padrao || null,
                quantidade: m.quantidade,
                tipo_numeracao: m.tipo_numeracao || null,
                numeracao_inicio: m.numeracao_inicio || null,
                numeracao_fim: m.numeracao_fim || null,
                verso_tipo: m.verso_tipo || null,
                bloco: m.bloco || null,
                gabarito_operacional: m.gabarito_operacional || null,
                Q_CAM: m.Q_CAM ?? null,
                L_CAM: m.L_CAM ?? null,
                C_INI: m.C_INI ?? null,
                // status_arte, status_producao e amostra_arte_base64 ficam de
                // fora de propósito: pertencem ao fluxo de arte/produção, não
                // ao formulário da proposta.
              })
              .eq("id", m.id!);

            if (updateModeloError) {
              console.error(`[OrcamentosService] Erro ao atualizar modelo #${m.id} do item #${dbItemId}:`, updateModeloError);
              throw new Error(`Erro ao atualizar modelo #${m.id}: ${updateModeloError.message}`);
            }
          }

          // C.2 Modelos novos: inseridos um a um para poder devolver o id de cada
          // um casado com o tempId da tela (o insert em lote não garante a
          // correspondência por posição).
          let proximaOrdem = modelosExistentes.length;
          for (const m of modelosNovos) {
            proximaOrdem += 1;
            const { data: novoModelo, error: insertModeloError } = await client
              .from("pedidos_modelos")
              .insert({
                id_int: id_int!,
                id_produto_proposta_origem: dbItemId,
                nome_modelo: m.nome_modelo,
                padrao: m.padrao || null,
                quantidade: m.quantidade,
                tipo_numeracao: m.tipo_numeracao || null,
                numeracao_inicio: m.numeracao_inicio || null,
                numeracao_fim: m.numeracao_fim || null,
                verso_tipo: m.verso_tipo || null,
                bloco: m.bloco || null,
                gabarito_operacional: m.gabarito_operacional || null,
                variacoes_texto: variacoesTextoItem,
                Q_CAM: m.Q_CAM ?? null,
                L_CAM: m.L_CAM ?? null,
                C_INI: m.C_INI ?? null,
                // Modelo novo entra no status inicial do fluxo, igual ao que o
                // criarModelo() grava. Herdar o status do modelo copiado fazia a
                // duplicata de um modelo aprovado nascer aprovada.
                status_arte: STATUS_INICIAL_MODELO,
                status_producao: STATUS_INICIAL_MODELO,
                ordem: m.ordem || proximaOrdem
              })
              .select("id")
              .single();

            if (insertModeloError || !novoModelo) {
              console.error(`[OrcamentosService] Erro ao gravar modelo novo do item #${dbItemId}:`, insertModeloError);
              throw new Error(`Erro ao gravar modelos do item #${dbItemId}: ${insertModeloError?.message || "Sem ID de retorno"}`);
            }

            if (m.tempId) {
              modelosSincronizados.push({
                tempId: m.tempId,
                id: Number(novoModelo.id),
                idProdutoPropostaOrigem: dbItemId,
              });
            }
          }
        }

        // C2. Ressincroniza o texto de variações de TODOS os modelos deste item.
        // Cobre o caso de as variações terem sido alteradas em uma proposta que
        // já possuía modelos gravados. Não-fatal: falha aqui não impede o save.
        const { error: syncVariacoesError } = await client
          .from("pedidos_modelos")
          .update({ variacoes_texto: variacoesTextoItem })
          .eq("id_produto_proposta_origem", dbItemId);

        if (syncVariacoesError) {
          console.error(
            `[OrcamentosService] Erro ao sincronizar variacoes_texto do item #${dbItemId}:`,
            syncVariacoesError
          );
        }
      }

      // 5a. DELETE EXPLÍCITO — fonte primária: lista rastreada no frontend
      //     Essa é a fonte confiável de exclusões confirmadas pelo usuário.
      const explicitDeleteIds = (formState.deletedProdutoPropostaIds || []).filter(
        (id) => !incomingItemIds.includes(id) // segurança: não deletar item que ainda está no form
      );

      if (process.env.NODE_ENV === "development") {
        console.log("[DEV][saveProposta] deletedProdutoPropostaIds recebidos:", formState.deletedProdutoPropostaIds);
        console.log("[DEV][saveProposta] explicitDeleteIds (após filtro):", explicitDeleteIds);
        console.log("[DEV][saveProposta] existingIds do banco:", existingIds);
        console.log("[DEV][saveProposta] incomingItemIds do form:", incomingItemIds);
      }

      if (explicitDeleteIds.length > 0) {
        const isPaidEdit = !!options?.force;
        
        if (isPaidEdit) {
          // Inativação lógica para proposta paga (preserva vínculos financeiros/fiscais)
          if (process.env.NODE_ENV === "development") {
            console.log("[DEV][saveProposta] Executando INATIVAÇÃO LÓGICA (CANCELADO) em produtos_proposta para IDs:", explicitDeleteIds);
          }
          
          const { error: logicalDeleteError } = await client
            .from("produtos_proposta")
            .update({ status_item: "CANCELADO" })
            .in("id", explicitDeleteIds);
            
          if (logicalDeleteError) {
            throw new Error("Não foi possível inativar os produtos da proposta paga. Recarregue e tente novamente.");
          }
        } else {
          // Deleção física para propostas comuns
          // Primeiro limpar variações (boa prática, mesmo com cascade)
          const { error: deleteExplicitVarsError } = await client
            .from("produtos_proposta_variacao")
            .delete()
            .in("id_produto_proposta", explicitDeleteIds);

          if (deleteExplicitVarsError) {
            console.error("[OrcamentosService] Erro ao deletar variações dos itens explicitamente removidos:", deleteExplicitVarsError);
          }

          if (process.env.NODE_ENV === "development") {
            console.log("[DEV][saveProposta] Executando DELETE físico em produtos_proposta para IDs:", explicitDeleteIds);
          }

          const { data: explicitDeletedRows, error: explicitDeleteError } = await client
            .from("produtos_proposta")
            .delete()
            .in("id", explicitDeleteIds)
            .select("id");

          if (process.env.NODE_ENV === "development") {
            console.log("[DEV][saveProposta] Retorno do DELETE explícito:", { explicitDeletedRows, explicitDeleteError });
          }

          if (explicitDeleteError) {
            throw new Error("Não foi possível excluir um ou mais produtos da proposta. Recarregue a página e tente novamente.");
          }
        }
      }

      // 5b. DELETE por diff — proteção secundária
      //     Captura produtos que possam ter sumido do form sem passar pelo confirmRemoveProduct
      const deletedItemIds = existingIds.filter(
        (id) => !incomingItemIds.includes(id) && !explicitDeleteIds.includes(id)
      );
      if (deletedItemIds.length > 0) {
        const isPaidEdit = !!options?.force;
        
        if (isPaidEdit) {
          if (process.env.NODE_ENV === "development") {
            console.log("[DEV][saveProposta] INATIVAÇÃO LÓGICA por diff (secundário) para IDs:", deletedItemIds);
          }
          const { error: logicalDeleteDiffError } = await client
            .from("produtos_proposta")
            .update({ status_item: "CANCELADO" })
            .in("id", deletedItemIds);
            
          if (logicalDeleteDiffError) {
            throw new Error("Não foi possível inativar os produtos ausentes da proposta paga.");
          }
        } else {
          if (process.env.NODE_ENV === "development") {
            console.log("[DEV][saveProposta] DELETE físico por diff (secundário) para IDs:", deletedItemIds);
          }

          const { error: deleteRemovedVarsError } = await client
            .from("produtos_proposta_variacao")
            .delete()
            .in("id_produto_proposta", deletedItemIds);

          if (deleteRemovedVarsError) {
            console.error("[OrcamentosService] Erro ao deletar variações dos itens excluídos (diff):", deleteRemovedVarsError);
          }

          const { data: diffDeletedRows, error: deleteRemovedItemsError } = await client
            .from("produtos_proposta")
            .delete()
            .in("id", deletedItemIds)
            .select("id");

          if (process.env.NODE_ENV === "development") {
            console.log("[DEV][saveProposta] Retorno do DELETE por diff:", { diffDeletedRows, deleteRemovedItemsError });
          }

          if (deleteRemovedItemsError) {
            throw new Error("Não foi possível excluir um ou mais produtos da proposta. Recarregue a página e tente novamente.");
          }
        }
      }
    }

    if (formState.isAvulso) {
      const { data: finalUpdated, error: finalUpdateError } = await client
        .from("propostas")
        .update({
          is_avulso: true,
          valor: subtotalProdutos,
          valor_frete: freteValor,
          valor_total: valorTotal
        })
        .eq("id_int", id_int!)
        .select("valor_total")
        .single();

      if (finalUpdateError) {
        console.error("[OrcamentosService] Erro no update final da proposta avulsa:", finalUpdateError);
        throw new Error(`Erro ao finalizar gravação da proposta avulsa: ${finalUpdateError.message}`);
      }
      if (finalUpdated?.valor_total != null) {
        persistedValorTotal = Number(finalUpdated.valor_total);
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

    // --- CONSOLIDAÇÃO FINAL DO VALOR TOTAL ---
    // Força o update do valor total calculado para garantir a persistência
    // caso alguma trigger de itens tenha sobrescrito como null.
    if (!formState.isAvulso) {
      const { data: finalProp, error: finalError } = await client
        .from("propostas")
        .update({ valor_total: valorTotal })
        .eq("id_int", id_int!)
        .select("valor_total")
        .single();
        
      if (finalError) {
        console.error("[OrcamentosService] Erro ao consolidar valor_total final:", finalError);
      } else if (finalProp?.valor_total != null) {
        persistedValorTotal = Number(finalProp.valor_total);
      }
    }

    return {
      success: true,
      id_int: id_int!,
      valor_total: persistedValorTotal,
      modelosSincronizados,
      itensSincronizados,
      avisoModalidade
    };
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
      .in("status_interno", PROPOSTA_STATUS_GROUP_ATIVO_CLIENTE)
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

/**
 * Grava o PAGADOR da proposta. So o pagador (24/08/2026).
 *
 * Ate hoje esta funcao recebia tambem um `idEnderecoEnt` e o gravava junto,
 * na mesma transacao — foi assim que a troca de pagador passou a SUBSTITUIR o
 * endereco de entrega que o usuario tinha escolhido (proposta 21055,
 * 21/08/2026 15:07:23: `id_faturado` 8469→342 e `id_endereco_ent`
 * Garanhuns-PE → Porto Alegre-RS, no mesmo UPDATE).
 *
 * `propostas.id_endereco_ent` passa a ser escrito SO por `saveProposta`, a
 * partir do que o usuario selecionou na secao 5. Trocar pagador nao mexe em
 * endereco.
 *
 * O parametro saiu da assinatura de proposito: mante-lo opcional deixaria a
 * porta aberta para o arrasto voltar sem ninguem perceber.
 */
export async function updatePropostaFiscalDados(
  idInt: number,
  idFaturado: number
): Promise<{ success: boolean; data?: any; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponível." };
  }

  const updatePayload: any = { id_faturado: idFaturado };

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


export async function updatePropostaStatusInterno(
  idInt: number,
  statusInterno: string
): Promise<{ success: boolean; data?: any; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponível." };
  }

  const { data, error } = await client
    .from("propostas")
    .update({ status_interno: statusInterno })
    .eq("id_int", idInt)
    .select("id_int, status_interno")
    .single();

  if (error) {
    console.error("[OrcamentosService] Erro ao atualizar status_interno da proposta:", error);
    return { success: false, errorMessage: error.message || "Erro ao atualizar status interno no banco." };
  }

  return { success: true, data };
}

export type CancelarPropostaResult = {
  success: boolean;
  alreadyCancelled?: boolean;
  code?: string;
  errorMessage?: string;
};

export async function cancelarProposta(idInt: number, motivo: string): Promise<CancelarPropostaResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponível." };
  }

  const sessionResponse = await client.auth.getSession();
  const token = sessionResponse.data.session?.access_token || "";
  if (!token) {
    return { success: false, errorMessage: "Sessão não encontrada. Faça login novamente." };
  }

  try {
    const response = await fetch("/api/orcamentos/cancelar-proposta", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ id_int: idInt, motivo })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, code: data.code, errorMessage: data.message || "Erro ao cancelar a proposta." };
    }

    return { success: true, alreadyCancelled: !!data.alreadyCancelled };
  } catch (err) {
    return { success: false, errorMessage: err instanceof Error ? err.message : "Falha na comunicação com a API." };
  }
}

export async function liberarPropostaParaProducao(idInt: number): Promise<{ success: boolean; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, errorMessage: "Cliente Supabase indisponível." };

  // 1. Validar contexto da proposta
  const { data: prop, error: propErr } = await client
    .from("propostas")
    .select("is_avulso, status_interno, is_prd_aprovado")
    .eq("id_int", idInt)
    .single();

  if (propErr || !prop) return { success: false, errorMessage: "Erro ao buscar proposta." };
  if (prop.is_prd_aprovado) return { success: false, errorMessage: "Proposta já está liberada para produção." };
  if (prop.is_avulso) return { success: false, errorMessage: "Propostas avulsas não vão para produção." };
  if (prop.status_interno?.toUpperCase() !== "REVISAO ATENDENTE") return { success: false, errorMessage: "Status precisa ser REVISAO ATENDENTE." };

  // 2. Validar pagamentos
  const { data: pagamentos, error: pagErr } = await client
    .from("pagamentos_v2")
    .select("status, confirmado")
    .eq("id_int", idInt)
    .not("status", "in", '("CANCELADO","CANCELADA")');

  if (pagErr) return { success: false, errorMessage: "Erro ao buscar pagamentos." };
  const hasValid = pagamentos?.some(p => ["PAID", "A_VENCER"].includes(p.status?.toUpperCase()) && p.confirmado === true);
  const hasInvalid = pagamentos?.some(p => !["PAID", "A_VENCER"].includes(p.status?.toUpperCase()) || p.confirmado !== true);
  
  if (!hasValid || hasInvalid) {
    return { success: false, errorMessage: "Pendências financeiras. Todos os pagamentos ativos precisam estar confirmados (Paid/A Vencer) e deve haver pelo menos um." };
  }

  // 3. Validar artes
  const { data: artes, error: artesErr } = await client
    .from("pedidos_artes")
    .select("status")
    .eq("id_int", idInt);

  if (artesErr) return { success: false, errorMessage: "Erro ao buscar artes." };
  const hasPendenciasArte = artes?.some(a => a.status?.toUpperCase() !== "APROVADO");
  
  if (hasPendenciasArte) {
    return { success: false, errorMessage: "Pendências de arte. Todas as artes devem estar com status APROVADO." };
  }

  // 4. Efetivar liberação
  /**
   * `libera_nf` entra AQUI, no mesmo UPDATE da liberação.
   *
   * A Fila de Faturamento é uma consulta sobre `propostas.libera_nf = true`
   * (`getFaturaveisPropostas`), e até 20/08/2026 essa flag só era ligada por uma
   * ação manual separada, no painel geral da Produção — uma segunda decisão,
   * depois e em outro lugar, para quem já tinha decidido liberar o pedido.
   * Quem revisa e libera para produção já decidiu que o pedido é faturável.
   *
   * No mesmo statement de propósito: é uma escrita atômica na mesma linha, então
   * não existe janela em que o pedido esteja liberado e fora da fila. As guardas
   * acima (avulsa, status, pagamentos, artes) continuam valendo integralmente —
   * nada aqui afrouxa validação, e nenhuma proposta avulsa chega a este ponto.
   *
   * Não mexe em `status_interno` além do que já mudava, não emite nota e não
   * dispara integração fiscal: `libera_nf` apenas HABILITA o faturamento.
   */
  const { error: updateErr } = await client
    .from("propostas")
    .update({ is_prd_aprovado: true, status_interno: "REVISAO PRODUCAO", libera_nf: true })
    .eq("id_int", idInt);

  if (updateErr) return { success: false, errorMessage: "Erro ao atualizar chave de liberação." };
  return { success: true };
}

export async function retirarPropostaDaProducao(idInt: number): Promise<{ success: boolean; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, errorMessage: "Cliente Supabase indisponível." };

  const { error: updateErr } = await client
    .from("propostas")
    .update({ is_prd_aprovado: false })
    .eq("id_int", idInt);

  if (updateErr) return { success: false, errorMessage: "Erro ao retirar proposta da produção." };
  return { success: true };
}
export async function devolverPropostaParaRevisaoAtendente(idInt: number): Promise<{ success: boolean; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, errorMessage: "Cliente Supabase indisponível." };

  const { error: updateErr } = await client
    .from("propostas")
    .update({ is_prd_aprovado: false, status_interno: "REVISAO ATENDENTE" })
    .eq("id_int", idInt);

  if (updateErr) return { success: false, errorMessage: "Erro ao devolver proposta para revisão." };
  return { success: true };
}
