'use client';
import { useMaestro } from './hooks/useMaestro';
import { MaestroSessionList } from './components/context/MaestroSessionList';
import { MaestroMessage } from './components/chat/MaestroMessage';
import { MaestroSuggestions } from './components/shared/MaestroSuggestions';
import { MaestroInput } from './components/chat/MaestroInput';
import { MaestroContextPanel } from './components/context/MaestroContextPanel';
import { MaestroLoadingBubble } from './components/chat/MaestroLoadingBubble';
import { MOCK_SUGGESTIONS } from './mocks/maestro.mock';
import { MaestroProvider } from './providers/maestro.provider';
import { useState } from 'react';

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
