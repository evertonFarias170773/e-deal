import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Cliente do frete do PEDIDO COMPLEMENTAR (docs/business/PEDIDO-COMPLEMENTAR.md).
 *
 * Nesta etapa há só a COTAÇÃO, e ela é read-only: cota o peso somado e devolve
 * as opções com a diferença contra o frete que o principal já cobra. Nada é
 * gravado — nem `cotacao_frete`, nem `propostas`, nem o ledger. Aplicar é da
 * etapa seguinte.
 *
 * Mesmo desenho de `expedicao/services/recotacao.client.ts`: o token sai da
 * sessão do browser e vai no header, porque a rota autentica por Bearer OU
 * cookie.
 */

async function tokenSessao(): Promise<string | null> {
  const client = getSupabaseClient();
  const sessionResult = client ? await client.auth.getSession() : null;
  return sessionResult?.data?.session?.access_token ?? null;
}

/** Uma opção do peso somado, já comparada com o frete do pedido principal. */
export interface OpcaoFreteComplementar {
  id: string;
  transportadora: string;
  servico: string;
  prazo: string;
  /** Frete do peso somado (principal + complemento) nesta opção. */
  valorTotalCotado: number;
  /** `propostas.valor_frete` do principal no momento da cotação. */
  freteCobradoOriginal: number;
  /** `valorTotalCotado − freteCobradoOriginal`. Negativo = somado ficou menor. */
  diferenca: number;
  /** A diferença, nunca negativa: somado menor que o cobrado cobra zero. */
  valorACobrar: number;
  /** Destaque "Mesmo serviço do #X" na lista (decisão 9 do dono). */
  mesmoServicoDoOriginal: boolean;
  /** Nasce por opção quando a cotação chega; torna o aplicar idempotente. */
  chaveIdempotencia: string;
}

export interface CotacaoComplementarResult {
  success: boolean;
  /** Código do gate que recusou (`NAO_E_COMPLEMENTO`, `SEM_PESO`, ...). */
  code?: string;
  errorMessage?: string;
  idIntComplemento?: number;
  idIntPrincipal?: number;
  /** Peso do principal pela precedência única (aferido > bruto > cotado > teórico). */
  pesoOriginalGramas?: number;
  pesoOrigemOriginal?: "aferido" | "bruto" | "cotado" | "teorico" | null;
  pesoComplementoGramas?: number;
  pesoSomadoGramas?: number;
  subtotalOriginal?: number;
  subtotalComplemento?: number;
  freteCobradoOriginal?: number;
  /** `propostas.frete_escolhido` do principal — o rótulo, cru. */
  servicoOriginal?: string | null;
  endereco?: { rotulo: string; cep: string; cidade: string; uf: string } | null;
  opcoes?: OpcaoFreteComplementar[];
  avisos?: string[];
}

export async function cotarFreteComplementar(
  idIntComplemento: number
): Promise<CotacaoComplementarResult> {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/orcamentos/complementar/cotar-frete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ idIntComplemento })
    });
    const data = (await res.json().catch(() => null)) as
      | (CotacaoComplementarResult & { message?: string })
      | null;
    if (res.ok && data?.success) return data;
    return {
      success: false,
      code: data?.code,
      errorMessage: data?.message || `Falha ao cotar o frete complementar (HTTP ${res.status}).`
    };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}
