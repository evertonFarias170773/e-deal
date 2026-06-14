import { getSupabaseClient } from "@/lib/supabase/client";
import { boletosDepositosMock, contasReceberMock, type BoletoDepositoMock } from "@/lib/mocks/contas-receber.mock";
import { mapSupabaseBoletoRowToBoletoDepositoMock } from "../mappers";
import type { SupabaseBoletoRow } from "../types.supabase";

export const CONTAS_RECEBER_SELECT_COLUMNS = [
  "id",
  "id_pagamento",
  "id_int",
  "parcela",
  "total_parcelas",
  "valor",
  "valor_atualizado",
  "vencimento",
  "status",
  "created_at",
  "paid_at",
  "empresa",
  "nome_cliente",
  "documento",
  "id_cliente",
  "id_empresa",
  "n_nf",
  "n_doc_boleto",
  "descricao",
  "is_faturado",
  "is_avulso",
  "dias_atraso",
  "data_vencido",
  "linha_digitavel",
  "codigo_barras",
  "url_pdf",
  "pdf_storage",
  "id_boleto_c6",
  "nosso_numero",
  "ext_reference",
  "deposito_conta",
  "confirmado_por",
  "multa",
  "juros_dia",
  "is_prorrogado",
  "motivo_prorg",
  "dias_prorg"
] as const;

export const CONTAS_RECEBER_SELECT = CONTAS_RECEBER_SELECT_COLUMNS.join(", ");

export type ContasReceberReadSource = "supabase" | "mock";

export type ContasReceberReadResult = {
  source: ContasReceberReadSource;
  recebiveis: BoletoDepositoMock[];
  boletosDepositos: BoletoDepositoMock[];
};

function cloneRecebiveisMock() {
  return contasReceberMock
    .filter((item) => item.status !== "A_RECEBER")
    .map((item) => ({ ...item })) as BoletoDepositoMock[];
}

function cloneBoletosDepositosMock() {
  return boletosDepositosMock
    .filter((item) => item.status !== "A_RECEBER")
    .map((item) => ({ ...item })) as BoletoDepositoMock[];
}

function buildMockResult(): ContasReceberReadResult {
  return {
    source: "mock",
    recebiveis: cloneRecebiveisMock(),
    boletosDepositos: cloneBoletosDepositosMock()
  };
}

async function fetchPagamentosRows() {
  const client = getSupabaseClient();
  if (!client) {
    console.log("[ContasReceber][Debug] envs ausentes - fallback mock ativado.", {
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    });
    return null;
  }

  console.log("[ContasReceber] select em public.boletos.", {
    select: CONTAS_RECEBER_SELECT,
    orderBy: "created_at.desc",
    limit: 5000
  });

  const query = client
    .from("boletos")
    .select(CONTAS_RECEBER_SELECT)
    .order("created_at", { ascending: false })
    .limit(5000);

  const { data, error } = await query.returns<SupabaseBoletoRow[]>();

  if (error || !data) {
    console.log("[ContasReceber][Supabase] consulta falhou - fallback mock ativado.", {
      error: error instanceof Error ? error.message : error,
      hasData: Boolean(data)
    });
    return null;
  }

  if (!Array.isArray(data)) {
    console.log("[ContasReceber][Supabase] payload invalido - fallback mock ativado.", {
      payloadType: typeof data
    });
    return null;
  }

  if (data.length === 0) {
    console.log("[ContasReceber][Supabase] retorno vazio - fallback mock ativado.");
    return null;
  }

  console.log("[ContasReceber][Supabase] resposta OK recebida.", {
    registros: data.length,
    primeirosIds: data.slice(0, 3).map((row) => row.id)
  });

  return data;
}

function mapRowsToReadModel(rows: SupabaseBoletoRow[]) {
  const boletos = rows
    .map((row) => mapSupabaseBoletoRowToBoletoDepositoMock(row))
    .filter((item) => item.status !== "A_RECEBER");

  return {
    recebiveis: boletos,
    boletosDepositos: boletos
  };
}

export async function getContasReceberReadOnlyData(): Promise<ContasReceberReadResult> {
  const rows = await fetchPagamentosRows();
  if (!rows) {
    return buildMockResult();
  }

  const mapped = mapRowsToReadModel(rows);

  if (mapped.recebiveis.length === 0 && mapped.boletosDepositos.length === 0) {
    console.log("[ContasReceber] mapeamento vazio - fallback mock ativado.", {
      registrosOriginais: rows.length
    });
    return buildMockResult();
  }

  console.log("[ContasReceber] dados reais aplicados.", {
    recebiveis: mapped.recebiveis.length,
    boletosDepositos: mapped.boletosDepositos.length,
    source: "supabase"
  });

  return {
    source: "supabase",
    recebiveis: mapped.recebiveis,
    boletosDepositos: mapped.boletosDepositos
  };
}

export async function gerarBoletoPdfInterno(
  idBoleto: string,
  idEmpresa: number | null | undefined
): Promise<{ success: boolean; url?: string; path?: string; errorMessage?: string }> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return { success: false, errorMessage: "Configurações do Supabase ausentes no cliente." };
    }

    if (!idBoleto) {
      return { success: false, errorMessage: "ID do boleto inválido ou não fornecido." };
    }

    // Validar que id_empresa está preenchido no boleto antes de buscar empresas.url_boleto_base
    if (idEmpresa === null || idEmpresa === undefined || isNaN(Number(idEmpresa)) || Number(idEmpresa) <= 0) {
      return { success: false, errorMessage: "ID de empresa inválido ou não configurado no boleto." };
    }

    const client = getSupabaseClient();
    if (!client) {
      return { success: false, errorMessage: "Cliente Supabase não inicializado." };
    }

    // 1. Buscar a empresa do boleto por id_empresa
    const { data: empresa, error: empresaError } = await client
      .from("empresas")
      .select("url_boleto_base")
      .eq("id", idEmpresa)
      .single();

    if (empresaError || !empresa) {
      return { success: false, errorMessage: `Empresa com ID ${idEmpresa} não encontrada.` };
    }

    const template_url = empresa.url_boleto_base;

    // 2. Se url_boleto_base estiver null/vazia: bloquear geração; exibir erro claro
    if (!template_url || template_url.trim() === "") {
      return { success: false, errorMessage: "Empresa sem modelo de boleto configurado" };
    }

    // 3. Chamar a Edge Function gerar-boleto-pdf
    const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/gerar-boleto-pdf`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${anonKey}`
      },
      body: JSON.stringify({
        id: idBoleto,
        template_url: template_url
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, errorMessage: `Edge Function retornou erro HTTP ${response.status}: ${text || response.statusText}` };
    }

    const data = await response.json();
    if (data && (data.url || data.path)) {
      // 4. Salvar public.boletos.url_pdf e public.boletos.pdf_storage
      const { error: updateError } = await client
        .from("boletos")
        .update({
          url_pdf: data.url || null,
          pdf_storage: data.path || null
        })
        .eq("id", idBoleto);

      if (updateError) {
        return { success: false, errorMessage: `Erro ao salvar PDF do boleto no banco: ${updateError.message}` };
      }

      return { success: true, url: data.url, path: data.path };
    }

    return { 
      success: false, 
      errorMessage: data?.message || data?.error || "A resposta da Edge Function não continha a URL ou o caminho do PDF." 
    };
  } catch (error) {
    console.error("[ContasReceberService] Erro ao gerar PDF do boleto:", error);
    return { 
      success: false, 
      errorMessage: error instanceof Error ? error.message : "Erro desconhecido ao chamar Edge Function." 
    };
  }
}

