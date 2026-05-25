import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

type EmptyStateProps = {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
};

export function EmptyState({
  title = "Nenhum registro encontrado",
  description = "Ajuste os filtros ou crie um novo registro para comecar.",
  action,
  icon: Icon = Inbox
}: EmptyStateProps) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <span className="rounded-2xl bg-slate-100 p-4 text-slate-500">
        <Icon className="h-7 w-7" />
      </span>
      <h3 className="mt-5 text-lg font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
