"use client";

import { fetchComSessao } from "@/lib/supabase/sessao";
import type { ConversaWhatsapp } from "@/features/orcamentos/lib/conversa-whatsapp";

/**
 * Conversas do WhatsApp da proposta pela rota /api/orcamentos/conversa-whatsapp:
 * o navegador não lê a visão do ChatGuru. Desde 14/11/2026 o pedido guarda uma ou
 * mais conversas (contatos do pedido), uma delas a principal (o Comprador).
 */

export type EscolhaGravada = { chat_id: string; principal: boolean };

export type DadosDaConversa = {
  conversas: ConversaWhatsapp[];
  chatIdGravado: string | null;
  /** As conversas escolhidas do pedido; a principal é o Comprador. */
  escolhidas: EscolhaGravada[];
  statusArte: string | null;
  /** A lista é do cliente gravado na proposta: a escolha pode ser gravada já. */
  clienteDaProposta: boolean;
};

const ROTA = "/api/orcamentos/conversa-whatsapp";

/**
 * Conversas do cliente que está na tela. Com id_int, as escolhidas da proposta;
 * sem ele (proposta nova), ou com o cliente trocado e não salvo, só a lista.
 */
export async function carregarConversasDaProposta(
  idInt: number | null,
  idCliente: string | null = null
): Promise<{ ok: true; dados: DadosDaConversa } | { ok: false; erro: string }> {
  try {
    const q = new URLSearchParams();
    if (idInt) q.set("id_int", String(idInt));
    if (idCliente) q.set("id_cliente", idCliente);
    const r = await fetchComSessao(`${ROTA}?${q.toString()}`, { method: "GET" });
    const corpo = (await r.json().catch(() => ({}))) as Partial<DadosDaConversa> & { success?: boolean; message?: string };
    if (!r.ok || !corpo.success) return { ok: false, erro: corpo.message || "Não foi possível ler as conversas do cliente." };
    return {
      ok: true,
      dados: {
        conversas: corpo.conversas ?? [],
        chatIdGravado: corpo.chatIdGravado ?? null,
        escolhidas: Array.isArray(corpo.escolhidas) ? corpo.escolhidas : [],
        statusArte: corpo.statusArte ?? null,
        clienteDaProposta: corpo.clienteDaProposta === true
      }
    };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Não foi possível falar com o servidor." };
  }
}

async function postar(corpoPedido: Record<string, unknown>): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const r = await fetchComSessao(ROTA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpoPedido)
    });
    const corpo = (await r.json().catch(() => ({}))) as { success?: boolean; message?: string };
    if (!r.ok || !corpo.success) return { ok: false, erro: corpo.message || "Não foi possível gravar a conversa." };
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Não foi possível falar com o servidor." };
  }
}

/** Só a principal (aba Artes): as outras conversas escolhidas ficam. */
export function gravarConversaDaProposta(idInt: number, chatId: string) {
  return postar({ id_int: idInt, chat_id: chatId });
}

/** A escolha inteira (aba Geral): as conversas do pedido e a principal. */
export function gravarContatosDaProposta(idInt: number, chatIds: string[], principal: string) {
  return postar({ id_int: idInt, chat_ids: chatIds, principal });
}
