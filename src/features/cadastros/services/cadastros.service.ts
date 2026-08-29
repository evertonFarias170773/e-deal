import { cadastrosMock, getCadastroById } from "@/lib/mocks/cadastros.mock";
import type { Cadastro, CadastroPropostaListItem, CadastroVinculoComercial } from "@/features/cadastros/types";
import type { CadastroCategoria } from "@/features/cadastros/types";
import type {
  SupabaseClienteRow,
  SupabaseClienteSocioRow,
  SupabaseContatoRow,
  SupabaseEnderecoRow,
  SupabasePropostaRow,
  SupabaseUsuarioVendedorRow
} from "@/features/cadastros/types.supabase";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  escolherEnderecoPrincipal,
  TIPO_ENDERECO_PRINCIPAL
} from "@/lib/fiscal/endereco-principal";
import {
  montarAssinaturaEndereco,
  MOTIVO_RECONSULTA_CNPJ
} from "@/features/cadastros/lib/assinatura-endereco";
import {
  mapSupabaseClienteRowToCadastro,
  mapSupabaseSocioRowToCadastroVinculoWithRelated,
  mergeSupabaseRelacionamentos
} from "@/features/cadastros/mappers";

const CLIENTES_LIST_SELECT = [
  "id",
  "id_cliente",
  "nome",
  "apelido",
  "documento",
  "email_contato",
  "telefone_fixo",
  "whatsapp_1",
  "whatsapp_2",
  "ativo",
  "restricao",
  "limite_credito",
  "fantasia",
  "email",
  "nome_vendedor",
  "categoria",
  "risco_credito",
  "cidade_uf",
  "credito"
].join(", ");

export type CadastrosReadSource = "supabase" | "mock";

export type CadastrosReadResult = {
  source: CadastrosReadSource;
  cadastros: Cadastro[];
  totalCount: number;
  hasNextPage: boolean;
  pageIndex: number;
  pageSize: number;
  loadedCount: number;
  warnings: string[];
  errorMessage?: string;
};

export type CadastroDetailReadResult = {
  source: CadastrosReadSource;
  cadastro: Cadastro | null;
  errorMessage?: string;
};

export type ListPropostasDoCadastroQuery = {
  idCliente: number;
  pageIndex?: number;
  pageSize?: number;
  search?: string;
  statusInterno?: string;
};

export type ListPropostasDoCadastroResult = {
  source: CadastrosReadSource;
  propostas: CadastroPropostaListItem[];
  totalCount: number;
  hasNextPage: boolean;
  pageIndex: number;
  pageSize: number;
  warnings: string[];
  errorMessage?: string;
};

function cloneMockCadastros() {
  return cadastrosMock.map((cadastro) => ({
    ...cadastro,
    enderecos: [...cadastro.enderecos],
    contatos: [...cadastro.contatos],
    vinculosComerciais: [...cadastro.vinculosComerciais]
  }));
}

function sortCadastrosByIdClienteDesc(cadastros: Cadastro[]) {
  return [...cadastros].sort((a, b) => b.idCliente - a.idCliente);
}

// O campo de busca do novo orçamento nasce com "#" como dica visual de "buscar
// por ID". Esse caractere é apenas de UI: se chegar ao PostgREST, vira
// `nome.ilike.%#andre%` e zera a busca textual. Removido antes do trim para não
// deixar espaço à esquerda quando o usuário digitar "# andre".
function normalizeSearchTerm(value: string) {
  return value
    .replace(/[%*,#]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeIdCliente(value: unknown) {
  const digits = String(value).replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = toNullableNumber(value);
  return parsed ?? fallback;
}

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return {
    url: url.replace(/\/$/, ""),
    anonKey
  };
}

function buildRestUrl(table: string, params: Record<string, string>) {
  const config = getSupabaseConfig();
  if (!config) {
    return null;
  }

  const url = new URL(`${config.url}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url;
}

async function selectSupabaseRows<T>(table: string, params: Record<string, string>): Promise<T[] | null> {
  const config = getSupabaseConfig();
  if (!config) {
    console.log("[Cadastros][Supabase] envs ausentes - fallback mock ativado.", {
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      table,
      params
    });
    return null;
  }

  const url = buildRestUrl(table, params);
  if (!url) {
    console.log("[Cadastros][Supabase] URL REST invalida - fallback mock ativado.", {
      table,
      params
    });
    return null;
  }

  console.log("[Cadastros][Supabase] chamada executada.", {
    table,
    url: url.toString(),
    select: params.select,
    hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  });

  try {
    const response = await fetch(url.toString(), {
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${config.anonKey}`,
        accept: "application/json",
        "accept-profile": "public"
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.log("[Cadastros][Supabase] resposta HTTP nao-ok.", {
        status: response.status,
        statusText: response.statusText,
        body
      });
      return null;
    }

    const data = (await response.json()) as T[];
    const firstThree = Array.isArray(data)
      ? data.slice(0, 3).map((row) => ({
          id_cliente: (row as { id_cliente?: unknown }).id_cliente,
          nome: (row as { nome?: unknown }).nome
        }))
      : [];

    console.log("[Cadastros][Supabase] resposta OK recebida.", {
      status: response.status,
      registros: Array.isArray(data) ? data.length : 0,
      primeirosRegistros: firstThree
    });
    return Array.isArray(data) ? data : null;
  } catch (error) {
    console.log("[Cadastros][Supabase] erro bruto retornado pelo Supabase.", {
      error
    });
    return null;
  }
}

function fallbackDetailFromMock(idCliente: number | null): Cadastro | null {
  if (!idCliente) {
    return null;
  }

  return getCadastroById(idCliente) ?? null;
}

function normalizeRelatedCadastro(row: SupabaseClienteRow) {
  return {
    nome: row.nome ? String(row.nome).trim() : "",
    documento: row.documento ? String(row.documento).replace(/\D/g, "") : ""
  };
}

type CadastrosListQuery = {
  pageIndex?: number;
  pageSize?: number;
  search?: string;
  categoria?: "TODAS" | CadastroCategoria;
  status?: "TODOS" | "ATIVO" | "INATIVO" | "RESTRICAO";
};

// id_cliente é int4; um termo numérico maior que o limite do inteiro
// (ex.: CPF de 11 dígitos ou CNPJ de 14) faz o PostgREST responder 400.
const INT4_MAX = 2147483647;

/**
 * O prefixo "#" marca busca explícita por ID. `normalizeSearchTerm` apaga o
 * caractere, então a intenção precisa ser lida no termo cru, antes dele.
 */
function isBuscaExplicitaPorId(search: string) {
  return /^\s*#/.test(search);
}

function buildCadastrosSearchClause(search: string) {
  const normalized = normalizeSearchTerm(search);

  // "#N" busca só pelo id_cliente. Sem isso o match exato disputa o mesmo or()
  // com ~11 ilike parciais — para "#14" são milhares de acertos em documento e
  // telefone, e o cliente certo cai fora da primeira página.
  //
  // Só vale quando o que vem depois do "#" é um número que cabe em int4. O campo
  // da Nova proposta NASCE com "#", então "#andre" e "#<cpf>" são busca textual
  // comum e precisam continuar caindo no or() amplo — tratá-los como ID inválido
  // zerava a busca por nome, apelido e documento.
  if (isBuscaExplicitaPorId(search)) {
    const idInformado = normalized.replace(/\s+/g, "");
    if (/^\d+$/.test(idInformado) && Number(idInformado) <= INT4_MAX) {
      return `id_cliente.eq.${Number(idInformado)}`;
    }
  }

  if (!normalized) {
    return "";
  }

  const digits = normalized.replace(/\D/g, "");
  const clauses = [
    `nome.ilike.%${normalized}%`,
    `fantasia.ilike.%${normalized}%`,
    `apelido.ilike.%${normalized}%`,
    `documento.ilike.%${normalized}%`,
    `email.ilike.%${normalized}%`,
    `email_contato.ilike.%${normalized}%`,
    `whatsapp_1.ilike.%${normalized}%`,
    `whatsapp_2.ilike.%${normalized}%`,
    `telefone_fixo.ilike.%${normalized}%`,
    `nome_vendedor.ilike.%${normalized}%`,
    `cidade_uf.ilike.%${normalized}%`
  ];

  // Busca ampla (termo sem "#"): só incluir o filtro por id quando couber em
  // int4, senão o PostgREST responde 400 e derruba a busca inteira.
  // Documentos continuam cobertos por `documento.ilike`.
  if (digits && Number(digits) <= INT4_MAX) {
    clauses.unshift(`id_cliente.eq.${digits}`);
  }

  return clauses.join(",");
}

