"use client";

import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Aviso "pedido pronto" pelo WhatsApp da Ideal (ChatGuru), 06/11/2026.
 *
 * Tudo passa pela Edge Function `expedicao-pedido-pronto`: ela confere a
 * sessão e a permissão, relê pedido e contato, reserva e envia. A tabela
 * `expedicao_aviso_pronto` é só do service_role; a tela nunca lê nem grava nela.
 */

export type EstadoAviso = "preparando" | "aguardando" | "enviado" | "falhou" | "desconhecido";

export type AvisoPronto = {
  seq: number;
  estado: EstadoAviso;
  message_id: string | null;
  modo_teste: boolean;
  autor_nome: string | null;
  criado_em: string;
  atualizado_em: string;
};

/** Recusa do ChatGuru por número: o número que foi enviado e o contato do pedido. */
export type RecusaPorNumero = { numero_enviado: string; id_contato: number };

type Resposta = {
  ok: boolean;
  mensagem?: string;
  modo_teste?: boolean;
  ja_existia?: boolean;
  aviso?: AvisoPronto | null;
  avisos?: Record<string, AvisoPronto | null>;
  status_chatguru?: string | null;
  /** Motivo da recusa dado pelo ChatGuru (ex.: "Chat não encontrado."). Não é gravado. */
  motivo_chatguru?: string | null;
  /** Só quando o ChatGuru recusou pelo número ("Chat não encontrado."). Não é gravado. */
  recusa_numero?: RecusaPorNumero | null;
};

const FUNCAO = "expedicao-pedido-pronto";

async function chamar(corpo: Record<string, unknown>): Promise<Resposta> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, mensagem: "Supabase não configurado." };
  const { data, error } = await supabase.functions.invoke(FUNCAO, { body: corpo });
  if (!error) return (data ?? { ok: false, mensagem: "Resposta vazia." }) as Resposta;

  // Erro HTTP da função: a mensagem legível vem no corpo da resposta.
  const contexto = (error as { context?: unknown }).context;
  if (contexto instanceof Response) {
    try {
      const corpoErro = (await contexto.json()) as Resposta;
      return { ok: false, mensagem: corpoErro?.mensagem || "Não foi possível falar com o ChatGuru." };
    } catch {
      /* corpo não é JSON */
    }
  }
  return { ok: false, mensagem: "Não foi possível falar com o servidor. Consulte o status antes de tentar de novo." };
}

export function listarAvisosPronto(ids: number[]) {
  return chamar({ acao: "listar", ids });
}

/** Primeiro aviso. Se já houve um, o servidor devolve o que existe e não envia. */
export function enviarAvisoPronto(idInt: number) {
  return chamar({ acao: "enviar", id_int: idInt });
}

/** Nova reserva e novo envio — só depois da confirmação na tela. */
export function reenviarAvisoPronto(idInt: number, seqAtual: number) {
  return chamar({ acao: "reenviar", id_int: idInt, seq_atual: seqAtual, confirmado: true });
}

export function consultarStatusAvisoPronto(idInt: number) {
  return chamar({ acao: "status", id_int: idInt });
}

export const ROTULO_ESTADO_AVISO: Record<EstadoAviso, string> = {
  preparando: "enviando",
  aguardando: "aguardando confirmação do WhatsApp",
  enviado: "entregue ao WhatsApp",
  falhou: "falhou",
  desconhecido: "resultado desconhecido"
};
