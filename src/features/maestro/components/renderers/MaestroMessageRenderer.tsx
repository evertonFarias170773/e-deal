import React from 'react';
import { Bot, User, AlertTriangle, ArrowRight, XCircle } from 'lucide-react';
import type { ConversationMessage } from '../../types';
import type { ResponseModel } from '../../core/response/response.types';

interface MaestroMessageRendererProps {
  message: ConversationMessage;
}

export function MaestroMessageRenderer({ message }: MaestroMessageRendererProps) {
  const isMaestro = message.role === 'maestro';

  if (!isMaestro) {
    return (
      <div className="flex gap-3 px-4 py-3 bg-[var(--background)]">
        <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
          <User size={14} className="text-blue-500" />
        </div>
        <div className="flex-1 pt-1.5">
          <p className="text-[13px] text-[var(--foreground)]">{message.content}</p>
        </div>
      </div>
    );
  }

  // Render text-only message se não houver response model rico
  if (!message.responseModel) {
    return (
      <div className="flex gap-3 px-4 py-3 bg-[var(--muted)]/20 dark:bg-white/[0.02] border-y border-[var(--border)] dark:border-white/5">
        <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0 border border-indigo-500/20">
          <Bot size={14} className="text-indigo-400" />
        </div>
        <div className="flex-1 pt-1.5 space-y-2">
          {message.content && (
            <p className="text-[13px] text-[var(--foreground)] dark:text-white/80 leading-relaxed whitespace-pre-wrap">
              {message.content}
            </p>
          )}
          {message.status === 'error' && (
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/10 border border-red-500/20 text-red-500 text-[11px]">
              <XCircle size={12} />
              <span>Falha na operação</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const rm: ResponseModel = message.responseModel;

  return (
    <div className="flex gap-3 px-4 py-4 bg-[var(--muted)]/20 dark:bg-white/[0.02] border-y border-[var(--border)] dark:border-white/5 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0 border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.15)]">
        <Bot size={14} className="text-indigo-400" />
      </div>
      <div className="flex-1 pt-1 overflow-hidden space-y-4">
        
        {/* Header section */}
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--foreground)] tracking-tight">
            {rm.title}
          </h3>
          <p className="text-[13px] text-[var(--muted)] dark:text-white/70 mt-1 leading-relaxed whitespace-pre-wrap">
            {rm.summary}
          </p>
          {rm.explanation && (
            <p className="text-[12px] text-[var(--muted)] dark:text-white/50 mt-1.5 leading-relaxed whitespace-pre-wrap">
              {rm.explanation}
            </p>
          )}
        </div>

        {/* Warnings */}
        {rm.warnings && rm.warnings.length > 0 && (
          <div className="space-y-2">
            {rm.warnings.map((w, idx) => (
              <div key={idx} className="flex gap-2 items-start p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                <p className="text-[12px] text-amber-600 dark:text-amber-400 leading-snug">{w}</p>
              </div>
            ))}
          </div>
        )}

        {/* Highlights */}
        {rm.highlights && rm.highlights.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {rm.highlights.map((h, idx) => {
              const colors = {
                success: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500',
                danger: 'bg-red-500/10 border-red-500/20 text-red-500',
                warning: 'bg-amber-500/10 border-amber-500/20 text-amber-500',
                info: 'bg-blue-500/10 border-blue-500/20 text-blue-500',
                default: 'bg-[var(--background)] border-[var(--border)] text-[var(--foreground)]'
              };
              const colorClass = colors[h.color || 'default'];
              
              return (
                <div key={idx} className={`p-2.5 rounded-xl border ${colorClass}`}>
                  <p className="text-[10px] uppercase tracking-wider opacity-70 mb-1">{h.label}</p>
                  <p className="text-[13px] font-semibold">{h.value}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Cards */}
        {rm.cards && rm.cards.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rm.cards.map((c, idx) => (
              <div key={idx} className="p-3 rounded-xl bg-[var(--background)] border border-[var(--border)] dark:border-white/10 shadow-sm">
                <h4 className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)] mb-3">{c.title}</h4>
                {c.content && <p className="text-[12px] text-[var(--foreground)]">{c.content}</p>}
                {c.metadata && (
                  <div className="space-y-2">
                    {Object.entries(c.metadata).map(([k, v], midx) => (
                      <div key={midx} className="flex justify-between items-center text-[12px]">
                        <span className="text-[var(--muted)]">{k}</span>
                        <span className="font-medium text-[var(--foreground)]">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Tables */}
        {rm.tables && rm.tables.length > 0 && (
          <div className="space-y-4">
            {rm.tables.map((t, idx) => (
              <div key={idx} className="rounded-xl border border-[var(--border)] dark:border-white/10 overflow-hidden bg-[var(--background)]">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[12px]">
                    <thead>
                      <tr className="bg-[var(--muted)]/10 dark:bg-white/5 border-b border-[var(--border)] dark:border-white/10">
                        {t.headers.map((h, hidx) => (
                          <th key={hidx} className="px-3 py-2 font-semibold text-[var(--muted)] whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] dark:divide-white/5">
                      {t.rows.map((row, ridx) => (
                        <tr key={ridx} className="hover:bg-[var(--muted)]/5 dark:hover:bg-white/[0.02]">
                          {row.map((cell, cidx) => (
                            <td key={cidx} className="px-3 py-2.5 text-[var(--foreground)] whitespace-nowrap">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Recommendations */}
        {rm.recommendations && rm.recommendations.length > 0 && (
          <div className="space-y-2 pt-2">
             <h4 className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">Recomendações</h4>
             <ul className="list-disc list-inside text-[13px] text-[var(--foreground)] dark:text-white/70 space-y-1.5">
               {rm.recommendations.map((r, idx) => (
                 <li key={idx} dangerouslySetInnerHTML={{ __html: r.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
               ))}
             </ul>
          </div>
        )}

        {/* Next Actions */}
        {rm.nextActions && rm.nextActions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {rm.nextActions.map((na, idx) => (
              <button 
                key={idx}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border border-indigo-500/30 text-indigo-500 hover:bg-indigo-500 hover:text-white transition-colors"
              >
                <span>{na.label}</span>
                <ArrowRight size={12} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