function applyMockCadastrosQuery(query: Required<Pick<CadastrosListQuery, "pageIndex">> & CadastrosListQuery) {
  const pageSize = Math.min(Math.max(query.pageSize ?? 500, 1), 500);
  const search = normalizeSearchTerm(query.search ?? "");
  const digits = search.replace(/\D/g, "");

  const filtered = sortCadastrosByIdClienteDesc(
    cloneMockCadastros().filter((cadastro) => {
      const searchable = [
        cadastro.idCliente.toString(),
        cadastro.nome,
        cadastro.fantasia ?? "",
        cadastro.documento,
        cadastro.whatsapp,
        cadastro.whatsapp2 ?? "",
        cadastro.telefoneFixo ?? "",
        cadastro.email,
        cadastro.emailFinanceiro ?? "",
        cadastro.cidadeUf,
        cadastro.vendedor,
        cadastro.categoria
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !search ||
        searchable.includes(search.toLowerCase()) ||
        (digits ? cadastro.idCliente.toString() === digits : false);
      const matchesCategoria = !query.categoria || query.categoria === "TODAS" || cadastro.categoria === query.categoria;
      const matchesStatus =
        !query.status ||
        query.status === "TODOS" ||
        (query.status === "ATIVO" && cadastro.ativo && !cadastro.restricao) ||
        (query.status === "INATIVO" && !cadastro.ativo) ||
        (query.status === "RESTRICAO" && cadastro.restricao);

      return matchesSearch && matchesCategoria && matchesStatus;
    })
  );

  const from = query.pageIndex * pageSize;
  const to = from + pageSize;
  const pageItems = filtered.slice(from, to);

  return {
    source: "mock" as const,
    cadastros: pageItems,
    totalCount: filtered.length,
    hasNextPage: to < filtered.length,
    pageIndex: query.pageIndex,
    pageSize,
    loadedCount: pageItems.length,
    warnings: ["Fallback mock ativado para a listagem de cadastros."]
  };
}

export async function getModelosCobranca(): Promise<{ id: string; resultado: string }[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data } = await client.from("modelos_cobranca").select("id, resultado").order("resultado", { ascending: true });
  return data || [];
}

export async function getCadastrosReadOnlyList(query: CadastrosListQuery): Promise<CadastrosReadResult> {
  const pageIndex = Math.max(query.pageIndex ?? 0, 0);
  const pageSize = Math.min(Math.max(query.pageSize ?? 500, 1), 500);
  const from = pageIndex * pageSize;
  const to = from + pageSize - 1;
  const client = getSupabaseClient();

  if (!client) {
    console.log("[Cadastros][List] client Supabase ausente.");
    return {
      source: "supabase",
      cadastros: [],
      totalCount: 0,
      hasNextPage: false,
      pageIndex,
      pageSize,
      loadedCount: 0,
      errorMessage: "Supabase client indisponível.",
      warnings: ["Supabase client ausente. Fallback mock foi removido."]
    };
  }

  const searchClause = buildCadastrosSearchClause(query.search ?? "");

  try {
    let request = client
      .from("clientes")
      .select(CLIENTES_LIST_SELECT, { count: "exact" })
      .order("id_cliente", { ascending: false });

    if (query.categoria && query.categoria !== "TODAS") {
      request = request.eq("categoria", query.categoria);
    }

    if (query.status === "ATIVO") {
      request = request.eq("ativo", true).eq("restricao", false);
    } else if (query.status === "INATIVO") {
      request = request.eq("ativo", false);
    } else if (query.status === "RESTRICAO") {
      request = request.eq("restricao", true);
    }

    if (searchClause) {
      request = request.or(searchClause);
    }

    request = request.range(from, to);

    const { data, error, count } = await request.returns<SupabaseClienteRow[]>();

    if (error) {
      console.log("[Cadastros][List] erro ao consultar Supabase.", {
        message: error instanceof Error ? error.message : String(error)
      });
      return {
        source: "supabase",
        cadastros: [],
        totalCount: 0,
        hasNextPage: false,
        pageIndex,
        pageSize,
        loadedCount: 0,
        errorMessage: error instanceof Error ? error.message : "Erro na consulta do Supabase.",
        warnings: ["Erro Supabase. Fallback mock removido."]
      };
    }

    const cadastros = sortCadastrosByIdClienteDesc((data ?? []).map(mapSupabaseClienteRowToCadastro));
    const totalCount = typeof count === "number" ? count : cadastros.length;
    const hasNextPage = from + cadastros.length < totalCount;

    console.log("[Cadastros][List] dados reais aplicados.", {
      registrosPagina: cadastros.length,
      totalCount,
      pageIndex,
      pageSize
    });

    if (!cadastros.length && totalCount === 0) {
      return {
        source: "supabase",
        cadastros: [],
        totalCount: 0,
        hasNextPage: false,
        pageIndex,
        pageSize,
        loadedCount: 0,
        warnings: ["Nenhum cadastro encontrado para os filtros atuais."]
      };
    }

    return {
      source: "supabase",
      cadastros,
      totalCount,
      hasNextPage,
      pageIndex,
      pageSize,
      loadedCount: cadastros.length,
      warnings: [`Leitura real aplicada em public.clientes com ${cadastros.length} registros na página atual.`]
    };
  } catch (error) {
    console.log("[Cadastros][List] excecao ao consultar Supabase.", { error });
    return {
      source: "supabase",
      cadastros: [],
      totalCount: 0,
      hasNextPage: false,
      pageIndex,
      pageSize,
      loadedCount: 0,
      errorMessage: error instanceof Error ? error.message : "Exceção na consulta de cadastros.",
      warnings: ["Erro inesperado. Fallback mock removido."]
    };
  }
}

export async function getCadastroDetailReadOnly(id: string | number): Promise<CadastroDetailReadResult> {
  const idCliente = normalizeIdCliente(id);

  if (!idCliente) {
    return {
      source: "supabase",
      cadastro: null,
      errorMessage: "ID de cliente inválido."
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      source: "supabase",
      cadastro: null,
      errorMessage: "Supabase client indisponível."
    };
  }

  try {
    const { data: mainRows, error: mainError } = await client
      .from("clientes")
      .select("id,id_cliente,nome,apelido,contato,documento,ins_estadual,ins_municipal,data_fundacao,email_contato,email_financeiro,telefone_fixo,whatsapp_1,whatsapp_2,ativo,restricao,limite_credito,obs,data_criacao,fantasia,email,site,data_cadastro,recebe_email,recebe_whatsapp,tipo_pessoa,nome_vendedor,nota,categoria,risco_credito,ultima_compra,total_compras,verificado,data_verificacao,padrao_pagamento,empresa_padrao,tipo_contribuinte,motivo_erro,cidade_uf,cpf_invalido,cpf_erro,credito,is_bonus,usa_preco_fixo,percentual_bunus,id_modelo_cobranca")
      .eq("id_cliente", idCliente)
      .limit(1);

    const mainRow = mainRows?.[0];
    if (mainError || !mainRow) {
      console.warn(`[CadastrosService] Cliente #${idCliente} não encontrado no banco ou erro.`, mainError);
      return {
        source: "supabase",
        cadastro: null,
        errorMessage: mainError?.message || "Cliente não encontrado no banco."
      };
    }

    const cadastro = mapSupabaseClienteRowToCadastro(mainRow);

    const [enderecosResult, contatosResult, sociosResult, propostasResult] = await Promise.all([
      client
        .from("enderecos")
        .select("id,id_cliente,tipo_endereco,cep,endereco,numero,complemento,bairro,cidade,uf,obs,recebedor,cpf_recebedor")
        .eq("id_cliente", idCliente)
        .limit(100),
      client
        .from("contatos")
        .select("id,id_cliente,nome_contato,cargo,whats,e_mail")
        .eq("id_cliente", idCliente)
        .limit(100),
      client
        .from("clientes_socios")
        .select("id,id_cliente_principal,id_cliente_socio,tipo_relacao")
        .eq("id_cliente_principal", idCliente)
        .limit(100),
      client
        .from("pagamentos_v2")
        .select("valor")
        .eq("id_cliente", idCliente)
        .eq("status", "PAID")
    ]);

    const relatedIds = Array.from(
      new Set(
        (sociosResult.data ?? [])
          .map((row) => normalizeIdCliente(row.id_cliente_socio))
          .filter((value): value is number => value !== null)
      )
    );

    const relatedLookup = new Map<number, ReturnType<typeof normalizeRelatedCadastro>>();

    if (relatedIds.length > 0) {
      const { data: relatedRows } = await client
        .from("clientes")
        .select("id,id_cliente,nome,documento")
        .in("id_cliente", relatedIds)
        .limit(relatedIds.length);

      (relatedRows ?? []).forEach((row) => {
        const normalizedId = normalizeIdCliente(row.id_cliente);
        if (normalizedId !== null) {
          relatedLookup.set(normalizedId, normalizeRelatedCadastro(row));
        }
      });
    }

    let precosFixos: { id_produto: number; preco_fixo: number }[] | undefined;
    if (cadastro.usaPrecoFixo) {
      const { data: precosData } = await client
        .from("clientes_precos_fixos")
        .select("id_produto, preco_fixo")
        .eq("id_cliente", idCliente);
      if (precosData && precosData.length > 0) {
        precosFixos = precosData.map(p => ({
          id_produto: Number(p.id_produto),
          preco_fixo: Number(p.preco_fixo)
        }));
      }
    }

    const pagamentosData = propostasResult?.data || [];
    const totalCompras = pagamentosData.length;
    const valorTotalComprado = pagamentosData.reduce((acc, curr) => acc + Number(curr.valor || 0), 0);

    return {
      source: "supabase",
      cadastro: {
        ...mergeSupabaseRelacionamentos(cadastro, {
          enderecos: enderecosResult.data ?? [],
          contatos: contatosResult.data ?? [],
          socios: (sociosResult.data ?? []).map((row) => ({
            row,
            relatedCadastro: relatedLookup.get(normalizeIdCliente(row.id_cliente_socio) ?? -1) ?? null
          }))
        }),
        precosFixos,
        totalCompras,
        valorTotalComprado
      }
    };
  } catch (err) {
    console.error(`[CadastrosService] Exceção ao buscar detalhes do cliente #${idCliente}:`, err);
    return {
      source: "supabase",
      cadastro: null,
      errorMessage: err instanceof Error ? err.message : "Exceção ao buscar detalhes do cliente."
    };
  }
}

