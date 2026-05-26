import { cadastrosMock, getCadastroById } from "@/lib/mocks/cadastros.mock";
import type { Cadastro } from "@/features/cadastros/types";
import type { CadastroCategoria } from "@/features/cadastros/types";
import type {
  SupabaseClienteRow,
  SupabaseClienteSocioRow,
  SupabaseContatoRow,
  SupabaseEnderecoRow
} from "@/features/cadastros/types.supabase";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  mapSupabaseClienteRowToCadastro,
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
};

export type CadastroDetailReadResult = {
  source: CadastrosReadSource;
  cadastro: Cadastro | null;
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

function normalizeSearchTerm(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[%*,]/g, "");
}

function normalizeIdCliente(value: unknown) {
  const digits = String(value).replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
  pageIndex: number;
  pageSize?: number;
  search?: string;
  categoria?: "TODAS" | CadastroCategoria;
  status?: "TODOS" | "ATIVO" | "INATIVO" | "RESTRICAO";
};

function buildCadastrosSearchClause(search: string) {
  const normalized = normalizeSearchTerm(search);
  if (!normalized) {
    return "";
  }

  const digits = normalized.replace(/\D/g, "");
  const clauses = [
    `nome.ilike.*${normalized}*`,
    `fantasia.ilike.*${normalized}*`,
    `apelido.ilike.*${normalized}*`,
    `documento.ilike.*${normalized}*`,
    `email.ilike.*${normalized}*`,
    `email_contato.ilike.*${normalized}*`,
    `whatsapp_1.ilike.*${normalized}*`,
    `whatsapp_2.ilike.*${normalized}*`,
    `telefone_fixo.ilike.*${normalized}*`,
    `nome_vendedor.ilike.*${normalized}*`,
    `cidade_uf.ilike.*${normalized}*`
  ];

  if (digits) {
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

export async function getCadastrosReadOnlyList(query: CadastrosListQuery): Promise<CadastrosReadResult> {
  const pageSize = Math.min(Math.max(query.pageSize ?? 500, 1), 500);
  const from = Math.max(query.pageIndex, 0) * pageSize;
  const to = from + pageSize - 1;
  const client = getSupabaseClient();

  if (!client) {
    console.log("[Cadastros][List] client Supabase ausente - fallback mock ativado.", {
      pageIndex: query.pageIndex,
      pageSize
    });
    return applyMockCadastrosQuery({ ...query, pageSize });
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
      console.log("[Cadastros][List] erro ao consultar Supabase - fallback mock ativado.", {
        message: error instanceof Error ? error.message : String(error)
      });
      return applyMockCadastrosQuery({ ...query, pageSize });
    }

    const cadastros = sortCadastrosByIdClienteDesc((data ?? []).map(mapSupabaseClienteRowToCadastro));
    const totalCount = typeof count === "number" ? count : cadastros.length;
    const hasNextPage = from + cadastros.length < totalCount;

    console.log("[Cadastros][List] dados reais aplicados.", {
      registrosPagina: cadastros.length,
      totalCount,
      pageIndex: query.pageIndex,
      pageSize
    });

    if (!cadastros.length && totalCount === 0) {
      return {
        source: "supabase",
        cadastros: [],
        totalCount: 0,
        hasNextPage: false,
        pageIndex: query.pageIndex,
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
      pageIndex: query.pageIndex,
      pageSize,
      loadedCount: cadastros.length,
      warnings: [`Leitura real aplicada em public.clientes com ${cadastros.length} registros na página atual.`]
    };
  } catch (error) {
    console.log("[Cadastros][List] excecao ao consultar Supabase - fallback mock ativado.", { error });
    return applyMockCadastrosQuery({ ...query, pageSize });
  }
}

export async function getCadastroDetailReadOnly(id: string | number): Promise<CadastroDetailReadResult> {
  const idCliente = normalizeIdCliente(id);

  if (!idCliente) {
    return {
      source: "mock",
      cadastro: null
    };
  }

  const supabase = getSupabaseConfig();
  if (!supabase) {
    return {
      source: "mock",
      cadastro: fallbackDetailFromMock(idCliente)
    };
  }

  const mainRows = await selectSupabaseRows<SupabaseClienteRow>(
    "clientes",
    {
      select:
        "id,id_cliente,nome,apelido,contato,documento,ins_estadual,ins_municipal,data_fundacao,email_contato,email_financeiro,telefone_fixo,whatsapp_1,whatsapp_2,ativo,restricao,limite_credito,obs,data_criacao,fantasia,email,site,data_cadastro,recebe_email,recebe_whatsapp,tipo_pessoa,nome_vendedor,nota,categoria,risco_credito,ultima_compra,total_compras,verificado,data_verificacao,padrao_pagamento,empresa_padrao,tipo_contribuinte,motivo_erro,cidade_uf,cpf_invalido,cpf_erro,credito,is_bonus,percentual_bunus",
      id_cliente: `eq.${idCliente}`,
      limit: "1"
    }
  );

  const mainRow = mainRows?.[0];
  if (!mainRow) {
    return {
      source: "mock",
      cadastro: fallbackDetailFromMock(idCliente)
    };
  }

  const cadastro = mapSupabaseClienteRowToCadastro(mainRow);

  const [enderecosRows, contatosRows, sociosRows] = await Promise.all([
    selectSupabaseRows<SupabaseEnderecoRow>(
      "enderecos",
      {
        select: "id,id_cliente,tipo_endereco,cep,endereco,numero,complemento,bairro,cidade,uf,obs",
        id_cliente: `eq.${idCliente}`,
        limit: "100"
      }
    ),
    selectSupabaseRows<SupabaseContatoRow>(
      "contatos",
      {
        select: "id,id_cliente,nome_contato,cargo,whats,e_mail",
        id_cliente: `eq.${idCliente}`,
        limit: "100"
      }
    ),
    selectSupabaseRows<SupabaseClienteSocioRow>(
      "clientes_socios",
      {
        select: "id,id_cliente_principal,id_cliente_socio,tipo_relacao",
        id_cliente_principal: `eq.${idCliente}`,
        limit: "100"
      }
    )
  ]);

  const relatedIds = Array.from(
    new Set(
      (sociosRows ?? [])
        .map((row) => normalizeIdCliente(row.id_cliente_socio))
        .filter((value): value is number => value !== null)
    )
  );

  const relatedLookup = new Map<number, ReturnType<typeof normalizeRelatedCadastro>>();

  if (relatedIds.length) {
    const relatedRows = await selectSupabaseRows<SupabaseClienteRow>(
      "clientes",
      {
        select: "id_cliente,nome,documento",
        id_cliente: `in.(${relatedIds.join(",")})`,
        limit: String(Math.max(relatedIds.length, 1))
      }
    );

    (relatedRows ?? []).forEach((row) => {
      const normalizedId = normalizeIdCliente(row.id_cliente);
      if (normalizedId !== null) {
        relatedLookup.set(normalizedId, normalizeRelatedCadastro(row));
      }
    });
  }

  return {
    source: "supabase",
    cadastro: mergeSupabaseRelacionamentos(cadastro, {
      enderecos: enderecosRows ?? [],
      contatos: contatosRows ?? [],
      socios: (sociosRows ?? []).map((row) => ({
        row,
        relatedCadastro: relatedLookup.get(normalizeIdCliente(row.id_cliente_socio) ?? -1) ?? null
      }))
    })
  };
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

function toText(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
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
