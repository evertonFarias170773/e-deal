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
  description = "Ajuste os filtros ou crie um novo registro para começar.",
  action,
  icon: Icon = Inbox
}: EmptyStateProps) {
  return (
    <div
      className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center"
      style={{
        background: "var(--card)",
        borderColor: "var(--border-strong)"
      }}
    >
      <span
        className="rounded-2xl p-4"
        style={{
          background: "var(--background)",
          color: "var(--muted)"
        }}
      >
        <Icon className="h-7 w-7" />
      </span>
      <h3
        className="mt-5 text-lg font-semibold"
        style={{ color: "var(--foreground)" }}
      >
        {title}
      </h3>
      <p
        className="mt-2 max-w-md text-sm leading-6"
        style={{ color: "var(--muted)" }}
      >
        {description}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