export async function getCadastroCompleto(idCliente: string | number): Promise<CadastroDetailReadResult> {
  return getCadastroDetailReadOnly(idCliente);
}

function mapSupabasePropostaRowToListItem(row: SupabasePropostaRow): CadastroPropostaListItem {
  return {
    id: toText(row.id),
    idInt: toNumber(row.id_int),
    idCliente: toNumber(row.id_cliente),
    cliente: toText(row.cliente).trim(),
    proposta: toText(row.proposta).trim(),
    valor: toNumber(row.valor),
    valorTotal: toNumber(row.valor_total),
    vendedor: toText(row.vendedor).trim(),
    statusInterno: toText(row.status_interno).trim(),
    empresa: toText(row.empresa).trim(),
    createdAt: toText(row.created_at),
    updatedAt: toText(row.updated_at)
  };
}

export async function listPropostasDoCadastro(
  query: ListPropostasDoCadastroQuery
): Promise<ListPropostasDoCadastroResult> {
  const client = getSupabaseClient();
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 50);
  const pageIndex = Math.max(query.pageIndex ?? 0, 0);
  const from = pageIndex * pageSize;
  const to = from + pageSize - 1;

  if (!client || !Number.isInteger(query.idCliente) || query.idCliente <= 0) {
    return {
      source: "supabase",
      propostas: [],
      totalCount: 0,
      hasNextPage: false,
      pageIndex,
      pageSize,
      warnings: ["Leitura de propostas indisponivel: client Supabase ausente ou id_cliente invalido."]
    };
  }

  try {
    let request = client
      .from("propostas")
      .select(
        "id,id_int,id_cliente,cliente,proposta,valor,valor_total,vendedor,status_interno,empresa,created_at,updated_at",
        { count: "exact" }
      )
      .eq("id_cliente", query.idCliente)
      .order("created_at", { ascending: false, nullsFirst: false });

    const search = normalizeSearchTerm(query.search ?? "");
    const digitsSearch = search.replace(/\D/g, "");
    if (search) {
      const clauses = [`proposta.ilike.*${search}*`];
      if (digitsSearch) {
        clauses.unshift(`id_int.eq.${digitsSearch}`);
      }
      request = request.or(clauses.join(","));
    }

    const statusInterno = toText(query.statusInterno).trim();
    if (statusInterno && statusInterno !== "TODOS") {
      request = request.eq("status_interno", statusInterno);
    }

    request = request.range(from, to);

    const { data, error, count } = await request.returns<SupabasePropostaRow[]>();
    if (error) {
      return {
        source: "supabase",
        propostas: [],
        totalCount: 0,
        hasNextPage: false,
        pageIndex,
        pageSize,
        warnings: [error.message || "Erro ao ler propostas em public.propostas."]
      };
    }

    const propostas = (data ?? []).map(mapSupabasePropostaRowToListItem);
    const totalCount = typeof count === "number" ? count : propostas.length;

    return {
      source: "supabase",
      propostas,
      totalCount,
      hasNextPage: from + propostas.length < totalCount,
      pageIndex,
      pageSize,
      warnings: []
    };
  } catch (error) {
    return {
      source: "supabase",
      propostas: [],
      totalCount: 0,
      hasNextPage: false,
      pageIndex,
      pageSize,
      warnings: [error instanceof Error ? error.message : "Falha inesperada ao carregar propostas do cadastro."]
    };
  }
}

export type CadastroObservacoesUpdateResult =
  | {
      success: true;
      updatedObservacoes: string;
    }
  | {
      success: false;
      errorMessage: string;
      status?: number;
    };

export type CadastroOperacionalUpdatePayload = {
  obs?: string;
  fantasia?: string;
  telefone_fixo?: string;
  whatsapp_1?: string;
  whatsapp_2?: string;
  email_contato?: string;
  email?: string;
  email_financeiro?: string;
  site?: string;
};

export type CadastroOperacionalUpdateResult =
  | {
      success: true;
      updatedValues: {
        observacoes: string;
        fantasia: string;
        telefoneFixo: string;
        whatsapp: string;
        whatsapp2: string;
        email: string;
        emailFinanceiro: string;
        site: string;
      };
    }
  | {
      success: false;
      errorMessage: string;
      status?: number;
    };

export type CadastroInsertPayload = {
  id_cliente: number;
  id_vendedor?: string | number | null;
  nome_vendedor?: string | null;
  categoria: CadastroCategoria;
  nome: string;
  fantasia?: string | null;
  apelido?: string | null;
  contato?: string | null;
  documento: string;
  tipo_pessoa: "FISICA" | "JURIDICA";
  ins_estadual?: string | null;
  ins_municipal?: string | null;
  tipo_contribuinte?: string | null;
  data_fundacao?: string | null;
  email_contato?: string | null;
  email_financeiro?: string | null;
  email?: string | null;
  telefone_fixo?: string | null;
  whatsapp_1?: string | null;
  whatsapp_2?: string | null;
  site?: string | null;
  ativo: boolean;
  restricao: boolean;
  limite_credito?: number | string | null;
  credito?: number | string | null;
  risco_credito?: string | null;
  obs?: string | null;
  data_cadastro?: string | null;
  recebe_email: boolean;
  recebe_whatsapp: boolean;
  padrao_pagamento?: string | null;
  empresa_padrao?: string | null;
  cidade_uf?: string | null;
  nota: boolean;
  verificado: boolean;
  ultima_compra?: string | null;
  total_compras?: number | string | null;
  data_verificacao?: string | null;
  motivo_erro?: string | null;
  cpf_invalido?: boolean;
  cpf_erro?: string | null;
  is_bonus?: boolean;
  usa_preco_fixo?: boolean;
  percentual_bunus?: number | string | null;
  id_modelo_cobranca?: string | null;
};

export type CadastroUpdatePayload = Omit<CadastroInsertPayload, "id_cliente">;

export type CadastroEnderecoInsertPayload = {
  id_cliente: number;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  tipo_endereco: string;
  obs: string | null;
  recebedor?: string | null;
  cpf_recebedor?: string | null;
};

export type CadastroEnderecoCreateResult =
  | {
      success: true;
      enderecoId: string;
    }
  | {
      success: false;
      errorMessage: string;
      status?: number;
    };

export type CadastroContatoInsertPayload = {
  id_cliente: number;
  nome_contato: string;
  cargo: string | null;
  whats: string | null;
  e_mail: string | null;
};

export type CadastroVinculoComercialInsertPayload = {
  id_cliente_principal: number;
  id_cliente_socio: number;
  tipo_relacao: string | null;
};

export type CadastroRelatedCreateResult = {
  success: boolean;
  errorMessage?: string;
  status?: number;
};

export type VendedorOption = {
  nome: string;
  idVendedor: string | number | null;
};

export type SearchCadastroVinculoItem = {
  idCliente: number;
  nome: string;
  /**
   * Nome fantasia. Vem vazio quando o cadastro nao tem.
   *
   * Existe porque em boa parte da base o operador conhece o cliente pelo
   * fantasia, nao pela razao social: quem procura "BUSLOG" nao adivinha
   * "METAR LOGISTICA LTDA.".
   */
  fantasia: string;
  documento: string;
};

