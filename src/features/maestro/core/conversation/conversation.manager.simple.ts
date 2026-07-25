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
import { useRouter } from 'next/navigation';
import { MaestroContext } from '../../context/maestro.context';
import { MOCK_WELCOME_MESSAGES, MOCK_INITIAL_CONTEXT } from '../../mocks/maestro.mock';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { ActivityStep, ConversationContext, ConversationMessage } from '../../types';

// ─── Flag: motor simples por padrão ──────────────────────────────────────
export const MAESTRO_ENGINE: 'simple' | 'legacy' = 'simple';

/** Item da sidebar de histórico de conversas */
export interface ConversaResumo {
  id: string;
  titulo: string;
  encerrada: boolean;
  atualizadaEm: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useConversationManagerSimple() {
  const router = useRouter();
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

  // Refs para evitar stale closure no sendMessage
  const globalContextRef = useRef(globalContext);
  globalContextRef.current = globalContext;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  /**
   * Monta o histórico recente enviado ao servidor (últimos 8 turnos completos).
   * Apenas mensagens reais (user/maestro) com conteúdo; conteúdo truncado a
   * 600 chars para limitar o payload. O servidor re-sanitiza tudo.
   */
  const buildRecentMessages = (msgs: ConversationMessage[]) => {
    return msgs
      .filter(m => (m.role === 'user' || m.role === 'maestro'))
      .filter(m => m.status === 'completed' && typeof m.content === 'string' && m.content.trim().length > 0)
      .slice(-8)
      .map(m => ({
        role: m.role === 'maestro' ? 'assistant' : 'user',
        content: m.content.length > 600 ? m.content.slice(0, 600) + '…' : m.content,
      }));
  };

  /** Token da sessão Supabase do browser (para o header Authorization). */
  const getAccessToken = async (): Promise<string> => {
    const supabaseBrowser = getSupabaseClient();
    const { data: sessionData } = supabaseBrowser
      ? await supabaseBrowser.auth.getSession()
      : { data: { session: null } };
    return sessionData?.session?.access_token ?? '';
  };

  // ── Novo chat ────────────────────────────────────────────────────────────
  const startNewChat = useCallback(() => {
    // Encerra a conversa persistida no servidor (flag lógica; nunca bloqueia a UI)
    const conversationId = globalContextRef.current?.conversationId;
    if (conversationId) {
      getAccessToken().then(token => {
        if (!token) return;
        fetch('/api/maestro/simple/conversa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'encerrar', conversationId }),
        }).catch(() => { /* falha silenciosa — conversa só não fica encerrada */ });
      });
    }

    setActiveSessionId(null);
    setMessages(MOCK_WELCOME_MESSAGES);
    setActivity([]);
    setGlobalContext(MOCK_INITIAL_CONTEXT);
  }, [setActiveSessionId, setMessages, setActivity, setGlobalContext]);

  // ── Retomada automática da última conversa (persistência server-side) ────
  // Chamada uma vez no mount da página. Sem persistência ativa (ou sem
  // conversa aberta) o endpoint retorna vazio e nada muda — comportamento
  // idêntico ao anterior.
  const restoreLastConversation = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;

