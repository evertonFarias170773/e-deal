'use client';
import { useRouter } from 'next/navigation';
import { Save, X, Edit3, ChevronRight } from 'lucide-react';
import type { MaestroAction } from '../../types';

interface MaestroSaveBarProps {
  actions: MaestroAction[];
  /** Resumo da cotação para exibir no banner (ex: "LISITON — R$ 7.059,39") */
  summary?: string;
  onSend: (text: string) => void;
}

function ActionIcon({ style }: { style?: string }) {
  if (style === 'primary') return <Save size={14} />;
  if (style === 'danger') return <X size={14} />;
  return <Edit3 size={14} />;
}

export function MaestroSaveBar({ actions, summary, onSend }: MaestroSaveBarProps) {
  const router = useRouter();

  function handleAction(value: string) {
    if (value.startsWith('/')) {
      router.push(value);
    } else {
      onSend(value);
    }
  }

  return (
    <div
      className="
        flex items-center gap-3 px-4 py-2.5
        border-t border-indigo-500/20
        bg-gradient-to-r from-indigo-950/60 to-blue-950/40
        dark:from-indigo-950/80 dark:to-blue-950/60
        backdrop-blur-sm
        animate-in slide-in-from-bottom-2 fade-in duration-300
      "
    >
      {/* Ícone + texto */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
          <Save size={12} className="text-indigo-400" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[11px] font-semibold text-indigo-300 uppercase tracking-wider leading-none mb-0.5">
            Cotação aguardando confirmação
          </span>
          {summary && (
            <span className="text-[12px] text-white/70 truncate">{summary}</span>
          )}
        </div>
      </div>

      {/* Botões de ação */}
      <div className="flex items-center gap-2 shrink-0">
        {actions.map((action, i) => {
          const isPrimary = action.style === 'primary';
          const isDanger = action.style === 'danger';
          return (
            <button
              key={i}
              onClick={() => handleAction(action.value)}
              title={action.label}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-full
                text-[12px] font-semibold border
                transition-all duration-200 whitespace-nowrap
                focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-transparent
                ${isPrimary
                  ? 'bg-indigo-500 text-white border-indigo-400 hover:bg-indigo-400 focus:ring-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.4)]'
                  : isDanger
                    ? 'bg-transparent text-red-400 border-red-500/40 hover:bg-red-500/20 hover:border-red-400 focus:ring-red-400'
                    : 'bg-white/5 text-white/80 border-white/10 hover:bg-white/10 hover:border-white/20 focus:ring-white/30'
                }
              `}
            >
              <ActionIcon style={action.style} />
              <span>{action.label}</span>
              {isPrimary && <ChevronRight size={12} className="opacity-70" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
