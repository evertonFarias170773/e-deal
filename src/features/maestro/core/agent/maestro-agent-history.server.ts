/**
 * maestro-agent-history.server.ts
 *
 * Reconstrói o histórico real da conversa para o Agent Loop a partir da
 * persistência server-side (public.maestro_mensagens, RLS por usuário).
 *
 * Regras:
 *   - só atua com MAESTRO_PERSISTENCE_ENABLED=true e conversationId válido
 *     (migration 20260722_maestro_conversas.sql aplicada);
 *   - janela de ~30 turnos — sem o wipe de 15 minutos do contexto legado;
 *   - conteúdo redigido (redigirConteudoSensivel) antes de ir ao modelo;
 *   - falha NUNCA quebra o fluxo — retorna [] e o chamador usa o fallback
 *     (recentMessages sanitizado do client).
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { redigirConteudoSensivel, type RecentTurn } from '../simple/maestro-recent-turns';

/** Janela máxima de mensagens (user + maestro) reconstruídas do banco. */
const MAX_MENSAGENS = 60; // ~30 turnos

const MAX_CHARS_POR_MENSAGEM = 2000;

/**
 * Lê as últimas mensagens da conversa persistida e devolve em ordem
 * cronológica no formato RecentTurn (role 'user' | 'assistant').
 */
export async function carregarHistoricoConversa(
  supabase: SupabaseClient,
  conversationId: string | null | undefined
): Promise<RecentTurn[]> {
  if (process.env.MAESTRO_PERSISTENCE_ENABLED !== 'true') return [];
  if (!conversationId || typeof conversationId !== 'string') return [];

  try {
    // Desempate por id: user e maestro do mesmo turno são inseridos juntos e
    // recebem created_at idêntico — sem o id a ordem do par pode inverter.
    const { data, error } = await supabase
      .from('maestro_mensagens')
      .select('role, content, created_at')
      .eq('conversa_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(MAX_MENSAGENS);

    if (error || !data) {
      if (error) console.warn('[MaestroAgentHistory] Falha ao ler histórico (ignorada):', error.message);
      return [];
    }

    // Voltando à ordem cronológica (a query lê do fim para trás)
    return data
      .reverse()
      .filter(m => m.role === 'user' || m.role === 'maestro')
      .map(m => {
        const cleaned = redigirConteudoSensivel(String(m.content ?? '')).trim();
        return {
          role: (m.role === 'user' ? 'user' : 'assistant') as RecentTurn['role'],
          content:
            cleaned.length > MAX_CHARS_POR_MENSAGEM
              ? cleaned.slice(0, MAX_CHARS_POR_MENSAGEM) + '…'
              : cleaned,
        };
      })
      .filter(m => m.content.length > 0);
  } catch (err) {
    console.warn('[MaestroAgentHistory] Erro inesperado (ignorado):', err);
    return [];
  }
}
