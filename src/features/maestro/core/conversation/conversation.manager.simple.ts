'use client';

/**
 * conversation.manager.simple.ts
 *
 * Motor simples do Maestro (Maestro Simple v1).
 * Drop-in replacement para conversation.manager.ts — mesma interface.
 *
 * Fluxo:
 *   1. Usuário envia mensagem
 *   2. Adiciona mensagem do usuário + placeholder "thinking"
 *   3. Chama processSimpleQuery() — motor direto sem planner/registry/policy
 *   4. Substitui o placeholder pela resposta real
 *   5. Atualiza contexto no Provider
 *
 * ⚠️  Este arquivo é 'use client' — chama /api/maestro/simple server-side via fetch.
 *     NÃO importa 'use server' diretamente. O motor server-side fica em maestro-simple-engine.ts.
 *
 * Referência: docs/MAESTRO-PROMPT-BASE.md
 */

import { useContext, useCallback, useRef } from 'react';
import { MaestroContext } from '../../context/maestro.context';
import { MOCK_WELCOME_MESSAGES, MOCK_INITIAL_CONTEXT } from '../../mocks/maestro.mock';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { ConversationMessage } from '../../types';

// ─── Flag: motor simples por padrão ──────────────────────────────────────
export const MAESTRO_ENGINE: 'simple' | 'legacy' = 'simple';

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useConversationManagerSimple() {
  const context = useContext(MaestroContext);
  if (!context) throw new Error('Must be used within MaestroProvider');

  const {
    sessions,
    activeSessionId, setActiveSessionId,
    messages, setMessages,
    setActivity,
    context: globalContext,
    setContext: setGlobalContext,
    setIsLoading,
  } = context;

  // Ref para evitar stale closure no sendMessage
  const globalContextRef = useRef(globalContext);
  globalContextRef.current = globalContext;

  // ── Novo chat ────────────────────────────────────────────────────────────
  const startNewChat = useCallback(() => {
    setActiveSessionId(null);
    setMessages(MOCK_WELCOME_MESSAGES);
    setActivity([]);
    setGlobalContext(MOCK_INITIAL_CONTEXT);
  }, [setActiveSessionId, setMessages, setActivity, setGlobalContext]);

  // ── Abrir sessão (histórico — futuro) ────────────────────────────────────
  const openSession = useCallback((sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    setMessages(MOCK_WELCOME_MESSAGES);
    setActivity([]);
    setGlobalContext({ specialist: session.specialist || 'geral' });
  }, [sessions, setActiveSessionId, setMessages, setActivity, setGlobalContext]);

  // ── Enviar mensagem ───────────────────────────────────────────────────────
  const sendMessage = useCallback(async (query: string, scrollToBottom: () => void) => {
    if (!query.trim()) return;

    // 1. Adiciona mensagem do usuário
    const userMsg: ConversationMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: new Date().toISOString(),
      status: 'completed',
    };

    // 2. Placeholder "thinking"
    const thinkingId = `maestro-${Date.now()}`;
    const thinkingMsg: ConversationMessage = {
      id: thinkingId,
      role: 'maestro',
      content: '',
      timestamp: new Date().toISOString(),
      status: 'thinking',
    };

    setMessages(prev => [...prev, userMsg, thinkingMsg]);
    setIsLoading(true);
    scrollToBottom();

    try {
      // 3. Lê o token da sessão Supabase do browser para autenticar no server
      //    O token vai no header Authorization (não no body — body: apenas query + context)
      const supabaseBrowser = getSupabaseClient();
      const { data: sessionData } = supabaseBrowser
        ? await supabaseBrowser.auth.getSession()
        : { data: { session: null } };
      const accessToken = sessionData?.session?.access_token ?? '';

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      // 4. Chama o motor simples via route handler server-side
      //    Body: apenas { query, context } — sem tokens
      const response = await fetch('/api/maestro/simple', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          context: globalContextRef.current,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json() as {
        message: ConversationMessage;
        activity: any[];
        context: any;
      };

      // 4. Substitui o placeholder pela resposta real
      setMessages(prev =>
        prev.map(m => m.id === thinkingId ? { ...m, ...result.message } : m)
      );
      setActivity(result.activity || []);
      setGlobalContext(result.context || globalContextRef.current);

    } catch (err: any) {
      console.error('[MaestroSimple] Erro no sendMessage:', err?.message);
      // Substitui o placeholder por mensagem de erro amigável
      setMessages(prev =>
        prev.map(m => m.id === thinkingId ? {
          ...m,
          content: 'Houve um problema ao processar sua mensagem. Por favor, tente novamente.',
          status: 'error' as const,
        } : m)
      );
    } finally {
      setIsLoading(false);
      setTimeout(scrollToBottom, 100);
    }
  }, [setMessages, setActivity, setGlobalContext, setIsLoading]);

  return {
    sessions,
    activeSessionId,
    messages,
    startNewChat,
    openSession,
    sendMessage,
  };
}
