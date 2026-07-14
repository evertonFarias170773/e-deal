'use client';
import { useMaestro } from './hooks/useMaestro';
import { MaestroMessage } from './components/chat/MaestroMessage';
import { MaestroSuggestions } from './components/shared/MaestroSuggestions';
import { MaestroInput } from './components/chat/MaestroInput';
import { MaestroLoadingBubble } from './components/chat/MaestroLoadingBubble';
import { MOCK_SUGGESTIONS } from './mocks/maestro.mock';
import { MaestroProvider } from './providers/maestro.provider';
import { Plus } from 'lucide-react';

export type PanelMode = 'expanded' | 'compact' | 'hidden';

function MaestroLayout() {
  const {
    messages,
    isLoading,
    inputValue,
    setInputValue,
    messagesEndRef,
    startNewChat,
    sendMessage,
  } = useMaestro();

  const showSuggestions = messages.length <= 1 && !isLoading;

  return (
    // Ocupa toda a largura disponível dentro do main do AppLayout
    // -m-4 lg:-m-6 cancela o padding do <main> do AppLayout para encostar nas bordas
    <div className="flex flex-col -m-4 lg:-m-6" style={{ height: 'calc(100dvh - 65px)' }}>

      {/* ─── Cabeçalho local do Maestro ─── */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-2 border-b border-[var(--border)] shrink-0" style={{ background: 'var(--card)' }}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg overflow-hidden flex items-center justify-center shadow-sm shrink-0">
            <img src="/agent_maestro_light_mode.png" alt="Maestro" className="w-full h-full object-contain" />
          </div>
          <span className="text-[13px] font-bold text-slate-800 tracking-tight">Maestro</span>
        </div>
        <button
          onClick={startNewChat}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-slate-500 hover:bg-slate-100 hover:text-blue-600 transition-all"
          title="Nova Conversa"
          aria-label="Nova Conversa"
        >
          <Plus size={14} />
          <span className="hidden sm:inline">Nova conversa</span>
        </button>
      </div>

      {/* ─── Área de conversa ─── */}
      <div className="flex flex-col flex-1 min-h-0 bg-[#FAFBFC] dark:bg-[var(--background)]">
        <div className="flex-1 overflow-y-auto">
          {showSuggestions ? (
            <MaestroSuggestions
              suggestions={MOCK_SUGGESTIONS}
              onSelect={sendMessage}
            />
          ) : (
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
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
