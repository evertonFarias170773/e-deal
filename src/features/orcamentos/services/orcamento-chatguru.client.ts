"use client";

import { getSupabaseClient } from "@/lib/supabase/client";
import type { AvisoPronto, DiagnosticoChatGuru } from "@/features/expedicao/services/aviso-pronto.client";

/**
 * Orçamento pelo WhatsApp (box 9 da proposta, 14/11/2026): diálogo "Orçamento
 * Whatsapp" do ChatGuru com o texto do box 9 gravado na proposta
 * (propostas.texto_whatsapp). Tudo passa pela Edge Function
 * `expedicao-pedido-pronto` (v29): ela relê a proposta pela sessão, manda para
 * cada conversa de Contatos do pedido e grava cada envio no histórico de avisos
 * (evento orcamento_whatsapp), com a mesma trava por conversa.
 */

export type ConversaDoOrcamento = {
  chat_id: string;
  nome: string;
  numero: string | null;
  /** Por que esta conversa seria recusada agora (120 s, trava, fora do cliente). */
  bloqueio: string | null;
};

export type OrcamentoTravado = { seq: number; chat_id: string | null; nome: string; criado_em: string };

export type PreparoOrcamento = {
  ok: boolean;
  mensagem?: string;
  /** Texto gravado que vai no campo Orcamento. */
  texto?: string | null;
  tamanho?: number | null;
  limite?: number;
  /** Recusa da proposta inteira (sem texto, texto longo, sem conversa escolhida). */
  bloqueio?: string | null;
  conversas?: ConversaDoOrcamento[];
  travados?: OrcamentoTravado[];
  pode_liberar?: boolean;
};

export type EnvioDoOrcamento = {
  chat_id: string;
  nome: string;
  aviso: AvisoPronto | null;
  recusa: string | null;
  motivo_chatguru: string | null;
  diagnostico_chatguru?: DiagnosticoChatGuru[] | null;
};

export type ResultadoOrcamento = { ok: boolean; mensagem?: string; envios?: EnvioDoOrcamento[] };

const FUNCAO = "expedicao-pedido-pronto";

async function chamar<T extends { ok: boolean; mensagem?: string }>(corpo: Record<string, unknown>): Promise<T> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, mensagem: "Supabase não configurado." } as T;
  const { data, error } = await supabase.functions.invoke(FUNCAO, { body: corpo });
  if (!error) return (data ?? { ok: false, mensagem: "Resposta vazia." }) as T;
  const contexto = (error as { context?: unknown }).context;
  if (contexto instanceof Response) {
    try {
      const corpoErro = (await contexto.json()) as { mensagem?: string };
      return { ok: false, mensagem: corpoErro?.mensagem || "Não foi possível falar com o ChatGuru." } as T;
    } catch {
      /* corpo não é JSON */
    }
  }
  return { ok: false, mensagem: "Não foi possível falar com o servidor. Confira a conversa no ChatGuru antes de tentar de novo." } as T;
}

/** Só leitura: o texto gravado, as conversas e o que seria recusado. */
export function prepararOrcamentoChatGuru(idInt: number) {
  return chamar<PreparoOrcamento>({ acao: "orcamento_preparar", id_int: idInt });
}

/** Envia para todas as conversas de Contatos do pedido; o resultado vem por conversa. */
export function enviarOrcamentoChatGuru(idInt: number) {
  return chamar<ResultadoOrcamento>({ acao: "orcamento_enviar", id_int: idInt, confirmado: true });
}

/** Liberar número (só ADM) de um orçamento sem confirmação, depois de conferir no ChatGuru. */
export function liberarOrcamentoChatGuru(idInt: number, seq: number, resposta: "enviada" | "nao_enviada") {
  return chamar<{ ok: boolean; mensagem?: string }>({ acao: "liberar", id_int: idInt, seq, resposta, confirmado: true });
}

/** Mesma limpeza do servidor (textoDoOrcamento), para comparar o box 9 com o texto gravado. */
export function textoComparavel(texto: string | null | undefined): string {
  return String(texto ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\s+$/, "");
}
