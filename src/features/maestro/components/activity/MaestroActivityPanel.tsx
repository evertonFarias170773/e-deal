'use client';
import { CheckCircle2, Loader2, AlertCircle, Circle } from 'lucide-react';
import type { ActivityStep, SpecialistType } from '../../types';

const SPECIALIST_INFO: Record<
  SpecialistType,
  { label: string; labelColor: string; bg: string; border: string; spinColor: string }
> = {
  comercial: {
    label: 'Especialista Comercial',
    labelColor: 'text-blue-700 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-900/15',
    border: 'border-blue-200 dark:border-blue-500/20',
    spinColor: 'text-blue-500',
  },
  financeiro: {
    label: 'Especialista Financeiro',
    labelColor: 'text-emerald-700 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-900/15',
    border: 'border-emerald-200 dark:border-emerald-500/20',
    spinColor: 'text-emerald-500',
  },
  produtos: {
    label: 'Especialista Produtos',
    labelColor: 'text-violet-700 dark:text-violet-400',
    bg: 'bg-violet-50 dark:bg-violet-900/15',
    border: 'border-violet-200 dark:border-violet-500/20',
    spinColor: 'text-violet-500',
  },
  producao: {
    label: 'Especialista Produção',
    labelColor: 'text-orange-700 dark:text-orange-400',
    bg: 'bg-orange-50 dark:bg-orange-900/15',
    border: 'border-orange-200 dark:border-orange-500/20',
    spinColor: 'text-orange-500',
  },
  fiscal: {
    label: 'Especialista Fiscal',
    labelColor: 'text-yellow-700 dark:text-yellow-400',
    bg: 'bg-yellow-50 dark:bg-yellow-900/15',
    border: 'border-yellow-200 dark:border-yellow-500/20',
    spinColor: 'text-yellow-500',
  },
  expedicao: {
    label: 'Especialista Expedição',
    labelColor: 'text-cyan-700 dark:text-cyan-400',
    bg: 'bg-cyan-50 dark:bg-cyan-900/15',
    border: 'border-cyan-200 dark:border-cyan-500/20',
    spinColor: 'text-cyan-500',
  },
  geral: {
    label: 'Maestro Geral',
    labelColor: 'text-slate-700 dark:text-slate-400',
    bg: 'bg-slate-50 dark:bg-slate-900/15',
    border: 'border-slate-200 dark:border-slate-500/20',
    spinColor: 'text-slate-500',
  },
};

interface Props {
  activity: ActivityStep[];
  specialist?: SpecialistType;
  isLoading: boolean;
}

export function MaestroActivityPanel({ activity, specialist, isLoading }: Props) {
  const info = SPECIALIST_INFO[specialist || 'geral'];

  return (
    <div className="space-y-4">
      {/* Active specialist badge */}
      {specialist && specialist !== 'geral' && (
        <div className={`rounded-xl border px-3 py-2.5 ${info.bg} ${info.border}`}>
          <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--muted)] dark:text-white/35 mb-1">
            Especialista ativo
          </p>
          <p className={`text-xs font-semibold ${info.labelColor}`}>{info.label}</p>
          {isLoading && (
            <div className={`flex items-center gap-1.5 mt-1 ${info.spinColor}`}>
              <Loader2 size={10} className="animate-spin" />
              <span className="text-[10px]">Processando...</span>
            </div>
          )}
        </div>
      )}

      {/* Activity timeline */}
      {activity.length > 0 && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--muted)] dark:text-white/35 mb-2.5">
            Atividade
          </p>
          <div className="space-y-2.5">
            {activity.map(step => (
              <div key={step.id} className="flex items-start gap-2">
                {/* Icon */}
                <div className="shrink-0 mt-0.5">
                  {step.status === 'done' && <CheckCircle2 size={13} className="text-emerald-500" />}
                  {step.status === 'running' && (
                    <Loader2 size={13} className="text-[var(--secondary)] animate-spin" />
                  )}
                  {step.status === 'error' && <AlertCircle size={13} className="text-red-500" />}
                  {step.status === 'pending' && <Circle size={13} className="text-[var(--muted)]/30" />}
                </div>

                {/* Label */}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-[11px] leading-tight ${
                      step.status === 'done'
                        ? 'text-[var(--foreground)] dark:text-white/80'
                        : step.status === 'running'
                          ? 'text-[var(--secondary)] font-semibold'
                          : 'text-[var(--muted)]/60 dark:text-white/30'
                    }`}
                  >
                    {step.label}
                  </p>
                  {step.detail && (
                    <p className="text-[9px] font-mono text-[var(--muted)] dark:text-white/35 mt-0.5">
                      {step.detail}
                    </p>
                  )}
                </div>

                {/* Timestamp */}
                {step.timestamp && step.status === 'done' && (
                  <span className="text-[9px] text-[var(--muted)]/50 dark:text-white/20 shrink-0 tabular-nums">
                    {step.timestamp}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
