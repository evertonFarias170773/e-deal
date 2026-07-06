'use client';
import { PanelRightClose, PanelRightOpen, Check, CircleDot, Circle, User, Target, Layers, PlaySquare } from 'lucide-react';
import type { ConversationContext, ActivityStep } from '../../types';
import { specialistRegistry } from '../../specialists/specialist.registry';
import { PanelMode } from '../../MaestroPage';

interface Props {
  context: ConversationContext;
  activity: ActivityStep[];
  isLoading: boolean;
  panelMode?: PanelMode;
  setPanelMode?: (m: PanelMode) => void;
}

export function MaestroContextPanel({ context, activity, isLoading, panelMode = 'expanded', setPanelMode }: Props) {
  const hasContext = context.clientName || context.proposalId || context.orderId || context.intent;

  if (panelMode === 'hidden') {
    return (
      <div className="absolute top-4 right-6 z-10">
        <button
          onClick={() => setPanelMode?.('expanded')}
          className="p-2 rounded-xl bg-white border border-[var(--border)] shadow-sm text-slate-400 hover:text-slate-600 transition-all"
          title="Mostrar Inteligência"
        >
          <PanelRightOpen size={16} />
        </button>
      </div>
    );
  }

  if (panelMode === 'compact') {
    return (
      <div className="w-[60px] shrink-0 border-l border-[var(--border)] flex flex-col items-center py-4 bg-white transition-all h-full overflow-y-auto">
        <button onClick={() => setPanelMode?.('hidden')} className="p-2 text-slate-400 hover:text-slate-600 mb-6" title="Ocultar Painel">
           <PanelRightClose size={16} />
        </button>
        <button onClick={() => setPanelMode?.('expanded')} className="p-2 text-slate-400 hover:text-slate-600 mb-6" title="Expandir Painel">
           <PanelRightOpen size={16} />
        </button>

        <div className="flex flex-col gap-4 items-center">
          {context.specialist && context.specialist !== 'geral' && (
            <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600" title={`Especialista Ativo: ${context.specialist}`}>
               <User size={14} />
            </div>
          )}
          {context.clientName && (
            <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500" title={`Cliente: ${context.clientName}`}>
               <Target size={14} />
            </div>
          )}
          {context.proposalId && (
            <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500" title={`Proposta: ${context.proposalId}`}>
               <Layers size={14} />
            </div>
          )}
          {context.activePlan && (
            <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600" title="Plano em Execução">
               <PlaySquare size={14} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Expanded Mode
  return (
    <div className="w-[280px] shrink-0 border-l border-[var(--border)] overflow-y-auto bg-white transition-all h-full">
      {/* Header Actions */}
      <div className="flex items-center justify-between p-5 pb-4">
         <h3 className="text-[13px] font-bold text-slate-800 tracking-tight">Inteligência</h3>
         <div className="flex items-center gap-1">
           <button onClick={() => setPanelMode?.('compact')} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors" title="Modo Compacto">
              <PanelRightClose size={14} />
           </button>
           <button onClick={() => setPanelMode?.('hidden')} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors" title="Ocultar">
              <PanelRightOpen size={14} />
           </button>
         </div>
      </div>

      <div className="px-5 pb-6 space-y-6">
        {/* Inteligência */}
        {context.specialist && context.specialist !== 'geral' && (
          <div>
            <p className="text-[14px] font-semibold text-slate-800">
               {specialistRegistry.resolve(context.specialist)?.name || 'Especialista'}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              <p className="text-[12px] text-slate-500">Alta Confiança</p>
            </div>
          </div>
        )}

        {hasContext && <hr className="border-[var(--border)]" />}

        {/* Contexto */}
        {hasContext && (
          <div>
             <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Contexto</h4>
             <ul className="space-y-2.5 text-[13px] text-slate-700">
               {context.clientName && <li><strong className="font-medium text-slate-400 mr-1">Cliente</strong> {context.clientName}</li>}
               {context.proposalId && <li><strong className="font-medium text-slate-400 mr-1">Proposta</strong> {context.proposalId}</li>}
               {context.orderId && <li><strong className="font-medium text-slate-400 mr-1">Pedido</strong> {context.orderId}</li>}
               {context.company && <li><strong className="font-medium text-slate-400 mr-1">Empresa</strong> {context.company}</li>}
             </ul>
          </div>
        )}

        {context.activePlan && context.activePlan.steps.length > 0 && <hr className="border-[var(--border)]" />}

        {/* Plano */}
        {context.activePlan && context.activePlan.steps.length > 0 && (
          <div>
             <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Plano</h4>
             <ul className="space-y-3">
               {context.activePlan.steps.map(step => (
                 <li key={step.id} className="flex items-start gap-2.5">
                   {step.status === 'completed' ? (
                      <Check size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                   ) : step.status === 'running' ? (
                      <CircleDot size={14} className="text-blue-500 mt-0.5 shrink-0 animate-pulse" />
                   ) : (
                      <Circle size={14} className="text-slate-300 mt-0.5 shrink-0" />
                   )}
                   <span className={`text-[13px] leading-snug ${step.status === 'completed' ? 'text-slate-400' : 'text-slate-700'}`}>{step.title}</span>
                 </li>
               ))}
             </ul>
          </div>
        )}

        {activity && activity.length > 0 && <hr className="border-[var(--border)]" />}

        {/* Atividade / Timeline */}
        {activity && activity.length > 0 && (
          <div>
             <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Atividade</h4>
             <ul className="space-y-3">
               {activity.map(step => (
                 <li key={step.id} className="flex items-start gap-2.5">
                   {step.status === 'done' ? (
                      <Check size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                   ) : step.status === 'running' ? (
                      <CircleDot size={14} className="text-blue-500 mt-0.5 shrink-0 animate-pulse" />
                   ) : (
                      <Circle size={14} className="text-slate-300 mt-0.5 shrink-0" />
                   )}
                   <div className="flex-1 min-w-0">
                     <p className={`text-[13px] leading-snug ${step.status === 'done' ? 'text-slate-500' : 'text-slate-800'}`}>
                        {step.label}
                     </p>
                     {step.detail && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{step.detail}</p>}
                   </div>
                 </li>
               ))}
             </ul>
          </div>
        )}

        {!hasContext && activity.length === 0 && (
          <div className="pt-4">
            <p className="text-[13px] text-slate-400 leading-relaxed">
              O Maestro analisa suas mensagens para construir contexto e montar planos automaticamente.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
