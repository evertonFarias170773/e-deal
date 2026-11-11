"use client";

import { fetchComSessao } from "@/lib/supabase/sessao";
import type { ConversaWhatsapp } from "@/features/orcamentos/lib/conversa-whatsapp";

/**
 * Conversa do WhatsApp da proposta (Comprador da aba Artes, 10/11/2026), pela rota
 * /api/orcamentos/conversa-whatsapp: o navegador não lê a visão do ChatGuru.
 */

export type DadosDaConversa = {
  conversas: ConversaWhatsapp[];
  chatIdGravado: string | null;
  statusArte: string | null;
  /** A lista é do cliente gravado na proposta: a escolha pode ser gravada já. */
  clienteDaProposta: boolean;
};

const ROTA = "/api/orcamentos/conversa-whatsapp";

/**
 * Conversas do cliente que está na tela. Com id_int, a escolhida da proposta; sem
 * ele (proposta nova), ou com o cliente trocado e não salvo, só a lista.
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
        statusArte: corpo.statusArte ?? null,
        clienteDaProposta: corpo.clienteDaProposta === true
      }
    };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Não foi possível falar com o servidor." };
  }
}

export async function gravarConversaDaProposta(idInt: number, chatId: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const r = await fetchComSessao(ROTA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_int: idInt, chat_id: chatId })
    });
    const corpo = (await r.json().catch(() => ({}))) as { success?: boolean; message?: string };
    if (!r.ok || !corpo.success) return { ok: false, erro: corpo.message || "Não foi possível gravar a conversa." };
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Não foi possível falar com o servidor." };
  }
}
