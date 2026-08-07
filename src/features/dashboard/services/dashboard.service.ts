/**
 * dashboard.service.ts
 *
 * Camada de acesso a dados do Dashboard executivo — somente leitura.
 *
 * ─── Fontes oficiais ─────────────────────────────────────────────────────────
 *
 *  1. KPIs agregados + comparativos → RPC public.rpc_dashboard_executivo
 *     (supabase/migrations/20260807_rpc_dashboard_executivo.sql). Uma única
 *     chamada devolve Comercial, Financeiro, Produção, Fiscal, Clientes e o
 *     widget de últimas aprovações, já com o período anterior agregado.
 *     O front calcula os dois ranges em America/Sao_Paulo (src/lib/period.ts)
 *     e passa os quatro limites.
 *
 *  2. Próximos boletos → public.boletos direto (limit curto). A view
 *     vw_boletos_controle não expõe id_empresa, por isso a tabela.
 *
 *  3. Últimos pagamentos → public.pagamentos_v2 com a regra oficial de
 *     confirmação: status IN ('PAID','A_VENCER') AND confirmado = true AND
 *     data_confirmacao IS NOT NULL (mesma da view view_pagamentos_pagos_v2).
 *
 * ─── Erro ≠ zero ─────────────────────────────────────────────────────────────
 *  Cada fetch devolve `{ data, error }` sem lançar; a UI diferencia falha de
 *  consulta (aviso) de resultado zero legítimo (estado vazio/valores zerados).
 *
 * ─── Empresa ─────────────────────────────────────────────────────────────────
 *  boletos/pagamentos_v2/notas usam id_empresa nativo. `propostas` não tem a
 *  coluna — a heurística de texto vive no banco (dashboard_empresa_match),
 *  espelho SQL da antiga empresaTextMatchesCompany deste arquivo.
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import type { DateRange } from "@/lib/period";
import type {
  DashboardExecutivoPayload,
  ProximoBoleto,
  RankingVendedores,
  UltimoPagamento
} from "@/features/dashboard/types";

type ServiceResult<T> = { data: T | null; error: string | null };

export async function fetchDashboardExecutivo(
  range: DateRange,
  prevRange: DateRange,
  companyId: number
): Promise<ServiceResult<DashboardExecutivoPayload>> {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: "Supabase não configurado." };

  const { data, error } = await client.rpc("rpc_dashboard_executivo", {
    p_inicio: range.inicio,
    p_fim: range.fim,
    p_inicio_prev: prevRange.inicio,
    p_fim_prev: prevRange.fim,
    p_id_empresa: companyId
  });

  if (error) {
    console.warn("[Dashboard] Erro na RPC rpc_dashboard_executivo:", error.message);
    return { data: null, error: error.message };
  }

  return { data: data as DashboardExecutivoPayload, error: null };
}

/**
 * Ranking de vendedores — RPC exclusiva de perfis administrativos; o gate é no
 * banco (42501 para os demais). O front só a chama quando o usuário é admin e
 * oculta a seção em caso de negativa.
 */
export async function fetchRankingVendedores(
  range: DateRange
): Promise<ServiceResult<RankingVendedores>> {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: "Supabase não configurado." };

  const { data, error } = await client.rpc("rpc_ranking_vendedores", {
    p_inicio: range.inicio,
    p_fim: range.fim
  });

  if (error) {
    if (!error.message.includes("ACESSO_NEGADO_RANKING")) {
      console.warn("[Dashboard] Erro na RPC rpc_ranking_vendedores:", error.message);
    }
    return { data: null, error: error.message };
  }

  return { data: data as RankingVendedores, error: null };
}

const PROXIMOS_BOLETOS_LIMIT = 5;

/** Boletos em aberto ordenados por vencimento (vencidos primeiro). */
export async function fetchProximosBoletos(
  companyId: number
): Promise<ServiceResult<ProximoBoleto[]>> {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: "Supabase não configurado." };

  let query = client
    .from("boletos")
    .select("id, id_int, parcela, total_parcelas, nome_cliente, valor, valor_atualizado, vencimento, status")
    .in("status", ["A_VENCER", "VENCIDO"])
    .order("vencimento", { ascending: true })
    .limit(PROXIMOS_BOLETOS_LIMIT);

  if (companyId !== 0) query = query.eq("id_empresa", companyId);

  const { data, error } = await query;

  if (error) {
    console.warn("[Dashboard] Erro ao buscar próximos boletos:", error.message);
    return { data: null, error: error.message };
  }

  return { data: (data ?? []) as ProximoBoleto[], error: null };
}

const ULTIMOS_PAGAMENTOS_LIMIT = 5;

/** Últimos pagamentos confirmados (regra oficial de faturamento). */
export async function fetchUltimosPagamentos(
  companyId: number
): Promise<ServiceResult<UltimoPagamento[]>> {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: "Supabase não configurado." };

  let query = client
    .from("pagamentos_v2")
    .select("id, id_int, cliente, valor, tipo_cobranca, data_confirmacao")
    .in("status", ["PAID", "A_VENCER"])
    .eq("confirmado", true)
    .not("data_confirmacao", "is", null)
    .order("data_confirmacao", { ascending: false })
    .limit(ULTIMOS_PAGAMENTOS_LIMIT);

  if (companyId !== 0) query = query.eq("id_empresa", companyId);

  const { data, error } = await query;

  if (error) {
    console.warn("[Dashboard] Erro ao buscar últimos pagamentos:", error.message);
    return { data: null, error: error.message };
  }

  return { data: (data ?? []) as UltimoPagamento[], error: null };
}
