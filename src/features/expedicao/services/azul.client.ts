import { getSupabaseClient } from "@/lib/supabase/client";
import type { ServicoAzul, TipoEntregaAzul, VolumeAzul } from "../lib/azul-awb";

/**
 * Cliente das rotas da AWB da Azul. Mesmo desenho de `recotacao.client.ts`: o
 * token da sessao vai no header. Quem decide e valida e o servidor.
 */

async function tokenSessao(): Promise<string | null> {
  const client = getSupabaseClient();
  const sessionResult = client ? await client.auth.getSession() : null;
  return sessionResult?.data?.session?.access_token ?? null;
}

export type PreparoAzul = {
  ambiente: "sandbox" | "producao";
  nfe: { chave: string; valorTotal: number; dataEmissao: string; origemData: "emissao" | "autorizacao" };
  destinatario: {
    nome: string;
    documento: string;
    ie: string;
    email: string;
    telefone: string;
    cidade: string;
    uf: string;
    cep: string;
  };
  qtdVolumes: number;
  pesoPorVolumeKg: number | null;
  naturezaPadrao: string;
  baseDestino: string | null;
};

export type EmissaoAzulInput = {
  idInt: number;
  servico: ServicoAzul;
  tipoEntrega: TipoEntregaAzul;
  natureza: string;
  unidadeDestino: string;
  volumes: VolumeAzul[];
  destinatario: { ie: string; isento: boolean; email: string; telefone: string };
};

type Resposta<T> = ({ success: true } & T) | { success: false; errorMessage: string; code?: string };

async function postar<T>(caminho: string, corpo: unknown): Promise<Resposta<T>> {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch(caminho, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(corpo)
    });
    const data = (await res.json().catch(() => null)) as (T & { success?: boolean; message?: string; code?: string }) | null;
    if (res.ok && data?.success) return { ...(data as T), success: true };
    return { success: false, errorMessage: data?.message || `Falha (HTTP ${res.status}).`, code: data?.code };
  } catch {
    return { success: false, errorMessage: "Falha de conexão. Tente de novo." };
  }
}

export function prepararAwbAzul(idInt: number) {
  return postar<PreparoAzul>("/api/expedicao/azul/preparar", { id_int: idInt });
}

export function emitirAwbAzul(input: EmissaoAzulInput) {
  return postar<{ awb: string; ambiente: "sandbox" | "producao" }>("/api/expedicao/azul/awb", {
    id_int: input.idInt,
    servico: input.servico,
    tipo_entrega: input.tipoEntrega,
    natureza: input.natureza,
    unidade_destino: input.unidadeDestino,
    volumes: input.volumes,
    destinatario: input.destinatario
  });
}