export type CadastroCreateConflict = {
  kind: "id_cliente" | "documento";
  idCliente: number;
  nome: string;
  documento: string;
};

export type CadastroCreateResult =
  | {
      success: true;
      cadastro: {
        id: string;
        idCliente: number;
        nome: string;
        categoria: CadastroCategoria;
      };
    }
  | {
      success: false;
      errorMessage: string;
      status?: number;
      conflict?: CadastroCreateConflict;
    };

export type CadastroUpdateResult =
  | {
      success: true;
      cadastro: {
        id: string;
        idCliente: number;
        nome: string;
        categoria: CadastroCategoria;
      };
    }
  | {
      success: false;
      errorMessage: string;
      status?: number;
      conflict?: CadastroCreateConflict;
    };

export type CadastroInitialValidationParams = {
  idCliente: number;
  documentoDigits: string;
};

export type CadastroInitialValidationResult =
  | {
      success: true;
      idConflict: null;
      documentoConflict: null;
    }
  | {
      success: false;
      errorMessage: string;
      idConflict: null;
      documentoConflict: null;
    }
  | {
      success: false;
      errorMessage?: string;
      idConflict: CadastroCreateConflict;
      documentoConflict: null;
    }
  | {
      success: false;
      errorMessage?: string;
      idConflict: null;
      documentoConflict: CadastroCreateConflict;
    };

function toText(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function toNullableText(value: unknown) {
  const text = toText(value).trim();
  return text || null;
}

function toNullableId(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  return /^\d+$/.test(text) ? Number(text) : text;
}

function toBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    return ["true", "1", "sim", "s", "yes", "y"].includes(value.trim().toLowerCase());
  }

  return fallback;
}

function toNullableDecimal(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number(String(value).replace(",", "."));
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeDocumento(value: unknown) {
  return toText(value).replace(/\D/g, "");
}

function normalizeClienteWritePayload(payload: CadastroInsertPayload | CadastroUpdatePayload) {
  return {
    id_vendedor: toNullableId(payload.id_vendedor),
    nome_vendedor: toNullableText(payload.nome_vendedor),
    categoria: payload.categoria,
    nome: toText(payload.nome).trim(),
    fantasia: toNullableText(payload.fantasia),
    apelido: toNullableText(payload.apelido),
    contato: toNullableText(payload.contato),
    documento: normalizeDocumento(payload.documento),
    tipo_pessoa: payload.tipo_pessoa,
    ins_estadual: toNullableText(payload.ins_estadual),
    ins_municipal: toNullableText(payload.ins_municipal),
    tipo_contribuinte: toNullableText(payload.tipo_contribuinte),
    data_fundacao: toNullableText(payload.data_fundacao),
    email_contato: toNullableText(payload.email_contato),
    email_financeiro: toNullableText(payload.email_financeiro),
    email: toNullableText(payload.email),
    telefone_fixo: toNullableText(payload.telefone_fixo),
    whatsapp_1: toNullableText(payload.whatsapp_1),
    whatsapp_2: toNullableText(payload.whatsapp_2),
    site: toNullableText(payload.site),
    ativo: toBoolean(payload.ativo, true),
    restricao: toBoolean(payload.restricao, false),
    limite_credito: toNullableDecimal(payload.limite_credito),
    obs: toNullableText(payload.obs),
    data_cadastro: toNullableText(payload.data_cadastro),
    recebe_email: toBoolean(payload.recebe_email, false),
    recebe_whatsapp: toBoolean(payload.recebe_whatsapp, false),
    padrao_pagamento: toNullableText(payload.padrao_pagamento) || "Pix à vista 3 dias",
    empresa_padrao: toNullableText(payload.empresa_padrao),
    cidade_uf: toNullableText(payload.cidade_uf),
    nota: toBoolean(payload.nota, false),
    risco_credito: toNullableText(payload.risco_credito),
    verificado: toBoolean(payload.verificado, false),
    ultima_compra: toNullableText(payload.ultima_compra),
    total_compras: toNullableDecimal(payload.total_compras),
    data_verificacao: toNullableText(payload.data_verificacao),
    motivo_erro: toNullableText(payload.motivo_erro),
    cpf_invalido: toBoolean(payload.cpf_invalido, false),
    cpf_erro: toNullableText(payload.cpf_erro),
    // credito só entra no write quando explicitamente informado — o formulário
    // de cadastro não envia mais o campo (gestão exclusiva da Conta Corrente),
    // e ausência NÃO pode virar null (sobrescreveria o saldo existente).
    ...(payload.credito !== undefined ? { credito: toNullableDecimal(payload.credito) } : {}),
    is_bonus: toBoolean(payload.is_bonus, false),
    usa_preco_fixo: toBoolean(payload.usa_preco_fixo, false),
    percentual_bunus: toNullableDecimal(payload.percentual_bunus),
    id_modelo_cobranca: payload.id_modelo_cobranca ?? null
  };
}

function formatDocumentoFromDigits(value: string) {
  const digits = normalizeDocumento(value);
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }

  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }

  return digits;
}

function mapConflictFromRow(
  row: Pick<SupabaseClienteRow, "id_cliente" | "nome" | "documento">,
  kind: CadastroCreateConflict["kind"],
  fallbackIdCliente: number
): CadastroCreateConflict {
  return {
    kind,
    idCliente: Number(row.id_cliente) || fallbackIdCliente,
    nome: toText(row.nome),
    documento: normalizeDocumento(row.documento)
  };
}

async function findCadastroByExactField(field: "id_cliente" | "documento", value: string) {
  const rows = await selectSupabaseRows<
    Pick<SupabaseClienteRow, "id" | "id_cliente" | "nome" | "documento">
  >("clientes", {
    select: "id,id_cliente,nome,documento",
    [field]: `eq.${value}`,
    limit: "1"
  });

  return rows?.[0] ?? null;
}

async function findCadastroByDocumento(documentoDigits: string) {
  const normalized = normalizeDocumento(documentoDigits);
  if (!normalized) {
    return null;
  }

  const variants = Array.from(new Set([normalized, formatDocumentoFromDigits(normalized)]));

  for (const variant of variants) {
    const row = await findCadastroByExactField("documento", variant);
    if (row) {
      return row;
    }
  }

  const prefix = normalized.slice(0, Math.min(8, normalized.length));
  const suffix = normalized.slice(-4);
  if (!prefix || !suffix) {
    return null;
  }

  const candidates = await selectSupabaseRows<
    Pick<SupabaseClienteRow, "id" | "id_cliente" | "nome" | "documento">
  >("clientes", {
    select: "id,id_cliente,nome,documento",
    or: `documento.ilike.*${prefix}*,documento.ilike.*${suffix}*`,
    limit: "20"
  });

  if (!candidates?.length) {
    return null;
  }

  return (
    candidates.find((item) => normalizeDocumento(item.documento) === normalized) ?? null
  );
}

export async function validateCadastroInitialStep(
  params: CadastroInitialValidationParams
): Promise<CadastroInitialValidationResult> {
  const config = getSupabaseConfig();
  if (!config) {
    return {
      success: false,
      errorMessage: "Configuracao Supabase ausente para validar duplicidades.",
      idConflict: null,
      documentoConflict: null
    };
  }

  const existingId = await findCadastroByExactField("id_cliente", String(params.idCliente));
  if (existingId) {
    return {
      success: false,
      idConflict: mapConflictFromRow(existingId, "id_cliente", params.idCliente),
      documentoConflict: null
    };
  }

  const existingDocument = await findCadastroByDocumento(params.documentoDigits);
  if (existingDocument) {
    return {
      success: false,
      idConflict: null,
      documentoConflict: mapConflictFromRow(existingDocument, "documento", params.idCliente)
    };
  }

  return {
    success: true,
    idConflict: null,
    documentoConflict: null
  };
}

function normalizeOperationalUpdatePayload(payload: CadastroOperacionalUpdatePayload) {
  const normalized: CadastroOperacionalUpdatePayload = {};

  if (payload.obs !== undefined) normalized.obs = payload.obs;
  if (payload.fantasia !== undefined) normalized.fantasia = payload.fantasia;
  if (payload.telefone_fixo !== undefined) normalized.telefone_fixo = payload.telefone_fixo;
  if (payload.whatsapp_1 !== undefined) normalized.whatsapp_1 = payload.whatsapp_1;
  if (payload.whatsapp_2 !== undefined) normalized.whatsapp_2 = payload.whatsapp_2;
  if (payload.email_contato !== undefined) normalized.email_contato = payload.email_contato;
  if (payload.email !== undefined) normalized.email = payload.email;
  if (payload.email_financeiro !== undefined) normalized.email_financeiro = payload.email_financeiro;
  if (payload.site !== undefined) normalized.site = payload.site;

  return normalized;
}

