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

/** Resultado de aplicar UMA opção do frete complementar (etapa E6). */
export interface AplicacaoFreteComplementar {
  success: boolean;
  code?: string;
  errorMessage?: string;
  /** true quando a chave já tinha sido aplicada: nada foi gravado de novo. */
  idempotente?: boolean;
  idLedger?: number;
  idIntPrincipal?: number;
  pesoOriginalGramas?: number;
  pesoOrigemOriginal?: string | null;
  pesoComplementoGramas?: number;
  pesoSomadoGramas?: number;
  freteCobradoOriginal?: number;
  valorTotalCotado?: number;
  diferenca?: number;
  valorACobrar?: number;
  transportadora?: string;
  servico?: string;
  prazo?: string;
  /** Preço de agora, quando a recotação do servidor discordou da tela. */
  valorAgora?: number;
}

export async function aplicarFreteComplementar(params: {
  idIntComplemento: number;
  chave: string;
  opcaoId: string;
  valorVisto: number;
}): Promise<AplicacaoFreteComplementar> {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/orcamentos/complementar/aplicar-frete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(params)
    });
    const data = (await res.json().catch(() => null)) as
      | (AplicacaoFreteComplementar & { message?: string })
      | null;
    if (res.ok && data?.success) return data;
    return {
      success: false,
      code: data?.code,
      valorAgora: data?.valorAgora,
      errorMessage: data?.message || `Falha ao aplicar o frete complementar (HTTP ${res.status}).`
    };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}

/** A linha VIGENTE do ledger deste complemento: a mais recente por `aplicado_em`. */
export interface LinhaFreteComplementar {
  id: number;
  idIntPrincipal: number;
  aplicadoEm: string;
  pesoOriginalGramas: number;
  pesoOrigemOriginal: string;
  pesoComplementoGramas: number;
  pesoSomadoGramas: number;
  freteTotalCotado: number;
  freteCobradoOriginal: number;
  diferenca: number;
  freteCobradoComplemento: number;
  transportadora: string;
  servico: string;
  prazo: string | null;
  /** Preenchido = o vínculo foi desfeito e este frete não vale mais. */
  desvinculadoEm: string | null;
  desvinculadoMotivo: string | null;
}

export async function buscarFreteComplementarVigente(
  idIntComplemento: number
): Promise<LinhaFreteComplementar | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("complementos_frete")
    .select(
      "id, id_int_principal, aplicado_em, peso_original_gramas, peso_origem_original, peso_complemento_gramas, peso_somado_gramas, frete_total_cotado, frete_cobrado_original, diferenca, frete_cobrado_complemento, transportadora, servico, prazo, desvinculado_em, desvinculado_motivo"
    )
    .eq("id_int_complemento", idIntComplemento)
    .order("aplicado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: Number(data.id),
    idIntPrincipal: Number(data.id_int_principal),
    aplicadoEm: String(data.aplicado_em),
    pesoOriginalGramas: Number(data.peso_original_gramas),
    pesoOrigemOriginal: String(data.peso_origem_original),
    pesoComplementoGramas: Number(data.peso_complemento_gramas),
    pesoSomadoGramas: Number(data.peso_somado_gramas),
    freteTotalCotado: Number(data.frete_total_cotado),
    freteCobradoOriginal: Number(data.frete_cobrado_original),
    diferenca: Number(data.diferenca),
    freteCobradoComplemento: Number(data.frete_cobrado_complemento),
    transportadora: String(data.transportadora),
    servico: String(data.servico),
    prazo: data.prazo !== null && data.prazo !== undefined ? String(data.prazo) : null,
    desvinculadoEm: data.desvinculado_em ? String(data.desvinculado_em) : null,
    desvinculadoMotivo: data.desvinculado_motivo ? String(data.desvinculado_motivo) : null
  };
}
