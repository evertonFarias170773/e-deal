'use client';
import { Bot, User } from 'lucide-react';
import type { ConversationMessage } from '../../types';
import { MaestroTableRenderer } from '../renderers/MaestroTableRenderer';
import { MaestroCardRenderer } from '../renderers/MaestroCardRenderer';
import { MaestroMessageRenderer } from '../renderers/MaestroMessageRenderer';

interface Props {
  message: ConversationMessage;
}

function parseContent(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

export function MaestroMessage({ message }: Props) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end mb-5 group animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex items-start gap-2.5 max-w-[68%]">
          <div
            className="rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed text-white shadow-sm"
            style={{ background: 'var(--primary)' }}
          >
            {message.content}
          </div>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 shadow transition-transform group-hover:scale-105"
            style={{ background: 'var(--primary)' }}
          >
            <User size={14} className="text-white" />
          </div>
        </div>
      </div>
    );
  }

  if (message.responseModel) {
    return <MaestroMessageRenderer message={message} />;
  }

  const isThinking = message.status === 'thinking';
  const isStreaming = message.status === 'streaming';
  const showComponents = message.status === 'completed' && message.components;

  return (
    <div className="flex justify-start mb-7 group animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-start gap-3 w-full max-w-[88%]">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-blue-700 flex items-center justify-center shrink-0 mt-0.5 shadow-md transition-transform group-hover:scale-105">
          <Bot size={14} className="text-white" />
        </div>

        <div className="flex-1 space-y-3">
          {/* Thinking state */}
          {isThinking && (
            <div className="flex items-center gap-1.5 pt-2">
              <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--secondary)', animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--secondary)', animationDelay: '160ms' }} />
              <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--secondary)', animationDelay: '320ms' }} />
            </div>
          )}

          {/* Text Content */}
          {(message.content || isStreaming) && (
            <div
              className={`text-sm leading-relaxed text-[var(--foreground)] dark:text-white/90 ${
                isStreaming
                  ? "after:content-[''] after:inline-block after:w-1.5 after:h-4 after:-mb-0.5 after:ml-0.5 after:bg-[var(--secondary)] after:animate-pulse"
                  : ''
              }`}
              dangerouslySetInnerHTML={{ __html: parseContent(message.content) }}
            />
          )}

          {/* Dynamic components (only after text completes) */}
          {showComponents && message.components?.map((comp, i) => (
            <div key={i} className="animate-in fade-in slide-in-from-bottom-1 duration-500 fill-mode-both" style={{ animationDelay: `${i * 150}ms` }}>
              {comp.type === 'table' && (
                <MaestroTableRenderer data={comp.data as Record<string, unknown>} />
              )}
              {comp.type === 'card' && (
                <MaestroCardRenderer data={comp.data as Record<string, unknown>} />
              )}
            </div>
          ))}

        </div>
      </div>
    </div>
  );
}
