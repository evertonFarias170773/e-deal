'use client';
import { useMaestro } from './hooks/useMaestro';
import { MaestroSessionList } from './components/context/MaestroSessionList';
import { MaestroMessage } from './components/chat/MaestroMessage';
import { MaestroSuggestions } from './components/shared/MaestroSuggestions';
import { MaestroInput } from './components/chat/MaestroInput';
import { MaestroContextPanel } from './components/context/MaestroContextPanel';
import { MaestroLoadingBubble } from './components/chat/MaestroLoadingBubble';
import { MaestroSaveBar } from './components/chat/MaestroSaveBar';
import { MOCK_SUGGESTIONS } from './mocks/maestro.mock';
import { MaestroProvider } from './providers/maestro.provider';
import { useState, useMemo } from 'react';

export type PanelMode = 'expanded' | 'compact' | 'hidden';

function MaestroLayout() {
  const {
    sessions,
    activeSessionId,
    messages,
    activity,
    context,
    isLoading,
    inputValue,
    setInputValue,
    messagesEndRef,
    startNewChat,
    openSession,
    sendMessage,
  } = useMaestro();

  const [panelMode, setPanelMode] = useState<PanelMode>('expanded');

  const showSuggestions = messages.length <= 1 && !isLoading;

  // ── Banner fixo de confirmação de salvar ─────────────────────────────────
  // Encontra a última mensagem Maestro que tem actions.
  // Se a mensagem mais recente do Maestro NÃO tem actions, o contexto mudou → banner some.
  const pendingSaveActions = useMemo(() => {
    // Procura do final para o início
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      // Mensagens de usuário: continua procurando
      if (msg.role === 'user') continue;
      // Mensagens com responseModel são respostas ricas antigas (não são o save prompt)
      // → continua procurando abaixo delas
      if (msg.role === 'maestro' && msg.responseModel) continue;
      // Mensagem do Maestro sem actions e sem responseModel = contexto encerrado
      if (msg.role === 'maestro' && (!msg.actions || msg.actions.length === 0)) {
        return null;
      }
      // Mensagem do Maestro com actions = banner ativo
      if (msg.role === 'maestro' && msg.actions && msg.actions.length > 0) {
        return msg.actions;
      }
    }
    return null;
  }, [messages]);

  // Extrai resumo da cotação (Cliente + Total) para exibir no banner
  const saveBarSummary = useMemo(() => {
    if (!pendingSaveActions) return undefined;
    const lastActionMsg = [...messages].reverse().find(
      m => m.role === 'maestro' && m.actions && m.actions.length > 0
    );
    if (!lastActionMsg) return undefined;
    const content = lastActionMsg.content ?? '';
    const clientMatch = content.match(/\*\*Cliente:\*\*\s*([^\n]+)/);
    const totalMatch = content.match(/\*\*Total:\*\*\s*(R\$[^\n]+)/);
    if (clientMatch && totalMatch) {
      return `${clientMatch[1].trim()} — ${totalMatch[1].trim()}`;
    }
    return undefined;
  }, [pendingSaveActions, messages]);

  return (
    <div className="flex overflow-hidden -m-4 lg:-m-6" style={{ height: 'calc(100vh - 65px)' }}>
      {/* ─────────── LEFT: Session History ─────────── */}
      <MaestroSessionList
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewChat={startNewChat}
        onOpenSession={openSession}
      />

      {/* ─────────── CENTER: Conversation ─────────── */}
      <div className="flex flex-col flex-1 min-w-0 bg-[#FAFBFC] dark:bg-[var(--background)] relative">
        <div className="flex-1 overflow-y-auto">
          {showSuggestions ? (
            <MaestroSuggestions
              suggestions={MOCK_SUGGESTIONS}
              onSelect={sendMessage}
            />
          ) : (
            <div className="max-w-4xl mx-auto px-6 py-4">
              {messages.map(msg => (
                <MaestroMessage key={msg.id} message={msg} onSend={sendMessage} />
              ))}
              {isLoading && !messages.some(m => m.status === 'thinking' || m.status === 'streaming') && (
                <MaestroLoadingBubble />
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── Banner fixo de cotação pendente (acima do input) ─────────────── */}
        {pendingSaveActions && !isLoading && (
          <MaestroSaveBar
            actions={pendingSaveActions}
            summary={saveBarSummary}
            onSend={sendMessage}
          />
        )}

        <MaestroInput
          value={inputValue}
          onChange={setInputValue}
          onSend={sendMessage}
          isLoading={isLoading}
        />
      </div>

      {/* ─────────── RIGHT: Context Panel ─────────── */}
      <MaestroContextPanel
        context={context}
        activity={activity}
        isLoading={isLoading}
        panelMode={panelMode}
        setPanelMode={setPanelMode}
      />
    </div>
  );
}

interface MaestroPageProps {
  /** Injetado pelo server component (page.tsx) via process.env.MAESTRO_LLM_ENABLED */
  llmEnabled?: boolean;
}

export function MaestroPage({ llmEnabled = false }: MaestroPageProps) {
  return (
    <MaestroProvider llmEnabled={llmEnabled}>
      <MaestroLayout />
    </MaestroProvider>
  );
}
