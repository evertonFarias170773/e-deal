'use client';
import { MessageSquare } from 'lucide-react';
import type { ConversaResumo } from '../../core/conversation/conversation.manager.simple';

interface Props {
  conversas: ConversaResumo[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

function formatarData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  if (mesmoDia) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Sidebar de histórico de conversas persistidas (desktop). */
export function MaestroConversasSidebar({ conversas, activeId, onSelect }: Props) {
  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-[var(--border)] bg-[var(--card)] overflow-y-auto">
      <div className="px-4 pt-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Conversas
      </div>

      {conversas.length === 0 ? (
        <p className="px-4 py-2 text-[12px] text-[var(--muted)]/80">
          Nenhuma conversa registrada ainda.
        </p>
      ) : (
        <ul className="px-2 pb-3 space-y-0.5">
          {conversas.map(c => {
            const ativa = c.id === activeId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={`w-full flex items-start gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                    ativa
                      ? 'bg-[var(--secondary)]/10 text-[var(--foreground)]'
                      : 'text-[var(--muted)] hover:bg-[var(--border)]/60 hover:text-[var(--foreground)]'
                  }`}
                  title={c.titulo}
                >
                  <MessageSquare size={14} className={`mt-0.5 shrink-0 ${ativa ? 'text-[var(--secondary)]' : ''}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] leading-snug truncate">{c.titulo}</span>
                    <span className="block text-[10.5px] opacity-70">{formatarData(c.atualizadaEm)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
