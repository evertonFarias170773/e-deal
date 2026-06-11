import { getSupabaseClient } from "@/lib/supabase/client";
import { clonePagamentosMock } from "@/lib/mocks/pagamentos.mock";
import type { Cobranca } from "@/features/cobrancas/types";
import type { SupabasePagamentoV2Row } from "@/features/cobrancas/types.supabase";
import { mapSupabasePagamentoV2RowToCobranca } from "@/features/cobrancas/mappers";
import { getEmpresaRecebedoraFixaById } from "@/features/cobrancas/cobrancas-utils";

export const PAGAMENTOS_V2_SELECT_COLUMNS = [
  "id",
  "id_pagamento",
  "id_int",
  "os_ideal",
  "id_cliente",
  "cliente",
  "descricao",
  "valor",
  "status",
  "tipo_cobranca",
  "created_at",
  "paid_at",
  "vencimento",
  "confirmado",
  "confirmado_por",
  "aprovado_por",
  "empresa",
  "id_empresa",
  "documento",
  "atendente",
  "token_publico",
  "public_token",
  "url_cobranca",
  "pix_copia_cola",
  "linha_digitavel",
  "url_pdf",
  "motivo_cancela",
  "erro_pagamento",
  "obs_v2",
  "whats_contato",
  "id_fatura",
  "cod_solicitacao_inter",
  "data_confirmacao",
  "n_url_pdf",
  "boleto_enviadoo"
] as const;

export const PAGAMENTOS_V2_SELECT = PAGAMENTOS_V2_SELECT_COLUMNS.join(", ");

export type CobrancasReadSource = "supabase" | "mock";

export type CobrancasReadResult = {
  source: CobrancasReadSource;
  cobrancas: Cobranca[];
  cobrancasStats: Cobranca[];
  warnings: string[];
};

export type UpdatePagamentoV2EmpresaResult = {
  success: boolean;
  updated?: Cobranca | null;
  status?: number;
  errorMessage?: string;
};

type UpdatePagamentoV2EmpresaPayload = {
  id_empresa: number;
  empresa: string;
};

function cloneMockResult(): Cobranca[] {
  return clonePagamentosMock();
}

