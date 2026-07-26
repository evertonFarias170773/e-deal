/**
 * maestro-persistence.server.ts
 *
 * Persistência de conversa e rascunho do Maestro (isolada por usuário via RLS).
 *
 * Estado: PREPARADA, controlada por flag.
 *   - MAESTRO_PERSISTENCE_ENABLED=true habilita a gravação;
 *   - exige a migration supabase/migrations/20260722_maestro_conversas.sql
 *     APLICADA (a migration é versionada e NÃO é aplicada automaticamente).
 *
 * Tabelas:
 *   - public.maestro_conversas  → uma linha por conversa (user_id = auth.uid()),
 *     com `contexto_json` guardando o rascunho (v2ContextJson) mais recente;
 *   - public.maestro_mensagens  → mensagens da conversa (user/maestro).
 *
 * Regras:
 *   - Client autenticado do usuário — RLS garante isolamento por usuário;
 *   - falha de persistência NUNCA quebra o fluxo do chat (log + retorno nulo);
 *   - nada de service_role.
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PersistirTurnoInput {
  /** Conversa existente (null → cria nova) */
  conversationId?: string | null;
  userQuery: string;
  assistantContent: string;
  /** Rascunho serializado (v2ContextJson) para retomada futura */
  contextoJson?: string | null;
}

/**
 * Persiste um turno (mensagem do usuário + resposta do Maestro) e o rascunho.
 * Retorna o id da conversa (novo ou existente), ou null quando desabilitado/falha.
 */
export async function persistirTurnoMaestro(
  supabase: SupabaseClient,
  input: PersistirTurnoInput
): Promise<string | null> {
  if (process.env.MAESTRO_PERSISTENCE_ENABLED !== 'true') {
    return input.conversationId ?? null;
  }

  try {
    let conversationId = input.conversationId ?? null;

    // ── 1. Garante a conversa ────────────────────────────────────────────────
    if (!conversationId) {
      const titulo = input.userQuery.slice(0, 80);
      const { data, error } = await supabase
        .from('maestro_conversas')
        .insert({ titulo })
        .select('id')
        .single();
      if (error || !data) {
        console.warn('[MaestroPersistence] Falha ao criar conversa:', error?.message);
        return null;
      }
      conversationId = data.id as string;
    }

    // ── 2. Insere as mensagens do turno ──────────────────────────────────────
    const { error: msgError } = await supabase.from('maestro_mensagens').insert([
      { conversa_id: conversationId, role: 'user', content: input.userQuery.slice(0, 4000) },
      { conversa_id: conversationId, role: 'maestro', content: input.assistantContent.slice(0, 8000) },
    ]);
    if (msgError) {
      console.warn('[MaestroPersistence] Falha ao gravar mensagens:', msgError.message);
    }

    // ── 3. Atualiza o rascunho (contexto) da conversa ────────────────────────
    const { error: updError } = await supabase
      .from('maestro_conversas')
      .update({
        contexto_json: input.contextoJson ? JSON.parse(input.contextoJson) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    if (updError) {
      console.warn('[MaestroPersistence] Falha ao atualizar rascunho:', updError.message);
    }

    return conversationId;
  } catch (err) {
    console.warn('[MaestroPersistence] Erro inesperado (ignorado):', err);
    return input.conversationId ?? null;
  }
}

/**
 * Lê o contexto (rascunho) persistido de UMA conversa. O servidor grava o
 * contexto final de cada turno em `maestro_conversas.contexto_json`
 * (persistirTurnoMaestro) — esta leitura é a FONTE DA VERDADE do turno
 * seguinte: estado autorado pelo servidor (ex.: pendências de ESCRITA)
 * nunca depende do eco do browser.
 * Retorna null quando desabilitado, sem conversa, sem rascunho ou em erro
 * (caller usa o contexto do browser como fallback).
 */
export async function carregarContextoConversa(
  supabase: SupabaseClient,
  conversationId: string | null | undefined
): Promise<string | null> {
  if (process.env.MAESTRO_PERSISTENCE_ENABLED !== 'true') return null;
  if (!conversationId || typeof conversationId !== 'string') return null;

  try {
    const { data, error } = await supabase
      .from('maestro_conversas')
      .select('contexto_json')
      .eq('id', conversationId)
      .maybeSingle();
    if (error || !data?.contexto_json) return null;
    return JSON.stringify(data.contexto_json);
  } catch {
    return null;
  }
}

/**
 * Recupera a conversa mais recente não encerrada do usuário (para retomada).
 * Retorna null quando desabilitado, sem dados ou em erro.
 */
export async function recuperarUltimaConversa(
  supabase: SupabaseClient
): Promise<{ id: string; contextoJson: string | null } | null> {
  if (process.env.MAESTRO_PERSISTENCE_ENABLED !== 'true') return null;

  try {
    const { data, error } = await supabase
      .from('maestro_conversas')
      .select('id, contexto_json')
      .eq('encerrada', false)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id as string,
      contextoJson: data.contexto_json ? JSON.stringify(data.contexto_json) : null,
    };
  } catch {
    return null;
  }
}
