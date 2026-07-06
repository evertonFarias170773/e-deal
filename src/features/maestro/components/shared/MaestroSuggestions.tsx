'use client';
import {
  FileText,
  Users,
  ClipboardList,
  Package,
  Truck,
  CreditCard,
  Receipt,
  BarChart3,
} from 'lucide-react';
import type { MaestroSuggestion } from '../../types';

const ICON_MAP: Record<string, React.FC<{ size?: number; className?: string }>> = {
  FileText,
  Users,
  ClipboardList,
  Package,
  Truck,
  CreditCard,
  Receipt,
  BarChart3,
};

const SPECIALIST_CARD: Record<string, { border: string; hover: string; icon: string; dot: string }> = {
  comercial: {
    border: 'border-blue-200 dark:border-blue-500/20',
    hover: 'hover:border-blue-400 dark:hover:border-blue-400/50 hover:shadow-blue-500/10',
    icon: 'text-blue-600 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  financeiro: {
    border: 'border-emerald-200 dark:border-emerald-500/20',
    hover: 'hover:border-emerald-400 dark:hover:border-emerald-400/50 hover:shadow-emerald-500/10',
    icon: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  producao: {
    border: 'border-orange-200 dark:border-orange-500/20',
    hover: 'hover:border-orange-400 dark:hover:border-orange-400/50 hover:shadow-orange-500/10',
    icon: 'text-orange-600 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
  expedicao: {
    border: 'border-cyan-200 dark:border-cyan-500/20',
    hover: 'hover:border-cyan-400 dark:hover:border-cyan-400/50 hover:shadow-cyan-500/10',
    icon: 'text-cyan-600 dark:text-cyan-400',
    dot: 'bg-cyan-500',
  },
  fiscal: {
    border: 'border-yellow-200 dark:border-yellow-500/20',
    hover: 'hover:border-yellow-400 dark:hover:border-yellow-400/50 hover:shadow-yellow-500/10',
    icon: 'text-yellow-600 dark:text-yellow-400',
    dot: 'bg-yellow-500',
  },
  produtos: {
    border: 'border-violet-200 dark:border-violet-500/20',
    hover: 'hover:border-violet-400 dark:hover:border-violet-400/50 hover:shadow-violet-500/10',
    icon: 'text-violet-600 dark:text-violet-400',
    dot: 'bg-violet-500',
  },
  geral: {
    border: 'border-slate-200 dark:border-slate-500/20',
    hover: 'hover:border-slate-400 dark:hover:border-slate-400/50 hover:shadow-slate-500/10',
    icon: 'text-slate-600 dark:text-slate-400',
    dot: 'bg-slate-500',
  },
};

interface Props {
  suggestions: MaestroSuggestion[];
  onSelect: (query: string) => void;
}

export function MaestroSuggestions({ suggestions, onSelect }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-8">
      {/* Greeting */}
      <div className="mb-12 flex flex-col items-center text-center">
        <div className="mb-6 h-24 w-24 overflow-hidden rounded-full border border-black/5 dark:border-white/10 shadow-sm bg-white dark:bg-slate-800 flex items-center justify-center p-2">
          <img 
            src="/agent_maestro_light_mode.png" 
            alt="Maestro"
            className="w-full h-full object-contain"
          />
        </div>
        <h1 className="text-[28px] font-semibold text-[var(--foreground)] dark:text-white mb-3 tracking-tight">
          Olá, Everton.
        </h1>
        <p className="text-[16px] text-[var(--muted)] dark:text-white/60">
          Em que posso ajudar hoje?
        </p>
      </div>

    </div>
  );
}
