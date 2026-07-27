'use client';
import { Bot, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ConversationMessage } from '../../types';
import { MaestroTableRenderer } from '../renderers/MaestroTableRenderer';
import { MaestroCardRenderer } from '../renderers/MaestroCardRenderer';
import { MaestroMessageRenderer } from '../renderers/MaestroMessageRenderer';

interface Props {
  message: ConversationMessage;
  onSend?: (text: string) => void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Converte o subconjunto de markdown emitido pelo Maestro em HTML seguro:
 * escapa TODO o texto primeiro e só então reinsere as marcas suportadas
 * (imagem e link apenas com URL https, negrito, itálico).
 */
function parseContent(text: string): string {
  return escapeHtml(text)
    .replace(
      /!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g,
      '<img src="$2" alt="$1" loading="lazy" style="max-width:220px;max-height:220px;border-radius:12px;border:1px solid var(--border);display:inline-block;margin:4px 8px 4px 0;vertical-align:top" />',
    )
    .replace(
      /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline font-medium text-indigo-500 hover:text-indigo-600">$1</a>',
    )
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

export function MaestroMessage({ message, onSend }: Props) {
  const router = useRouter();
  const isUser = message.role === 'user';

  /** Trata o clique num botão de ação:
   * - Se value começa com '/' → navega via router.push (link interno ao ERP)
   * - Caso contrário → envia como texto ao chat */
  function handleAction(value: string) {
    if (value.startsWith('/')) {
      router.push(value);
    } else {
      onSend?.(value);
    }
  }

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
  const showActions = message.status === 'completed' && message.actions && message.actions.length > 0;

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
              style={{ whiteSpace: 'pre-wrap' }}
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

          {/* Action Buttons */}
          {showActions && (
            <div className="flex flex-wrap gap-2 pt-1 animate-in fade-in slide-in-from-bottom-1 duration-500">
              {message.actions!.map((action, i) => {
                const isDefault = !action.style || action.style === 'default';
                const isPrimary = action.style === 'primary';
                const isDanger = action.style === 'danger';
                return (
                  <button
                    key={i}
                    onClick={() => handleAction(action.value)}
                    className={`
                      px-4 py-1.5 rounded-full text-sm font-medium border transition-all duration-200
                      focus:outline-none focus:ring-2 focus:ring-offset-1
                      ${isPrimary
                        ? 'bg-indigo-500 text-white border-indigo-500 hover:bg-indigo-600 focus:ring-indigo-400'
                        : isDanger
                          ? 'border-red-500/40 text-red-500 hover:bg-red-500 hover:text-white focus:ring-red-400'
                          : 'border-[var(--border)] text-[var(--foreground)] hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-400 focus:ring-indigo-400'
                      }
                    `}
                  >
                    {action.label}
                  </button>
                );
              })}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
