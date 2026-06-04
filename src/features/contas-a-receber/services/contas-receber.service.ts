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