export async function updateCadastroCamposOperacionaisReadOnly(
  idCliente: number,
  payload: CadastroOperacionalUpdatePayload
): Promise<CadastroOperacionalUpdateResult> {
  const config = getSupabaseConfig();

  if (!config) {
    return {
      success: false,
      errorMessage: "Configuracao Supabase ausente no ambiente do app."
    };
  }

  const sanitizedPayload = normalizeOperationalUpdatePayload(payload);
  const hasPayload = Object.keys(sanitizedPayload).length > 0;

  if (!hasPayload) {
    return {
      success: false,
      errorMessage: "Nenhum campo liberado foi informado para atualizacao."
    };
  }

  const url = buildRestUrl("clientes", {
    id_cliente: `eq.${idCliente}`,
    select: "id_cliente,obs,fantasia,telefone_fixo,whatsapp_1,whatsapp_2,email_contato,email,email_financeiro,site"
  });

  if (!url) {
    return {
      success: false,
      errorMessage: "Nao foi possivel montar a URL de update do Supabase."
    };
  }

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      apikey: config.anonKey,
      authorization: `Bearer ${config.anonKey}`,
      accept: "application/json",
      "accept-profile": "public",
      "content-type": "application/json",
      prefer: "return=representation"
    },
    body: JSON.stringify(sanitizedPayload)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      success: false,
      errorMessage: `Erro HTTP ao gravar campos operacionais no Supabase: ${response.status} ${response.statusText}. ${body}`,
      status: response.status
    };
  }

  const data = (await response.json().catch(() => [])) as Array<{
    obs?: unknown;
    fantasia?: unknown;
    telefone_fixo?: unknown;
    whatsapp_1?: unknown;
    whatsapp_2?: unknown;
    email_contato?: unknown;
    email?: unknown;
    email_financeiro?: unknown;
    site?: unknown;
  }>;

  if (!Array.isArray(data) || data.length === 0) {
    return {
      success: false,
      errorMessage: "Supabase nao retornou nenhum registro atualizado para os campos operacionais."
    };
  }

  const row = data[0];

  return {
    success: true,
    updatedValues: {
      observacoes: toText(row.obs),
      fantasia: toText(row.fantasia),
      telefoneFixo: toText(row.telefone_fixo),
      whatsapp: toText(row.whatsapp_1),
      whatsapp2: toText(row.whatsapp_2),
      email: toText(row.email_contato) || toText(row.email),
      emailFinanceiro: toText(row.email_financeiro),
      site: toText(row.site)
    }
  };
}

export async function updateCadastroObservacoesReadOnly(
  idCliente: number,
  observacoes: string
): Promise<CadastroObservacoesUpdateResult> {
  const result = await updateCadastroCamposOperacionaisReadOnly(idCliente, {
    obs: observacoes
  });

  if (!result.success) {
    return result;
  }

  return {
    success: true,
    updatedObservacoes: result.updatedValues.observacoes
  };
}

export async function createCadastro(
  payload: CadastroInsertPayload
): Promise<CadastroCreateResult> {
  const config = getSupabaseConfig();

  if (!config) {
    return {
      success: false,
      errorMessage: "Configuracao Supabase ausente no ambiente do app."
    };
  }

  const idCliente = Number(payload.id_cliente);
  if (!Number.isInteger(idCliente) || idCliente <= 0) {
    return {
      success: false,
      errorMessage: "O ID do cliente precisa ser um numero inteiro valido."
    };
  }

  const documento = normalizeDocumento(payload.documento);
  if (!documento) {
    return {
      success: false,
      errorMessage: "O documento precisa ser informado."
    };
  }

  const existingId = await findCadastroByExactField("id_cliente", String(idCliente));
  if (existingId) {
    return {
      success: false,
      errorMessage: `Já existe um cadastro com este ID: ${toText(existingId.id_cliente)} - ${toText(existingId.nome)}.`,
      conflict: {
        kind: "id_cliente",
        idCliente: Number(existingId.id_cliente) || idCliente,
        nome: toText(existingId.nome),
        documento: normalizeDocumento(existingId.documento)
      }
    };
  }

  const existingDocument = await findCadastroByExactField("documento", documento);
  if (existingDocument) {
    return {
      success: false,
      errorMessage: `Já existe um cadastro com este documento: ${documento} - ${toText(existingDocument.nome)}.`,
      conflict: {
        kind: "documento",
        idCliente: Number(existingDocument.id_cliente) || 0,
        nome: toText(existingDocument.nome),
        documento: normalizeDocumento(existingDocument.documento)
      }
    };
  }

  const insertPayload = {
    id_cliente: idCliente,
    ...normalizeClienteWritePayload({
      ...payload,
      documento
    })
  };

  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      errorMessage: "Cliente Supabase indisponivel para executar o insert."
    };
  }

  const { data, error } = await client
    .from("clientes")
    .insert(insertPayload)
    .select("id,id_cliente,nome,categoria")
    .single();

  if (error) {
    return {
      success: false,
      errorMessage: error.message || "Nao foi possivel criar o cadastro no Supabase.",
      status: error.code ? Number(error.code) : undefined
    };
  }

  if (!data) {
    return {
      success: false,
      errorMessage: "Supabase nao retornou o registro criado."
    };
  }

  return {
    success: true,
    cadastro: {
      id: toText(data.id),
      idCliente: Number(data.id_cliente) || idCliente,
      nome: toText(data.nome),
      categoria: data.categoria as CadastroCategoria
    }
  };
}

export async function updateCadastro(
  idCliente: number,
  payload: CadastroUpdatePayload
): Promise<CadastroUpdateResult> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      errorMessage: "Cliente Supabase indisponivel para executar o update."
    };
  }

  if (!Number.isInteger(idCliente) || idCliente <= 0) {
    return {
      success: false,
      errorMessage: "ID do cliente invalido para update."
    };
  }

  const documento = normalizeDocumento(payload.documento);
  if (!documento) {
    return {
      success: false,
      errorMessage: "Documento obrigatorio para atualizar cadastro."
    };
  }

  const existingDocument = await findCadastroByDocumento(documento);
  if (existingDocument && Number(existingDocument.id_cliente) !== idCliente) {
    return {
      success: false,
      errorMessage: `Já existe um cadastro com este documento: ${documento} - ${toText(existingDocument.nome)}.`,
      conflict: {
        kind: "documento",
        idCliente: Number(existingDocument.id_cliente) || 0,
        nome: toText(existingDocument.nome),
        documento: normalizeDocumento(existingDocument.documento)
      }
    };
  }

  const updatePayload = normalizeClienteWritePayload({
    ...payload,
    documento
  });

  const { data, error } = await client
    .from("clientes")
    .update(updatePayload)
    .eq("id_cliente", idCliente)
    .select("id,id_cliente,nome,categoria")
    .single();

  if (error) {
    return {
      success: false,
      errorMessage: error.message || "Nao foi possivel atualizar o cadastro no Supabase.",
      status: error.code ? Number(error.code) : undefined
    };
  }

  if (!data) {
    return {
      success: false,
      errorMessage: "Supabase nao retornou o registro atualizado."
    };
  }

  return {
    success: true,
    cadastro: {
      id: toText(data.id),
      idCliente: Number(data.id_cliente) || idCliente,
      nome: toText(data.nome),
      categoria: data.categoria as CadastroCategoria
    }
  };
}

/**
 * Inativa um cadastro (clientes.ativo = false).
 *
 * Escrita mínima e dedicada: `updateCadastro` exige o payload completo e revalida
 * documento, o que não faz sentido para uma inativação — e sobrescreveria campos
 * que a tela da lista não conhece. Aqui só a flag é tocada.
 */
export async function inativarCadastro(
  idCliente: number
): Promise<{ success: boolean; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponivel." };
  }
  if (!Number.isInteger(idCliente) || idCliente <= 0) {
    return { success: false, errorMessage: "ID do cliente invalido." };
  }

  const { data, error } = await client
    .from("clientes")
    .update({ ativo: false })
    .eq("id_cliente", idCliente)
    .select("id_cliente")
    .maybeSingle();

  if (error) {
    console.error("[CadastrosService] Erro ao inativar cadastro:", error);
    return {
      success: false,
      errorMessage:
        error.code === "42501"
          ? "Sem permissão para inativar este cadastro."
          : error.message || "Não foi possível inativar o cadastro."
    };
  }
  if (!data) {
    return { success: false, errorMessage: "Cadastro não encontrado ou sem permissão de escrita." };
  }
  return { success: true };
}

