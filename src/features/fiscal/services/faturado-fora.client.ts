import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Cliente da ação "Nota emitida no sistema antigo" (Fila de Faturamento) e do
 * seu desfazer (menu da linha em Orçamentos).
 *
 * Mesmo desenho de `encerrar-teste.client.ts`: o token sai da sessão do browser
 * e vai no header. A escrita NÃO passa pelo Supabase client direto de propósito:
 * a RLS de `propostas` é aberta, e a permissão só é checada de verdade em
 * `POST /api/fiscal/faturado-fora`.
 */

async function tokenSessao(): Promise<string | null> {
  const client = getSupabaseClient();
  const sessionResult = client ? await client.auth.getSession() : null;
  return sessionResult?.data?.session?.access_token ?? null;
}

export interface FaturadoForaResult {
  success: boolean;
  errorMessage?: string;
  /** true quando o pedido já estava no estado pedido: nada foi gravado. */
  idempotente?: boolean;
  /** Estado depois da chamada. */
  marcado?: boolean;
  faturadoForaEm?: string | null;
  faturadoForaPor?: string | null;
}

async function chamar(idInt: number, marcar: boolean, motivo?: string | null): Promise<FaturadoForaResult> {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/fiscal/faturado-fora", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id_int: idInt, marcar, motivo: motivo ?? null })
    });
    const data = (await res.json().catch(() => null)) as (FaturadoForaResult & { message?: string }) | null;
    if (res.ok && data?.success) return data;
    return { success: false, errorMessage: data?.message || `Falha na operação (HTTP ${res.status}).` };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}

/** Marca o pedido como faturado no sistema antigo: sai da Fila de Faturamento. */
export function marcarFaturadoNoSistemaAntigo(idInt: number, motivo?: string | null): Promise<FaturadoForaResult> {
  return chamar(idInt, true, motivo);
}

/** Desfaz a marca: limpa as duas colunas e o pedido volta para a Fila de Faturamento. */
export function desmarcarFaturadoNoSistemaAntigo(idInt: number, motivo?: string | null): Promise<FaturadoForaResult> {
  return chamar(idInt, false, motivo);
}
