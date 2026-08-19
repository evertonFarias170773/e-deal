import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Cliente da recotação de frete do despacho (Parte C, Etapa 1).
 *
 * A rota é READ-ONLY: cota e devolve. Nada é gravado — nem em `cotacao_frete`,
 * nem em `propostas.valor_frete`/`valor_total`, nem na Conta Corrente. Gravar o
 * valor e lançar a diferença são as etapas seguintes.
 *
 * Mesmo desenho de `correios.client.ts`: o token sai da sessão do browser e vai
 * no header, porque a rota autentica por Bearer OU cookie.
 */

async function tokenSessao(): Promise<string | null> {
  const client = getSupabaseClient();
  const sessionResult = client ? await client.auth.getSession() : null;
  return sessionResult?.data?.session?.access_token ?? null;
}

/** Uma opção cotada agora, já comparada com o frete que a proposta cobra hoje. */
export interface OpcaoRecotacao {
  id: string;
  transportadora: string;
  servico: string;
  valor: number;
  prazo: string;
  /** `valor − freteAtual`. Negativo = barateia (crédito futuro ao cliente). */
  diferenca: number;
  /** `valor <= 150`. Nesta etapa é rótulo informativo: nada é gravado. */
  dentroDaAlcada: boolean;
}

export interface RecotacaoResult {
  success: boolean;
  errorMessage?: string;
  freteAtual?: number;
  subtotalItens?: number;
  pesoGramas?: number;
  pesoOrigem?: string | null;
  endereco?: { rotulo: string; cep: string; cidade: string; uf: string } | null;
  opcoes?: OpcaoRecotacao[];
  avisos?: string[];
}

export async function recotarFrete(
  idInt: number,
  idEnderecoEntrega?: string | null
): Promise<RecotacaoResult> {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/expedicao/recotacao/cotar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id_int: idInt, id_endereco_entrega: idEnderecoEntrega ?? null })
    });
    const data = (await res.json().catch(() => null)) as (RecotacaoResult & { message?: string }) | null;
    if (res.ok && data?.success) return data;
    return { success: false, errorMessage: data?.message || `Falha ao recotar (HTTP ${res.status}).` };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}