function getFallbackReason(reason: string) {
  return [`Leitura ` + reason + ". Fallback mock ativado."];
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

async function fetchPagamentosV2Rows(limit = 10000) {
  const client = getSupabaseClient();

  if (!client) {
    return null;
  }

  const rows: SupabasePagamentoV2Row[] = [];
  const pageSize = 1000;

  for (let from = 0; from < limit; from += pageSize) {
    const to = from + pageSize - 1;
    const query = client
      .from("pagamentos_v2")
      .select(PAGAMENTOS_V2_SELECT)
      .order("created_at", { ascending: false })
      .range(from, to);

    const { data, error } = await query.returns<SupabasePagamentoV2Row[]>();

    if (error || !data || !Array.isArray(data)) {
      return null;
    }

    rows.push(...data);

    if (data.length < pageSize) {
      break;
    }
  }

  return rows;
}

function mapRowsToCobrancas(rows: SupabasePagamentoV2Row[]) {
  return rows
    .map((row) => mapSupabasePagamentoV2RowToCobranca(row))
    .filter((row): row is Cobranca => Boolean(row));
}

function parseDateValue(value: string | undefined) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortByConferenceRecency(items: Cobranca[]) {
  return [...items].sort((a, b) => {
    const paidDiff = parseDateValue(b.paid_at) - parseDateValue(a.paid_at);
    if (paidDiff !== 0) {
      return paidDiff;
    }

    const confirmDiff = parseDateValue(b.data_confirmacao) - parseDateValue(a.data_confirmacao);
    if (confirmDiff !== 0) {
      return confirmDiff;
    }

    return parseDateValue(b.created_at) - parseDateValue(a.created_at);
  });
}

async function fetchClientesInfo(clientIds: number[]) {
  const config = getSupabaseConfig();
  const uniqueIds = Array.from(new Set(clientIds)).filter(Boolean);
  if (!config || uniqueIds.length === 0) {
    return {};
  }

  const mapping: Record<number, { restricao: boolean; limite_credito: number; credito: number }> = {};
  const limit = 500;
  
  for (let i = 0; i < uniqueIds.length; i += limit) {
    const chunk = uniqueIds.slice(i, i + limit);
    const url = new URL(`${config.url}/rest/v1/clientes`);
    url.searchParams.set("select", "id_cliente,restricao,limite_credito,credito");
    url.searchParams.set("id_cliente", `in.(${chunk.join(",")})`);

    try {
      const response = await fetch(url.toString(), {
        headers: {
          apikey: config.anonKey,
          authorization: `Bearer ${config.anonKey}`,
          accept: "application/json",
          "accept-profile": "public"
        }
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (Array.isArray(data)) {
          data.forEach((row: { id_cliente: unknown; restricao: unknown; limite_credito: unknown; credito: unknown }) => {
            const id = Number(row.id_cliente);
            if (Number.isFinite(id)) {
              mapping[id] = {
                restricao: Boolean(row.restricao),
                limite_credito: Number(row.limite_credito) || 0,
                credito: Number(row.credito) || 0
              };
            }
          });
        }
      }
    } catch (err) {
      console.error("[CobrancasService] Erro ao consultar clientes em lote:", err);
    }
  }

  return mapping;
}

export async function getCobrancasReadOnlyData(): Promise<CobrancasReadResult> {
  const rows = await fetchPagamentosV2Rows();

  if (!rows) {
    return {
      source: "mock",
      cobrancas: cloneMockResult(),
      cobrancasStats: cloneMockResult(),
      warnings: getFallbackReason("em `public.pagamentos_v2` indisponível, bloqueada ou sem configuração Supabase")
    };
  }

  const mappedCobrancas = mapRowsToCobrancas(rows);
  const clientIds = mappedCobrancas.map((c) => c.id_cliente).filter(Boolean);
  const clientMap = await fetchClientesInfo(clientIds);

  mappedCobrancas.forEach((c) => {
    const cInfo = clientMap[c.id_cliente];
    c.cliente_restricao = cInfo ? cInfo.restricao : false;
    c.cliente_limite_credito = cInfo ? cInfo.limite_credito : 0;
    c.cliente_credito = cInfo ? cInfo.credito : 0;
  });

  const cobrancasStats = sortByConferenceRecency(mappedCobrancas);
  const cobrancas = cobrancasStats.slice(0, 500);

  if (cobrancasStats.length === 0) {
    return {
      source: "mock",
      cobrancas: cloneMockResult(),
      cobrancasStats: cloneMockResult(),
      warnings: getFallbackReason("em `public.pagamentos_v2` vazio ou incompatível com o mapper")
    };
  }

  return {
    source: "supabase",
    cobrancas,
    cobrancasStats,
    warnings: [
      "Lista limitada aos 500 registros mais recentes. Os cards usam o conjunto completo carregado para manter os totais reais dentro do limite da consulta."
    ]
  };
}

function normalizeEmpresaPayload(payload: UpdatePagamentoV2EmpresaPayload) {
  const empresa = getEmpresaRecebedoraFixaById(payload.id_empresa);

  if (!empresa) {
    return null;
  }

  return {
    id_empresa: empresa.id,
    empresa: empresa.nome
  };
}

export async function updatePagamentoV2Empresa(
  id: string,
  payload: UpdatePagamentoV2EmpresaPayload
): Promise<UpdatePagamentoV2EmpresaResult> {
  const config = getSupabaseConfig();

  if (!config) {
    return {
      success: false,
      errorMessage: "Configuracao Supabase ausente no ambiente do app."
    };
  }

  const normalizedPayload = normalizeEmpresaPayload(payload);

  if (!normalizedPayload) {
    return {
      success: false,
      errorMessage: "Empresa de destino invalida."
    };
  }

  const url = buildRestUrl("pagamentos_v2", {
    id: `eq.${id}`,
    tipo_cobranca: "in.(E-Faturado,E-Amostras,E-Retrabalho,E-Cortesia,E-Informe Pgto)",
    status: "eq.A_VENCER",
    or: "(confirmado.is.null,confirmado.eq.false)",
    select: "id,id_pagamento,id_int,os_ideal,id_cliente,cliente,descricao,valor,status,tipo_cobranca,created_at,paid_at,vencimento,confirmado,confirmado_por,aprovado_por,empresa,id_empresa,documento,atendente,token_publico,public_token,url_cobranca,pix_copia_cola,linha_digitavel,url_pdf,motivo_cancela,erro_pagamento,obs_v2,whats_contato,id_fatura,cod_solicitacao_inter,data_confirmacao,n_url_pdf,boleto_enviadoo"
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
    body: JSON.stringify(normalizedPayload)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      success: false,
      errorMessage: `Erro HTTP ao atualizar empresa no Supabase: ${response.status} ${response.statusText}. ${body}`,
      status: response.status
    };
  }

  const data = (await response.json().catch(() => [])) as SupabasePagamentoV2Row[];

  if (!Array.isArray(data) || data.length !== 1) {
    return {
      success: false,
      errorMessage: "Atualizacao nao retornou exatamente um registro."
    };
  }

  const updated = mapSupabasePagamentoV2RowToCobranca(data[0]) ?? null;

  return {
    success: true,
    updated
  };
}

export async function createPagamentoV2Real(
  payload: {
    id_int: number;
    id_cliente: number;
    cliente: string;
    documento: string;
    valor: number;
    status: string;
    tipo_cobranca: string;
    empresa: string;
    id_empresa: number;
    os_ideal: string;
    atendente: string;
    descricao: string;
    vencimento?: string;
    obs_v2?: string;
  }
): Promise<{ success: boolean; data?: Cobranca | null; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente do Supabase nao inicializado." };
  }

  const { data: createdRows, error: insertError } = await client
    .from("pagamentos_v2")
    .insert([
      {
        id_int: payload.id_int,
        id_cliente: payload.id_cliente,
        cliente: payload.cliente,
        documento: payload.documento,
        valor: payload.valor,
        status: payload.status,
        tipo_cobranca: payload.tipo_cobranca,
        empresa: payload.empresa,
        id_empresa: payload.id_empresa,
        os_ideal: payload.os_ideal,
        atendente: payload.atendente,
        descricao: payload.descricao,
        vencimento: payload.vencimento || null,
        obs_v2: payload.obs_v2 || null,
        confirmado: false
      }
    ])
    .select(PAGAMENTOS_V2_SELECT)
    .returns<SupabasePagamentoV2Row[]>();

  if (insertError) {
    console.error("[CobrancasService] Erro ao criar pagamento_v2:", insertError);
    return { success: false, errorMessage: insertError.message || "Erro desconhecido ao inserir cobranca." };
  }

  if (!createdRows || !createdRows.length) {
    return { success: false, errorMessage: "Cobranca inserida, mas nao retornou o registro criado." };
  }

  const createdRow = createdRows[0];
  const mappedCobranca = mapSupabasePagamentoV2RowToCobranca(createdRow) ?? null;

  // Registrar aviso curto em propostas_chat de forma silenciosa/amigavel
  try {
    const { error: chatError } = await client
      .from("propostas_chat")
      .insert([
        {
          id_int: payload.id_int,
          id_cliente: payload.id_cliente,
          mensagem: `Nova cobranca PIX registrada. Valor: R$ ${payload.valor.toFixed(2).replace(".", ",")}.`,
          tipo: "SISTEMA",
          autor_name: "Sistema",
          autor_nome: "Sistema",
          setor: "Financeiro",
          visivel_externo: false
        }
      ]);

    if (chatError) {
      console.warn("[CobrancasService] Erro ao gravar em propostas_chat:", chatError);
    }
  } catch (chatException) {
    console.warn("[CobrancasService] Excecao ao gravar em propostas_chat:", chatException);
  }

  return { success: true, data: mappedCobranca };
}

export async function updatePagamentoV2StatusConfirmacao(
  id: string,
  payload: {
    confirmado: boolean;
    confirmado_por: string | null;
    data_confirmacao: string | null;
    status?: string;
    aprovado_por?: string | null;
  }
): Promise<{ success: boolean; updated?: Cobranca | null; errorMessage?: string }> {
  const config = getSupabaseConfig();

  if (!config) {
    return {
      success: false,
      errorMessage: "Configuracao Supabase ausente no ambiente do app."
    };
  }

  const url = buildRestUrl("pagamentos_v2", {
    id: `eq.${id}`,
    select: PAGAMENTOS_V2_SELECT
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
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      success: false,
      errorMessage: `Erro HTTP ao atualizar status de confirmacao: ${response.status} ${response.statusText}. ${body}`
    };
  }

  const data = (await response.json().catch(() => [])) as SupabasePagamentoV2Row[];

  if (!Array.isArray(data) || data.length !== 1) {
    return {
      success: false,
      errorMessage: "Atualizacao nao retornou exatamente um registro de pagamento_v2."
    };
  }

  const updated = mapSupabasePagamentoV2RowToCobranca(data[0]) ?? null;

  return {
    success: true,
    updated
  };
}

