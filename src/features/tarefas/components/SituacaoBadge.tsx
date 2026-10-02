import { cn } from "@/lib/utils";
import {
  PRIORIDADE_ROTULO,
  TAREFA_STATUS_ROTULO,
  type NovidadeTipo,
  type TarefaPrioridade,
  type TarefaStatus
} from "@/features/tarefas/types";

const COR_STATUS: Record<TarefaStatus, string> = {
  ABERTA: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  EM_ANDAMENTO: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  CONCLUIDA: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  CANCELADA: "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
};

export function SituacaoBadge({ status }: { status: TarefaStatus }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", COR_STATUS[status])}>
      {TAREFA_STATUS_ROTULO[status]}
    </span>
  );
}

/** Normal nao ganha selo: so Alta e Urgente chamam atencao. */
export function PrioridadeBadge({ prioridade }: { prioridade: TarefaPrioridade }) {
  if (prioridade === "NORMAL") return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        prioridade === "URGENTE" ? "bg-red-600 text-white" : "bg-amber-500 text-white"
      )}
    >
      {PRIORIDADE_ROTULO[prioridade]}
    </span>
  );
}

const ROTULO_NOVIDADE: Record<NovidadeTipo, string> = {
  CRIADA: "Nova",
  MENSAGEM: "Nova mensagem",
  ASSUMIDA: "Assumida",
  CONCLUIDA: "Concluída agora",
  CANCELADA: "Cancelada agora",
  ALTERADA: "Prazo ou prioridade"
};

/** Selo piscando na linha enquanto houver novidade que eu ainda nao abri. */
export function NovaBadge({ tipo }: { tipo?: NovidadeTipo }) {
  return (
    <span
      data-selo-nova={tipo ?? "CRIADA"}
      className="inline-flex shrink-0 animate-pulse items-center rounded-full bg-amber-600 px-2 py-0.5 text-[11px] font-bold text-white"
    >
      {ROTULO_NOVIDADE[tipo ?? "CRIADA"]}
    </span>
  );
}
