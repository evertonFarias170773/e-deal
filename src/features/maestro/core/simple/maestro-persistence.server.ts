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
 * Persiste UMA mensagem avulsa do Maestro (ex.: saudação do dia), criando a
 * conversa quando necessário. A idempotência da saudação DEPENDE desta
 * gravação: é a mensagem persistida de hoje que impede a repetição no F5.
 * Retorna o id da conversa, ou null quando desabilitado/falha.
 */
export async function persistirMensagemMaestro(
  supabase: SupabaseClient,
  input: { conversationId: string | null; content: string; tituloSeNova?: string },
): Promise<string | null> {
  if (process.env.MAESTRO_PERSISTENCE_ENABLED !== 'true') return null;

  try {
    let conversationId = input.conversationId;

    if (!conversationId) {
      const titulo = (input.tituloSeNova ?? input.content).slice(0, 80);
      const { data, error } = await supabase
        .from('maestro_conversas')
        .insert({ titulo })
        .select('id')
        .single();
      if (error || !data) {
        console.warn('[MaestroPersistence] Falha ao criar conversa (mensagem avulsa):', error?.message);
        return null;
      }
      conversationId = data.id as string;
    }

    const { error: msgError } = await supabase
      .from('maestro_mensagens')
      .insert([{ conversa_id: conversationId, role: 'maestro', content: input.content.slice(0, 8000) }]);
    if (msgError) {
      console.warn('[MaestroPersistence] Falha ao gravar mensagem avulsa:', msgError.message);
      return null;
    }

    const { error: updError } = await supabase
      .from('maestro_conversas')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (updError) {
      console.warn('[MaestroPersistence] Falha ao atualizar conversa (mensagem avulsa):', updError.message);
    }

    return conversationId;
  } catch (err) {
    console.warn('[MaestroPersistence] Erro inesperado em mensagem avulsa (ignorado):', err);
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
