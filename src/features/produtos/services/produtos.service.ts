import { getSupabaseClient } from "@/lib/supabase/client";
import { cloneMockProdutos, mapSupabaseProdutoRowsToProdutos, type ProdutosReadResult } from "@/features/produtos/mappers";
import type { SupabaseProdutoRow } from "@/features/produtos/types.supabase";

type ProdutosDiagnostics = {
  source: "supabase" | "mock";
  queryExecuted: boolean;
  registrosRetornados: number;
  supabaseError: string | null;
  fallbackReason: string | null;
};

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
    console.log("[Produtos][Supabase] envs ausentes - fallback mock ativado.", {
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      table,
      params
    });
    return null;
  }

  const url = buildRestUrl(table, params);
  if (!url) {
    console.log("[Produtos][Supabase] URL REST invalida - fallback mock ativado.", {
      table,
      params
    });
    return null;
  }

  console.log("[Produtos][Supabase] chamada executada.", {
    table,
    url: url.toString(),
    select: params.select
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
      console.log("[Produtos][Supabase] resposta HTTP nao-ok.", {
        status: response.status,
        statusText: response.statusText,
        body
      });
      return null;
    }

    const data = (await response.json()) as T[];
    console.log("[Produtos][Supabase] resposta OK recebida.", {
      registros: Array.isArray(data) ? data.length : 0
    });
    return Array.isArray(data) ? data : null;
  } catch (error) {
    console.log("[Produtos][Supabase] erro bruto retornado pelo Supabase.", { error });
    return null;
  }
}

function buildMockResult(diagnostics?: Partial<ProdutosDiagnostics>): ProdutosReadResult {
  return {
    source: "mock",
    produtos: cloneMockProdutos(),
    warnings: [
      diagnostics?.fallbackReason === "sem registros"
        ? "A tabela public.produtos retornou 0 registros. Fallback mock ativado."
        : "Leitura real de public.produtos indisponivel. Fallback mock ativado."
    ]
  };
}

async function fetchProdutoRows() {
  const client = getSupabaseClient();
  const hasClient = Boolean(client && typeof client.from === "function");

  if (!hasClient) {
    return {
      rows: null,
      diagnostics: {
        source: "mock" as const,
        queryExecuted: false,
        registrosRetornados: 0,
        supabaseError: null,
        fallbackReason: "client indisponivel"
      }
    };
  }

  const data = await selectSupabaseRows<SupabaseProdutoRow>(
    "produtos",
    {
      select: "*",
      order: "id_produto.asc",
      limit: "200"
    }
  );

  if (!data) {
    return {
      rows: null,
      diagnostics: {
        source: "mock" as const,
        queryExecuted: true,
        registrosRetornados: 0,
        supabaseError: "Consulta retornou nulo",
        fallbackReason: "query falhou"
      }
    };
  }

  return {
    rows: data,
    diagnostics: {
      source: "supabase" as const,
      queryExecuted: true,
      registrosRetornados: data.length,
      supabaseError: null,
      fallbackReason: data.length === 0 ? "sem registros" : null
    }
  };
}

export async function getProdutosReadOnlyList(): Promise<ProdutosReadResult> {
  const fetched = await fetchProdutoRows();
  const rows = fetched.rows;

  if (!rows) {
    console.log("[Produtos][List] fallback mock aplicado.", {
      motivo: fetched.diagnostics.fallbackReason
    });
    return buildMockResult(fetched.diagnostics);
  }

  if (!rows.length) {
    console.log("[Produtos][List] retorno vazio no Supabase, mantendo fallback mock.", {
      motivo: "sem registros"
    });
    return buildMockResult({
      ...fetched.diagnostics,
      fallbackReason: "sem registros"
    });
  }

  const produtos = mapSupabaseProdutoRowsToProdutos(rows);
  if (!produtos.length) {
    console.log("[Produtos][List] mapper retornou lista vazia, mantendo fallback mock.", {
      registrosOriginais: rows.length
    });
    return buildMockResult({
      ...fetched.diagnostics,
      fallbackReason: "mapper retornou vazio"
    });
  }

  console.log("[Produtos][List] dados reais aplicados.", {
    registros: produtos.length,
    primeirosIds: produtos.slice(0, 5).map((produto) => produto.id_produto)
  });

  return {
    source: "supabase",
    produtos,
    warnings: [
      `Leitura real aplicada em public.produtos com ${produtos.length} registros.`,
      `Colunas detectadas: ${rows.length ? Object.keys(rows[0]).sort().join(", ") : ""}`
    ]
  };
}