      const response = await fetch('/api/maestro/simple/conversa', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;

      const data = await response.json() as {
        conversa: {
          id: string;
          contextoJson: string | null;
          mensagens: Array<{ role: 'user' | 'maestro'; content: string; criadaEm: string }>;
        } | null;
      };

      if (!data.conversa || data.conversa.mensagens.length === 0) return;

      const restauradas: ConversationMessage[] = data.conversa.mensagens.map((m, i) => ({
        id: `hist-${i}-${m.criadaEm}`,
        role: m.role,
        content: m.content,
        contentType: 'text',
        timestamp: m.criadaEm,
        status: 'completed',
      }));

      setMessages(restauradas);
      setGlobalContext({
        ...MOCK_INITIAL_CONTEXT,
        conversationId: data.conversa.id,
        v2ContextJson: data.conversa.contextoJson ?? null,
      });
    } catch (err) {
      console.warn('[MaestroSimple] Retomada de conversa indisponível:', err);
    }
  }, [setMessages, setGlobalContext]);

  // ── Histórico de conversas (sidebar) ─────────────────────────────────────

  const listConversations = useCallback(async (): Promise<ConversaResumo[]> => {
    try {
      const token = await getAccessToken();
      if (!token) return [];
      const response = await fetch('/api/maestro/simple/conversa?list=1', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return [];
      const data = await response.json() as { conversas?: ConversaResumo[] };
      return Array.isArray(data.conversas) ? data.conversas : [];
    } catch {
      return [];
    }
  }, []);

  /**
   * Abre uma conversa do histórico: encerra a atual (flag lógica), reabre a
   * escolhida (para o F5 retomá-la) e reidrata mensagens + contexto.
   */
  const openConversation = useCallback(async (conversaId: string) => {
    const atualId = globalContextRef.current?.conversationId;
    if (!conversaId || conversaId === atualId) return;

    try {
      const token = await getAccessToken();
      if (!token) return;

      const response = await fetch(`/api/maestro/simple/conversa?id=${encodeURIComponent(conversaId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await response.json() as {
        conversa: {
          id: string;
          contextoJson: string | null;
          mensagens: Array<{ role: 'user' | 'maestro'; content: string; criadaEm: string }>;
        } | null;
      };
      if (!data.conversa) return;

      // Flags lógicas no servidor (nunca bloqueiam a UI)
      const marcar = (id: string, action: 'encerrar' | 'reabrir') =>
        fetch('/api/maestro/simple/conversa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action, conversationId: id }),
        }).catch(() => { /* falha silenciosa */ });
      if (atualId) void marcar(atualId, 'encerrar');
      void marcar(data.conversa.id, 'reabrir');

      const restauradas: ConversationMessage[] = data.conversa.mensagens.map((m, i) => ({
        id: `hist-${i}-${m.criadaEm}`,
        role: m.role,
        content: m.content,
        contentType: 'text',
        timestamp: m.criadaEm,
        status: 'completed',
      }));

      setMessages(restauradas.length > 0 ? restauradas : MOCK_WELCOME_MESSAGES);
      setActivity([]);
      setGlobalContext({
        ...MOCK_INITIAL_CONTEXT,
        conversationId: data.conversa.id,
        v2ContextJson: data.conversa.contextoJson ?? null,
      });
    } catch (err) {
      console.warn('[MaestroSimple] Falha ao abrir conversa do histórico:', err);
    }
  }, [setMessages, setActivity, setGlobalContext]);

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
      //    Body: { query, context, recentMessages } — sem tokens
      //    recentMessages = últimos turnos ANTERIORES a esta mensagem
      //    (a mensagem atual já vai em `query`).
      const response = await fetch('/api/maestro/simple', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          context: globalContextRef.current,
          recentMessages: buildRecentMessages(messagesRef.current),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json() as {
        message: ConversationMessage;
        activity: ActivityStep[];
        context: ConversationContext;
      };

      // 4. Substitui o placeholder pela resposta real
      setMessages(prev =>
        prev.map(m => m.id === thinkingId ? { ...m, ...result.message } : m)
      );
      setActivity(result.activity || []);
      setGlobalContext(result.context || globalContextRef.current);

      // Redireciona automaticamente se a proposta foi salva com sucesso
      if (
        result.message.id.startsWith('save-ok') &&
        result.message.actions &&
        result.message.actions.length > 0
      ) {
        const redirectUrl = result.message.actions[0].value;
        if (redirectUrl.startsWith('/')) {
          console.log(`[Maestro] Proposta salva. Redirecionando para ${redirectUrl}`);
          setTimeout(() => {
            router.push(redirectUrl);
          }, 800);
        }
      }

    } catch (err) {
      console.error('[MaestroSimple] Erro no sendMessage:', err instanceof Error ? err.message : err);
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
    restoreLastConversation,
    listConversations,
    openConversation,
  };
}
