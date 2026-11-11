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
};

const ROTA = "/api/orcamentos/conversa-whatsapp";

export async function carregarConversasDaProposta(idInt: number): Promise<{ ok: true; dados: DadosDaConversa } | { ok: false; erro: string }> {
  try {
    const r = await fetchComSessao(`${ROTA}?id_int=${idInt}`, { method: "GET" });
    const corpo = (await r.json().catch(() => ({}))) as Partial<DadosDaConversa> & { success?: boolean; message?: string };
    if (!r.ok || !corpo.success) return { ok: false, erro: corpo.message || "Não foi possível ler as conversas do cliente." };
    return {
      ok: true,
      dados: { conversas: corpo.conversas ?? [], chatIdGravado: corpo.chatIdGravado ?? null, statusArte: corpo.statusArte ?? null }
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