/**
 * Campos do cadastro que a reconsulta do CNPJ pode sobrescrever.
 *
 * So estes. A Receita nao sabe nada sobre WhatsApp, limite de credito, vendedor
 * ou padrao de pagamento — e o que ela nao sabe nao pode apagar.
 */
export type ReconsultaCamposCadastro = Partial<{
  nome: string;
  fantasia: string;
  data_fundacao: string;
  email_contato: string;
  /** A mesma informacao de `email_contato`; as duas colunas andam juntas desde antes desta rodada. */
  email: string;
  telefone_fixo: string;
  cidade_uf: string;
  ins_estadual: string;
  tipo_contribuinte: string;
}>;

/** O endereco que a consulta devolveu, ja no formato da tabela `enderecos`. */
export type ReconsultaEnderecoReceita = {
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export type ReconsultaResultado = {
  success: boolean;
  errorMessage?: string;
  /** O que aconteceu com o endereco PRINCIPAL — para a tela contar ao usuario. */
  enderecoAcao?: "atualizado" | "criado" | "nao-informado";
  /**
   * `id` da linha gravada e a assinatura escrita em `obs`. A tela precisa dos
   * dois para espelhar no formulario o que foi para o banco: sem o `id`, um
   * endereco recem-criado ficaria com id temporario e o "Salvar" seguinte
   * INSERIRIA uma segunda linha principal.
   */
  enderecoId?: string;
  enderecoObs?: string;
};

/**
 * APLICA a reconsulta do CNPJ num cadastro que ja existe.
 *
 * POR QUE EXISTE (26/08/2026)
 *   Nao havia como corrigir o endereco principal de um cliente ja cadastrado. A
 *   consulta a Receita so acontecia na CRIACAO; depois disso o bloco do endereco
 *   principal e somente-leitura na tela. Cadastros que herdaram endereco orfao
 *   de outro cliente — porque `enderecos` nao tem chave estrangeira e o
 *   `id_cliente` e digitado a mao — ficavam com endereco errado, e esse endereco
 *   e exatamente o que alimenta a etiqueta dos Correios e o destinatario da
 *   NF-e.
 *
 * O QUE ELA FAZ
 *   1. sobrescreve em `clientes` SO os campos recebidos em `campos` — quem monta
 *      o objeto e a tela, que so inclui o que a consulta devolveu preenchido e o
 *      que o usuario confirmou. Campo vazio na Receita nunca chega aqui, entao
 *      dado bom nunca e trocado por vazio;
 *   2. sobrescreve o endereco marcado PRINCIPAL com o da consulta;
 *   3. se nao houver PRINCIPAL, CRIA um.
 *
 * O QUE ELA NAO FAZ, POR DECISAO
 *   - nao encosta em endereco de outro tipo (ENTREGA, COBRANCA, FISCAL). O
 *     UPDATE e por `id` da linha eleita, e o INSERT nasce PRINCIPAL;
 *   - nao apaga endereco nenhum, em hipotese nenhuma. Endereco errado vira
 *     endereco certo por cima; nada e removido;
 *   - nao roda para CPF. Pessoa fisica nao tem consulta de CNPJ, e a tela nem
 *     oferece o botao.
 *
 * QUEM FEZ E QUANDO
 *   Em `clientes` isso ja e automatico: a tabela tem `trg_audit_clientes`, e
 *   cada UPDATE grava em `audit.logs_v2` o `actor_email`, o `occurred_at` e o
 *   diff dos campos.
 *
 *   `enderecos` NAO e auditada (nao esta em `audit.config_v2`), e por isso a
 *   assinatura vai no proprio registro, em `enderecos.obs`. Sem ela, sobrescrever
 *   o endereco principal seria uma alteracao sem rastro em lugar nenhum — e foi
 *   justamente a falta de rastro que tornou o bug do endereco orfao tao dificil
 *   de enxergar.
 */
export async function aplicarReconsultaCnpj(input: {
  idCliente: number;
  campos: ReconsultaCamposCadastro;
  endereco: ReconsultaEnderecoReceita | null;
  autor: string;
  quandoIso: string;
}): Promise<ReconsultaResultado> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponivel." };
  }

  const idCliente = Number(input.idCliente);
  if (!Number.isInteger(idCliente) || idCliente <= 0) {
    return { success: false, errorMessage: "ID de cliente invalido para a reconsulta." };
  }

  if (Object.keys(input.campos).length > 0) {
    const { error } = await client.from("clientes").update(input.campos).eq("id_cliente", idCliente);
    if (error) {
      return { success: false, errorMessage: error.message || "Erro ao atualizar os dados do cliente." };
    }
  }

  if (!input.endereco) {
    return { success: true, enderecoAcao: "nao-informado" };
  }

  const assinatura = montarAssinaturaEndereco(MOTIVO_RECONSULTA_CNPJ, input.autor, input.quandoIso);
  const camposEndereco = {
    cep: toNullableText(input.endereco.cep),
    endereco: toNullableText(input.endereco.endereco),
    numero: toNullableText(input.endereco.numero),
    complemento: toNullableText(input.endereco.complemento),
    bairro: toNullableText(input.endereco.bairro),
    cidade: toNullableText(input.endereco.cidade),
    uf: toNullableText(input.endereco.uf),
    obs: assinatura
  };

  // Todos os enderecos do cliente, para a ESCOLHA usar a mesma regra da NF e da
  // etiqueta. Filtrar por `tipo_endereco` aqui daria uma quarta regra na casa.
  const { data: linhas, error: erroLeitura } = await client
    .from("enderecos")
    .select("id,tipo_endereco,data_criacao")
    .eq("id_cliente", idCliente);

  if (erroLeitura) {
    return {
      success: false,
      errorMessage: erroLeitura.message || "Erro ao localizar o endereco principal do cliente."
    };
  }

  const principal = escolherEnderecoPrincipal(
    (linhas ?? []) as Array<{ id: string; tipo_endereco: string | null; data_criacao: string | null }>
  );

  if (principal) {
    const { error } = await client.from("enderecos").update(camposEndereco).eq("id", principal.id);
    if (error) {
      return { success: false, errorMessage: error.message || "Erro ao gravar o endereco principal." };
    }
    return {
      success: true,
      enderecoAcao: "atualizado",
      enderecoId: String(principal.id),
      enderecoObs: assinatura
    };
  }

  // Sem principal: cria. Nao e o caso comum, mas existe — 55 cadastros estavam
  // assim em 26/08/2026, e sem endereco principal a NF-e sai sem destinatario.
  const { data: criado, error } = await client
    .from("enderecos")
    .insert({
      id_cliente: idCliente,
      tipo_endereco: TIPO_ENDERECO_PRINCIPAL,
      ...camposEndereco
    })
    .select("id")
    .single();
  if (error) {
    return { success: false, errorMessage: error.message || "Erro ao criar o endereco principal." };
  }
  return {
    success: true,
    enderecoAcao: "criado",
    enderecoId: String((criado as { id?: string } | null)?.id ?? ""),
    enderecoObs: assinatura
  };
}


export async function checkVinculoRemovability(
  idFaturadoSocio: number
): Promise<{ blocked: boolean; reason?: string; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { blocked: true, errorMessage: "Cliente Supabase indisponível." };
  }

  // PASSO 1: Verificar propostas APROVADAS ou ATIVAS na fábrica
  const { data: propostas, error: propError } = await client
    .from("propostas")
    .select("id, id_int")
    .eq("id_faturado", idFaturadoSocio)
    .in("status_interno", [
      "APROVADO",
      "APROVADO / EM ARTE",
      "REVISAO ATENDENTE",
      "REVISAO PRODUCAO",
      "EM PRODUCAO",
      "EM IMPRESSAO",
      "EM IMPRESSAO / PENDENTE",
      "EM ACABAMENTO",
      "EM ACABAMENTO / PENDENTE",
      "EXPEDICAO",
      "A RETIRAR",
      "EM TRANSITO",
      "ENTREGUE"
    ]);

  if (propError) {
    return { blocked: true, errorMessage: propError.message };
  }

  if (propostas && propostas.length > 0) {
    return { blocked: true, reason: "Este vínculo participa de propostas aprovadas." };
  }

  // PASSO 2: Verificar pagamentos PAID ligados às propostas desse sócio
  // Já que join pode falhar, usamos fluxo em 2 passos.
  const { data: todasPropostas, error: propAllError } = await client
    .from("propostas")
    .select("id_int")
    .eq("id_faturado", idFaturadoSocio);

  if (propAllError) {
    return { blocked: true, errorMessage: propAllError.message };
  }

  const idsInt = todasPropostas?.map((p) => p.id_int).filter(Boolean) || [];
  
  if (idsInt.length > 0) {
    const { data: pagamentos, error: pagError } = await client
      .from("pagamentos_v2")
      .select("id")
      .in("id_int", idsInt)
      .eq("status", "PAID")
      .limit(1);

    if (pagError) {
      return { blocked: true, errorMessage: pagError.message };
    }

    if (pagamentos && pagamentos.length > 0) {
      return { blocked: true, reason: "Este vínculo possui histórico financeiro." };
    }
  }

  return { blocked: false };
}

