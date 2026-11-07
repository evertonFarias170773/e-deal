"use client";

import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Aviso "pedido pronto" pelo WhatsApp da Ideal (ChatGuru), 06/11/2026. Desde
 * 07/11/2026 por diálogo com template (um por forma de envio): o estado final é
 * "executado" — o ChatGuru não devolve message_id nem status de entrega.
 *
 * Tudo passa pela Edge Function `expedicao-pedido-pronto`: ela confere a
 * sessão e a permissão, relê pedido e contato, reserva e envia. A tabela
 * `expedicao_aviso_pronto` é só do service_role; a tela nunca lê nem grava nela.
 */

export type EstadoAviso = "preparando" | "aguardando" | "enviado" | "executado" | "falhou" | "desconhecido";

/**
 * Diálogo do ChatGuru escolhido pelo servidor para a forma de envio do pedido
 * (07/11/2026). Sem diálogo ou com bloqueio, o botão fica apagado com o aviso.
 */
export type ModeloAviso = { dialogo: string | null; bloqueio: string | null };

export type AvisoPronto = {
  seq: number;
  estado: EstadoAviso;
  message_id: string | null;
  /** Nome do diálogo usado (Sedex, Retira...). Nulo nos avisos antigos por texto. */
  dialogo?: string | null;
  /** Diálogo em incerteza: o WhatsApp fica travado para novos avisos. */
  trava_conversa?: boolean;
  modo_teste: boolean;
  /** "Liberar número" (ADM): quem conferiu no ChatGuru, quando e o que respondeu. */
  liberacao?: { por: string | null; em: string; resposta: "enviada" | "nao_enviada" | null } | null;
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
  modelos?: Record<string, ModeloAviso>;
  modelo?: ModeloAviso | null;
  /** Etapa em que o ChatGuru recusou ou ficou incerto: campos ou diálogo. */
  etapa_chatguru?: "campos" | "dialogo" | null;
  status_chatguru?: string | null;
  /** Motivo da recusa dado pelo ChatGuru (ex.: "Chat não encontrado."). Não é gravado. */
  motivo_chatguru?: string | null;
  /** Só para ADM: HTTP e texto do ChatGuru em cada etapa, sem chave nem contato. Não é gravado. */
  diagnostico_chatguru?: DiagnosticoChatGuru[] | null;
  /** Só quando o ChatGuru recusou pelo número ("Chat não encontrado."). Não é gravado. */
  recusa_numero?: RecusaPorNumero | null;
};

export type DiagnosticoChatGuru = { etapa: string; http: number | null; texto: string };

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

/**
 * "Liberar número" (só ADM, aviso de diálogo em resultado desconhecido), depois
 * de conferir no ChatGuru. "enviada" -> executado, sem reenviar; "nao_enviada" ->
 * falhou, e o Reenviar volta.
 */
export function liberarNumeroAviso(idInt: number, seq: number, resposta: "enviada" | "nao_enviada") {
  return chamar({ acao: "liberar", id_int: idInt, seq, resposta, confirmado: true });
}

export function consultarStatusAvisoPronto(idInt: number) {
  return chamar({ acao: "status", id_int: idInt });
}

export const ROTULO_ESTADO_AVISO: Record<EstadoAviso, string> = {
  preparando: "enviando",
  aguardando: "aguardando confirmação do WhatsApp",
  enviado: "entregue ao WhatsApp",
  executado: "diálogo executado no ChatGuru",
  falhou: "falhou",
  desconhecido: "resultado desconhecido"
};
