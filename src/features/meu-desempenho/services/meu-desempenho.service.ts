/**
 * meu-desempenho.service.ts — somente leitura.
 *
 * Uma única chamada: RPC public.rpc_dashboard_vendedor, que resolve o vendedor
 * pelo auth.uid() NO BANCO. Nenhum parâmetro de vendedor/empresa existe —
 * manipular URL ou chamada não troca o vendedor consultado. Não-vendedores
 * recebem exception (42501), sinalizada aqui como accessDenied.
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import type { DateRange } from "@/lib/period";
import type { DashboardVendedorPayload } from "@/features/meu-desempenho/types";

export type MeuDesempenhoResult = {
  data: DashboardVendedorPayload | null;
  error: string | null;
  /** true quando o banco negou por perfil (ACESSO_NEGADO_VENDEDOR/VENDEDOR_SEM_NOME). */
  accessDenied: boolean;
};

export async function fetchMeuDesempenho(
  range: DateRange,
  prevRange: DateRange
): Promise<MeuDesempenhoResult> {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: "Supabase não configurado.", accessDenied: false };

  const { data, error } = await client.rpc("rpc_dashboard_vendedor", {
    p_inicio: range.inicio,
    p_fim: range.fim,
    p_inicio_prev: prevRange.inicio,
    p_fim_prev: prevRange.fim
  });

  if (error) {
    const negado =
      error.message.includes("ACESSO_NEGADO_VENDEDOR") ||
      error.message.includes("VENDEDOR_SEM_NOME");
    if (!negado) {
      console.warn("[MeuDesempenho] Erro na RPC rpc_dashboard_vendedor:", error.message);
    }
    return { data: null, error: error.message, accessDenied: negado };
  }

  return { data: data as DashboardVendedorPayload, error: null, accessDenied: false };
}
