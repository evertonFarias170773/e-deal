import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Cliente da ação "Encerrar teste" / "Reabrir".
 *
 * Mesmo desenho de `recotacao.client.ts`: o token sai da sessão do browser e vai
 * no header, porque a rota autentica por Bearer OU cookie.
 *
 * A escrita NÃO passa pelo Supabase client direto de propósito. A RLS de
 * `propostas` é aberta, então a permissão só é checada de verdade em
 * `POST /api/pedidos/encerrar-teste`. Chamar a tabela daqui pularia o gate.
 */

async function tokenSessao(): Promise<string | null> {
  const client = getSupabaseClient();
  const sessionResult = client ? await client.auth.getSession() : null;
  return sessionResult?.data?.session?.access_token ?? null;
}

export interface EncerrarTesteResult {
  success: boolean;
  errorMessage?: string;
  /** true quando o pedido já estava no estado pedido: nada foi gravado. */
  idempotente?: boolean;
  /** Estado depois da chamada. */
  encerrado?: boolean;
  encerradoEm?: string | null;
  encerradoPor?: string | null;
}

async function chamar(idInt: number, encerrar: boolean, motivo?: string | null): Promise<EncerrarTesteResult> {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/pedidos/encerrar-teste", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id_int: idInt, encerrar, motivo: motivo ?? null })
    });
    const data = (await res.json().catch(() => null)) as (EncerrarTesteResult & { message?: string }) | null;
    if (res.ok && data?.success) return data;
    return { success: false, errorMessage: data?.message || `Falha na operação (HTTP ${res.status}).` };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}

/**
 * Marca o pedido como teste encerrado: sai das listas operacionais, continua
 * acessível por busca e por URL, e segue contando no faturamento.
 */
export function encerrarTeste(idInt: number, motivo?: string | null): Promise<EncerrarTesteResult> {
  return chamar(idInt, true, motivo);
}

/** Desfaz a marcação: o pedido volta às listas operacionais. */
export function reabrirTeste(idInt: number, motivo?: string | null): Promise<EncerrarTesteResult> {
  return chamar(idInt, false, motivo);
}