export async function deleteVinculoComercial(
  id: string
): Promise<CadastroRelatedCreateResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponivel para excluir vinculo." };
  }

  const { error } = await client
    .from("clientes_socios")
    .delete()
    .eq("id", id);

  if (error) {
    return {
      success: false,
      errorMessage: error.message || "Nao foi possivel excluir o vinculo.",
      status: error.code ? Number(error.code) : undefined
    };
  }
  return { success: true };
}

export async function createCadastroEndereco(
  payload: CadastroEnderecoInsertPayload
): Promise<CadastroEnderecoCreateResult> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      errorMessage: "Cliente Supabase indisponivel para executar o insert de endereco."
    };
  }

  const idCliente = Number(payload.id_cliente);
  if (!Number.isInteger(idCliente) || idCliente <= 0) {
    return {
      success: false,
      errorMessage: "ID do cliente invalido para salvar endereco."
    };
  }

  const insertPayload = {
    id_cliente: idCliente,
    cep: toNullableText(payload.cep),
    endereco: toNullableText(payload.endereco),
    numero: toNullableText(payload.numero),
    complemento: toNullableText(payload.complemento),
    bairro: toNullableText(payload.bairro),
    cidade: toNullableText(payload.cidade),
    uf: toNullableText(payload.uf),
    tipo_endereco: toNullableText(payload.tipo_endereco) || "ENTREGA",
    obs: toNullableText(payload.obs),
    recebedor: toNullableText(payload.recebedor),
    cpf_recebedor: toNullableText(payload.cpf_recebedor)
  };

  const { data, error } = await client
    .from("enderecos")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) {
    return {
      success: false,
      errorMessage: error.message || "Nao foi possivel salvar o endereco no Supabase.",
      status: error.code ? Number(error.code) : undefined
    };
  }

  return {
    success: true,
    enderecoId: toText(data?.id)
  };
}

/**
 * Grava os enderecos de um cadastro NOVO.
 *
 * PASSOU A CHAMAR O SERVIDOR EM 26/08/2026, e nao mais a escrever direto no
 * PostgREST. O motivo esta em `src/app/api/cadastros/enderecos/route.ts`: a
 * regra do PRINCIPAL unico tem de valer no servidor, nao so nesta tela. Um
 * INSERT solto daqui era o caminho pelo qual um cadastro novo herdava o endereco
 * orfao de um `id_cliente` reaproveitado.
 *
 * O resultado devolve o que aconteceu com o principal, para a tela avisar quando
 * um endereco pre-existente foi SOBRESCRITO — o usuario precisa saber que aquele
 * numero de cliente ja tinha endereco.
 */
export async function createCadastroEnderecos(
  payload: CadastroEnderecoInsertPayload[]
): Promise<CadastroRelatedCreateResult & {
  principalAcao?: "sobrescrito" | "criado" | "nao-informado";
  principalId?: string | null;
}> {
  if (!payload.length) {
    return { success: true };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      errorMessage: "Cliente Supabase indisponivel para executar o insert de enderecos."
    };
  }

  const idsDistintos = Array.from(new Set(payload.map((item) => Number(item.id_cliente))));
  if (idsDistintos.length !== 1 || !Number.isInteger(idsDistintos[0]) || idsDistintos[0] <= 0) {
    return {
      success: false,
      errorMessage: "Os enderecos de um cadastro precisam pertencer todos ao mesmo id_cliente."
    };
  }

  const sessao = await client.auth.getSession();
  const token = sessao.data.session?.access_token || "";
  if (!token) {
    return { success: false, errorMessage: "Sessao expirada. Entre novamente para salvar os enderecos." };
  }

  try {
    const resposta = await fetch("/api/cadastros/enderecos", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        idCliente: idsDistintos[0],
        enderecos: payload.map((item) => ({
          cep: item.cep,
          endereco: item.endereco,
          numero: item.numero,
          complemento: item.complemento,
          bairro: item.bairro,
          cidade: item.cidade,
          uf: item.uf,
          tipo_endereco: item.tipo_endereco,
          obs: item.obs,
          recebedor: item.recebedor ?? null,
          cpf_recebedor: item.cpf_recebedor ?? null
        }))
      })
    });

    const resultado = await resposta.json().catch(() => null);

    if (!resposta.ok || !resultado?.success) {
      return {
        success: false,
        errorMessage: resultado?.message || "Nao foi possivel salvar os enderecos.",
        status: resposta.status
      };
    }

    return {
      success: true,
      principalAcao: resultado.principalAcao,
      principalId: resultado.principalId ?? null
    };
  } catch (erro) {
    console.error("[CadastrosService] createCadastroEnderecos falhou:", erro);
    return {
      success: false,
      errorMessage: "Falha de rede ao salvar os enderecos do cadastro."
    };
  }
}

export async function createCadastroContatos(
  payload: CadastroContatoInsertPayload[]
): Promise<CadastroRelatedCreateResult> {
  if (!payload.length) {
    return { success: true };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      errorMessage: "Cliente Supabase indisponivel para executar o insert de contatos."
    };
  }

  const rows = payload.map((item) => ({
    id_cliente: Number(item.id_cliente),
    nome_contato: toText(item.nome_contato).trim(),
    cargo: toNullableText(item.cargo),
    whats: toNullableText(item.whats),
    e_mail: toNullableText(item.e_mail)
  }));

  const { error } = await client.from("contatos").insert(rows);
  if (error) {
    return {
      success: false,
      errorMessage: error.message || "Nao foi possivel salvar os contatos no Supabase.",
      status: error.code ? Number(error.code) : undefined
    };
  }

  return { success: true };
}

export async function createCadastroVinculosComerciais(
  payload: CadastroVinculoComercialInsertPayload[]
): Promise<CadastroRelatedCreateResult> {
  if (!payload.length) {
    return { success: true };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      errorMessage: "Cliente Supabase indisponivel para executar o insert de vinculos."
    };
  }

  const idPrincipalList = Array.from(new Set(payload.map((p) => Number(p.id_cliente_principal))));
  const { data: existingRows } = await client
    .from("clientes_socios")
    .select("id_cliente_principal, id_cliente_socio")
    .in("id_cliente_principal", idPrincipalList);

  const existingMap = new Set(
    (existingRows || []).map((r) => `${r.id_cliente_principal}-${r.id_cliente_socio}`)
  );

  const rows = payload
    .map((item) => ({
      id_cliente_principal: Number(item.id_cliente_principal),
      id_cliente_socio: Number(item.id_cliente_socio),
      tipo_relacao: toNullableText(item.tipo_relacao) || "vinculo_comercial"
    }))
    .filter((row) => !existingMap.has(`${row.id_cliente_principal}-${row.id_cliente_socio}`));

  if (rows.length === 0) {
    return { success: true };
  }

  const { error } = await client.from("clientes_socios").insert(rows);
  if (error) {
    return {
      success: false,
      errorMessage: error.message || "Nao foi possivel salvar os vinculos comerciais no Supabase.",
      status: error.code ? Number(error.code) : undefined
    };
  }

  return { success: true };
}

export async function updateCadastroEndereco(
  id: string,
  payload: Omit<CadastroEnderecoInsertPayload, "id_cliente">
): Promise<CadastroRelatedCreateResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponivel para atualizar endereco." };
  }

  const { error } = await client
    .from("enderecos")
    .update({
      cep: toNullableText(payload.cep),
      endereco: toNullableText(payload.endereco),
      numero: toNullableText(payload.numero),
      complemento: toNullableText(payload.complemento),
      bairro: toNullableText(payload.bairro),
      cidade: toNullableText(payload.cidade),
      uf: toNullableText(payload.uf),
      tipo_endereco: toNullableText(payload.tipo_endereco) || "ENTREGA",
      obs: toNullableText(payload.obs),
      recebedor: toNullableText(payload.recebedor),
      cpf_recebedor: toNullableText(payload.cpf_recebedor)
    })
    .eq("id", id);

  if (error) {
    return {
      success: false,
      errorMessage: error.message || "Nao foi possivel atualizar o endereco.",
      status: error.code ? Number(error.code) : undefined
    };
  }
  return { success: true };
}

