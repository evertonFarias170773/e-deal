import { getSupabaseClient } from "@/lib/supabase/client";
import { mensagemDeErroAcompanhar, type CandidatoAcompanhar } from "../lib/acompanhar-pedido";

/**
 * Cliente da rota `/api/orcamentos/acompanhar` (Fase 7). Mesmo desenho dos
 * outros clientes do complemento: o token sai da sessao do browser e vai no
 * header. A rota grava na hora, sem passar pelo Salvar do orcamento.
 */

export type MembroAcompanhar = {
  idInt: number;
  cliente: string;
  statusInterno: string;
  criadoEm: string | null;
  criadoPorNome: string | null;
  proprio: boolean;
};

export type EstadoAcompanhar = {
  idInt: number;
  podeEditar: boolean;
  podeSoltarDeTerceiro: boolean;
  /** Motivo de so leitura (despachado, cancelado, fora do funil...) ou null. */
  somenteLeitura: string | null;
  /** Status do proprio pedido (para dizer que ainda nao chegou a Expedicao). */
  statusInterno: string;
  grupoId: string | null;
  /** Todos os pedidos ativos do grupo, inclusive o proprio. */
  membros: MembroAcompanhar[];
  candidatos: CandidatoAcompanhar[];
  tetoGrupo: number;
};

export type RespostaAcompanhar = { success: true; estado: EstadoAcompanhar } | { success: false; errorMessage: string; code?: string };

async function tokenSessao(): Promise<string | null> {
  const client = getSupabaseClient();
  const sessionResult = client ? await client.auth.getSession() : null;
  return sessionResult?.data?.session?.access_token ?? null;
}

async function chamar(url: string, init: RequestInit): Promise<RespostaAcompanhar> {
  try {
    const token = await tokenSessao();
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      estado?: EstadoAcompanhar;
      message?: string;
      code?: string;
    } | null;
    if (res.ok && json?.success && json.estado) return { success: true, estado: json.estado };
    return {
      success: false,
      code: json?.code,
      errorMessage: json?.message || mensagemDeErroAcompanhar(res.status, json?.code, null)
    };
  } catch {
    return { success: false, errorMessage: "Nao foi possivel falar com o servidor. Tente de novo." };
  }
}

export function buscarEstadoAcompanhar(idInt: number, busca?: string): Promise<RespostaAcompanhar> {
  const q = busca && busca.trim() ? `&q=${encodeURIComponent(busca.trim())}` : "";
  return chamar(`/api/orcamentos/acompanhar?id_int=${idInt}${q}`, { method: "GET" });
}

export function vincularAcompanhar(idInt: number, outros: number[]): Promise<RespostaAcompanhar> {
  return chamar("/api/orcamentos/acompanhar", {
    method: "POST",
    body: JSON.stringify({ acao: "vincular", id_int: idInt, outros })
  });
}

export function soltarAcompanhar(idInt: number, motivo: string, solta?: number): Promise<RespostaAcompanhar> {
  return chamar("/api/orcamentos/acompanhar", {
    method: "POST",
    body: JSON.stringify({ acao: "soltar", id_int: idInt, motivo, ...(solta ? { solta } : {}) })
  });
}
