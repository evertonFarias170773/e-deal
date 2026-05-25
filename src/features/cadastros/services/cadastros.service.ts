import { cadastrosMock, getCadastroById } from "@/lib/mocks/cadastros.mock";
import type { Cadastro } from "@/features/cadastros/types";
import type {
  SupabaseClienteRow,
  SupabaseClienteSocioRow,
  SupabaseContatoRow,
  SupabaseEnderecoRow
} from "@/features/cadastros/types.supabase";
import {
  mapSupabaseClienteRowToCadastro,
  mergeSupabaseRelacionamentos
} from "@/features/cadastros/mappers";

const CLIENTES_LIST_SELECT = [
  "id",
  "id_cliente",
  "nome",
  "apelido",
  "contato",
  "documento",
  "ins_estadual",
  "ins_municipal",
  "data_fundacao",
  "email_contato",
  "email_financeiro",
  "telefone_fixo",
  "whatsapp_1",
  "whatsapp_2",
  "ativo",
  "restricao",
  "limite_credito",
  "obs",
  "data_criacao",
  "fantasia",
  "email",
  "site",
  "data_cadastro",
  "recebe_email",
  "recebe_whatsapp",
  "tipo_pessoa",
  "id_vendedor",
  "nome_vendedor",
  "nota",
  "categoria",
  "risco_credito",
  "ultima_compra",
  "total_compras",
  "verificado",
  "data_verificacao",
  "padrao_pagamento",
  "empresa_padrao",
  "tipo_contribuinte",
  "motivo_erro",
  "cidade_uf",
  "cpf_invalido",
  "cpf_erro",
  "credito",
  "is_bonus",
  "percentual_bunus"
].join(", ");

export type CadastrosReadSource = "supabase" | "mock";

export type CadastrosReadResult = {
  source: CadastrosReadSource;
  cadastros: Cadastro[];
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

export async function getCadastrosReadOnlyList(): Promise<CadastrosReadResult> {
  console.log("[Cadastros][List] select em public.clientes.", {
    select: CLIENTES_LIST_SELECT
  });

  const data = await selectSupabaseRows<SupabaseClienteRow>(
    "clientes",
    {
      select: CLIENTES_LIST_SELECT,
      order: "data_cadastro.desc",
      limit: "200"
    }
  );

  if (!data || data.length === 0) {
    console.log("[Cadastros][List] fallback para mock.", {
      motivo: !data ? "query falhou ou bloqueada" : "retorno vazio",
      dataSourceFinal: "mock"
    });
    return {
      source: "mock",
      cadastros: cloneMockCadastros()
    };
  }

  console.log("[Cadastros][List] dados reais aplicados.", {
    registros: data.length,
    dataSourceFinal: "supabase"
  });
  return {
    source: "supabase",
    cadastros: data.map(mapSupabaseClienteRowToCadastro)
  };
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
