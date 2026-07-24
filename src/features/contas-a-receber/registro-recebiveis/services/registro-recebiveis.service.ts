import { getSupabaseClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGAMENTOS_V2_SELECT } from "@/features/cobrancas/services/pagamentos-v2.service";
import { mapSupabasePagamentoV2RowToCobranca } from "@/features/cobrancas/mappers";
import type { SupabasePagamentoV2Row } from "@/features/cobrancas/types.supabase";
import type { Cobranca } from "@/features/cobrancas/types";
import type {
  PlanoParcelamento,
  RecebivelParaRegistro,
  RecebiveisParaRegistroResult
} from "../types";

const REGISTRO_SELECT = `${PAGAMENTOS_V2_SELECT}, p_valor_entrada, p_qtd_parcelas, p_dias_pra_inicio, p_intervalo`;
const PAGE_SIZE = 1000;
const BOLETOS_IN_BATCH = 200;
const EMPRESA_PLACEHOLDER = "definir empresa";

type BoletoExistenteRow = {
  id_int: number | string | null;
  status: string | null;
};

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolvePlano(row: SupabasePagamentoV2Row): PlanoParcelamento | null {
  const qtdParcelas = toNumberOrNull(row.p_qtd_parcelas);
  if (!qtdParcelas || qtdParcelas < 1) {
    return null;
  }

  return {
    qtdParcelas,
    valorEntrada: toNumberOrNull(row.p_valor_entrada) ?? 0,
    diasPraInicio: toNumberOrNull(row.p_dias_pra_inicio) ?? 30,
    intervalo: toNumberOrNull(row.p_intervalo) ?? 30
  };
}

function isEmpresaIndefinida(cobranca: Cobranca): boolean {
  if (!cobranca.id_empresa || cobranca.id_empresa <= 0) {
    return true;
  }

  const empresa = (cobranca.empresa || "").trim();
  if (!empresa) {
    return true;
  }

  return empresa.toLowerCase() === EMPRESA_PLACEHOLDER;
}

async function fetchRowsPendentes(client: SupabaseClient): Promise<SupabasePagamentoV2Row[] | null> {
  const rows: SupabasePagamentoV2Row[] = [];

  // Paginação até página incompleta: não há limite fixo que oculte pendências.
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from("pagamentos_v2")
      .select(REGISTRO_SELECT)
      .in("tipo_cobranca", ["E-FATURADO", "E-Faturado"])
      .eq("status", "A_VENCER")
      .eq("confirmado", true)
      .or("boleto_enviadoo.is.null,boleto_enviadoo.eq.false")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
      .returns<SupabasePagamentoV2Row[]>();

    if (error || !Array.isArray(data)) {
      return null;
    }

    rows.push(...data);

    if (data.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

async function fetchIdIntsComBoletosAtivos(
  client: SupabaseClient,
  idInts: number[]
): Promise<Set<number> | null> {
  const ativos = new Set<number>();

  for (let i = 0; i < idInts.length; i += BOLETOS_IN_BATCH) {
    const lote = idInts.slice(i, i + BOLETOS_IN_BATCH);
    const { data, error } = await client
      .from("boletos")
      .select("id_int, status")
      .in("id_int", lote)
      .returns<BoletoExistenteRow[]>();

    if (error || !Array.isArray(data)) {
      return null;
    }

    for (const boleto of data) {
      const status = String(boleto.status ?? "").toUpperCase();
      const idInt = toNumberOrNull(boleto.id_int);
      if (idInt && status !== "CANCELADO") {
        ativos.add(idInt);
      }
    }
  }

  return ativos;
}

export async function getRecebiveisParaRegistro(): Promise<RecebiveisParaRegistroResult> {
  const client = getSupabaseClient();

  if (!client) {
    return {
      itens: [],
      errorMessage: "Supabase não configurado. Verifique as variáveis de ambiente."
    };
  }

  const rows = await fetchRowsPendentes(client);

  if (!rows) {
    return {
      itens: [],
      errorMessage: "Não foi possível carregar os recebíveis pendentes de registro."
    };
  }

  const mapeados = rows
    .map((row) => ({ row, cobranca: mapSupabasePagamentoV2RowToCobranca(row) }))
    .filter((item): item is { row: SupabasePagamentoV2Row; cobranca: Cobranca } =>
      Boolean(item.cobranca)
    );

  const idInts = Array.from(
    new Set(
      mapeados
        .map(({ cobranca }) => cobranca.id_int)
        .filter((idInt) => Number.isFinite(idInt) && idInt > 0)
    )
  );

  const idIntsComBoletos = await fetchIdIntsComBoletosAtivos(client, idInts);

  if (!idIntsComBoletos) {
    return {
      itens: [],
      errorMessage: "Não foi possível verificar títulos existentes no Contas a Receber."
    };
  }

  const itens: RecebivelParaRegistro[] = mapeados.map(({ row, cobranca }) => ({
    cobranca,
    plano: resolvePlano(row),
    possuiBoletos: cobranca.id_int > 0 && idIntsComBoletos.has(cobranca.id_int),
    empresaIndefinida: isEmpresaIndefinida(cobranca)
  }));

  return { itens, errorMessage: null };
}