export async function checkEnderecoReferenciadoEmProposta(
  enderecoId: string
): Promise<{ referenciado: boolean; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { referenciado: true, errorMessage: "Cliente Supabase indisponivel para verificar referencias." };
  }

  const { data, error } = await client
    .from("propostas")
    .select("id")
    .eq("id_endereco_ent", enderecoId)
    .limit(1);

  if (error) {
    return { referenciado: true, errorMessage: error.message || "Erro ao verificar referencia em propostas." };
  }

  return { referenciado: (data?.length ?? 0) > 0 };
}

export async function deleteCadastroEndereco(
  id: string
): Promise<CadastroRelatedCreateResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponivel para excluir endereco." };
  }

  const { error } = await client
    .from("enderecos")
    .delete()
    .eq("id", id);

  if (error) {
    return {
      success: false,
      errorMessage: error.message || "Nao foi possivel excluir o endereco.",
      status: error.code ? Number(error.code) : undefined
    };
  }
  return { success: true };
}

export async function updateCadastroContato(
  id: string,
  payload: Omit<CadastroContatoInsertPayload, "id_cliente">
): Promise<CadastroRelatedCreateResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponivel para atualizar contato." };
  }

  const { error } = await client
    .from("contatos")
    .update({
      nome_contato: toText(payload.nome_contato).trim(),
      cargo: toNullableText(payload.cargo),
      whats: toNullableText(payload.whats),
      e_mail: toNullableText(payload.e_mail)
    })
    .eq("id", id);

  if (error) {
    return {
      success: false,
      errorMessage: error.message || "Nao foi possivel atualizar o contato.",
      status: error.code ? Number(error.code) : undefined
    };
  }
  return { success: true };
}

export async function updateCadastroVinculoComercial(
  id: string,
  payload: Omit<CadastroVinculoComercialInsertPayload, "id_cliente_principal" | "id_cliente_socio">
): Promise<CadastroRelatedCreateResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponivel para atualizar vinculo comercial." };
  }

  const { error } = await client
    .from("clientes_socios")
    .update({
      tipo_relacao: toNullableText(payload.tipo_relacao) || "vinculo_comercial"
    })
    .eq("id", id);

  if (error) {
    return {
      success: false,
      errorMessage: error.message || "Nao foi possivel atualizar o vinculo comercial.",
      status: error.code ? Number(error.code) : undefined
    };
  }
  return { success: true };
}

export async function listVendedores(): Promise<VendedorOption[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  // Atende o drop "Atendente do cliente": vendedores e super administradores.
  // public.usuarios não tem coluna de ativo/inativo, então não há filtro de
  // atividade a preservar aqui.
  const { data, error } = await client
    .from("usuarios")
    .select("user_id,nome_usuario,meu_vendedor,id_vendedor,is_vendedor,is_super_adm")
    .or("is_vendedor.eq.true,is_super_adm.eq.true")
    .order("nome_usuario", { ascending: true })
    .returns<SupabaseUsuarioVendedorRow[]>();

  if (error) {
    return [];
  }

  // Duas linhas de usuarios podem virar a mesma opção — o rótulo é meu_vendedor
  // (ou nome_usuario) e o valor gravado é o nome, então nomes iguais com o mesmo
  // id_vendedor são a mesma pessoa no drop. Nomes iguais com id_vendedor distinto
  // continuam separados, para não sumir com ninguém.
  const jaListados = new Set<string>();

  return (data ?? [])
    .map((item) => {
      const nome = toText(item.meu_vendedor) || toText(item.nome_usuario);
      const idVendedor = toNullableId(item.id_vendedor) ?? toNullableId(item.user_id);

      return { nome, idVendedor };
    })
    .filter((item) => Boolean(item.nome))
    .filter((item) => {
      const chave = `${item.nome}|${item.idVendedor ?? ""}`;
      if (jaListados.has(chave)) {
        return false;
      }
      jaListados.add(chave);
      return true;
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function searchCadastrosParaVinculo(query: string): Promise<SearchCadastroVinculoItem[]> {
  const client = getSupabaseClient();
  const term = normalizeSearchTerm(query);
  if (!client || !term) {
    return [];
  }

  let request = client
    .from("clientes")
    .select("id_cliente,nome,fantasia,documento")
    .order("id_cliente", { ascending: false })
    .limit(12);

  // `fantasia` entra ao lado de nome e documento. Sem ela, procurar pelo nome
  // que aparece na fachada nao acha o cadastro: "BUSLOG" e o fantasia de
  // "METAR LOGISTICA LTDA.", e a busca voltava vazia.
  const digits = term.replace(/\D/g, "");
  if (digits) {
    request = request.or(
      `id_cliente.eq.${digits},nome.ilike.%${term}%,fantasia.ilike.%${term}%,documento.ilike.%${digits}%`
    );
  } else {
    request = request.or(
      `nome.ilike.%${term}%,fantasia.ilike.%${term}%,documento.ilike.%${term}%`
    );
  }

  const { data, error } = await request.returns<
    Array<Pick<SupabaseClienteRow, "id_cliente" | "nome" | "fantasia" | "documento">>
  >();
  if (error) {
    return [];
  }

  return (data ?? [])
    .map((item) => ({
      idCliente: Number(item.id_cliente) || 0,
      nome: toText(item.nome),
      fantasia: toText(item.fantasia),
      documento: normalizeDocumento(item.documento)
    }))
    .filter((item) => item.idCliente > 0);
}

export async function searchCadastroVinculoByDocumento(documento: string): Promise<SearchCadastroVinculoItem | null> {
  const client = getSupabaseClient();
  const digits = documento.replace(/\D/g, "");
  
  if (!client || !digits) {
    return null;
  }

  const { data, error } = await client
    .from("clientes")
    .select("id_cliente,nome,fantasia,documento")
    .or(`documento.eq.${digits},documento.eq.${documento}`) // fallback just in case database has masked documents
    .order("id_cliente", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    idCliente: Number(data.id_cliente) || 0,
    nome: toText(data.nome),
    fantasia: toText(data.fantasia),
    documento: normalizeDocumento(data.documento)
  };
}

/**
 * Um cadastro pelo id_cliente, no formato usado pelo seletor de vínculos.
 * Serve ao retorno de "criar cadastro novo a partir do vínculo": ao voltar para
 * o cliente de origem só temos o id do cadastro recém-criado.
 */
export async function getCadastroVinculoById(idCliente: number): Promise<SearchCadastroVinculoItem | null> {
  const client = getSupabaseClient();
  if (!client || !idCliente) {
    return null;
  }

  const { data, error } = await client
    .from("clientes")
    .select("id_cliente,nome,fantasia,documento")
    .eq("id_cliente", idCliente)
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    idCliente: Number(data.id_cliente) || 0,
    nome: toText(data.nome),
    fantasia: toText(data.fantasia),
    documento: normalizeDocumento(data.documento)
  };
}

/**
 * Só os vínculos comerciais do cliente, já com nome/documento do relacionado.
 * Mesma leitura que `getCadastroDetailReadOnly` faz, isolada para a tela poder
 * atualizar a lista depois de gravar sem recarregar o cadastro inteiro.
 */
export async function listCadastroVinculosComerciais(
  idCliente: string | number
): Promise<CadastroVinculoComercial[]> {
  const client = getSupabaseClient();
  const idNumerico = Number(idCliente);
  if (!client || !idNumerico) {
    return [];
  }

  const { data: socios, error } = await client
    .from("clientes_socios")
    .select("id,id_cliente_principal,id_cliente_socio,tipo_relacao")
    .eq("id_cliente_principal", idNumerico)
    .limit(100);

  if (error || !socios) {
    return [];
  }

  const relatedIds = Array.from(
    new Set(
      socios
        .map((row) => normalizeIdCliente(row.id_cliente_socio))
        .filter((value): value is number => value !== null)
    )
  );

  const relatedLookup = new Map<number, ReturnType<typeof normalizeRelatedCadastro>>();
  if (relatedIds.length > 0) {
    const { data: relatedRows } = await client
      .from("clientes")
      .select("id,id_cliente,nome,documento")
      .in("id_cliente", relatedIds)
      .limit(relatedIds.length);

    (relatedRows ?? []).forEach((row) => {
      const normalizedId = normalizeIdCliente(row.id_cliente);
      if (normalizedId !== null) {
        relatedLookup.set(normalizedId, normalizeRelatedCadastro(row));
      }
    });
  }

  return socios.map((row) =>
    mapSupabaseSocioRowToCadastroVinculoWithRelated(
      row,
      relatedLookup.get(normalizeIdCliente(row.id_cliente_socio) ?? -1) ?? null
    )
  );
}
