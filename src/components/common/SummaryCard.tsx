import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { StatusTone } from "@/lib/types";
import { cn } from "@/lib/utils";

const toneStyles: Record<StatusTone, string> = {
  success: "bg-teal-50 text-teal-700 ring-teal-200",
  info:    "bg-sky-50 text-sky-800 ring-sky-200",
  warning: "bg-orange-50 text-orange-700 ring-orange-200",
  danger:  "bg-red-50 text-red-700 ring-red-200",
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  special: "bg-teal-50 text-teal-700 ring-teal-200"
};

const toneStylesDark: Record<StatusTone, string> = {
  success: "dark:bg-teal-900/30 dark:text-teal-300 dark:ring-teal-800",
  info:    "dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800",
  warning: "dark:bg-orange-900/30 dark:text-orange-300 dark:ring-orange-800",
  danger:  "dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800",
  neutral: "dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  special: "dark:bg-teal-900/30 dark:text-teal-300 dark:ring-teal-800"
};

// Card usado como filtro: quando ativo, ganha fundo e borda do próprio tom —
// mesma leitura dos chips de filtro (borda -600 + fundo do tom), só que com o
// preenchimento claro, para o número continuar legível.
const toneStylesAtivo: Record<StatusTone, string> = {
  success: "border-teal-600 bg-teal-50 dark:bg-teal-900/30",
  info:    "border-sky-600 bg-sky-50 dark:bg-sky-900/30",
  warning: "border-orange-600 bg-orange-50 dark:bg-orange-900/30",
  danger:  "border-red-600 bg-red-50 dark:bg-red-900/30",
  neutral: "border-slate-700 bg-slate-100 dark:bg-slate-800",
  special: "border-teal-600 bg-teal-50 dark:bg-teal-900/30"
};

// No card ativo o selo do ícone vira o preenchimento cheio do tom, igual ao chip
// de filtro selecionado — sem isso ele sumiria dentro do fundo claro do card.
const toneStylesAtivoIcone: Record<StatusTone, string> = {
  success: "bg-teal-600 text-white ring-teal-600",
  info:    "bg-sky-600 text-white ring-sky-600",
  warning: "bg-orange-600 text-white ring-orange-600",
  danger:  "bg-red-600 text-white ring-red-600",
  neutral: "bg-slate-700 text-white ring-slate-700",
  special: "bg-teal-600 text-white ring-teal-600"
};

type SummaryCardProps = {
  title: string;
  value: string;
  description: ReactNode;
  tone?: StatusTone;
  trend?: string;
  /** Tom do chip de tendência quando difere do tom do card (↑ verde, ↓ vermelho). */
  trendTone?: StatusTone;
  icon?: LucideIcon;
  /** Quando informado, o card vira um atalho de filtro (clique e Enter/Espaço). */
  onClick?: () => void;
  /** Estado do filtro do card. Só faz sentido junto de `onClick`. */
  ativo?: boolean;
};

export function SummaryCard({
  title,
  value,
  description,
  tone = "neutral",
  trend,
  trendTone,
  icon: Icon,
  onClick,
  ativo
}: SummaryCardProps) {
  const interativo = typeof onClick === "function";
  const filtravel = interativo && typeof ativo === "boolean";
  const selecionado = filtravel && ativo === true;

  return (
    <article
      className={cn(
        "rounded-2xl p-5 shadow-sm transition hover:shadow-md",
        interativo && "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
        selecionado && cn("border shadow-md", toneStylesAtivo[tone])
      )}
      style={
        selecionado
          ? undefined
          : {
              background: "var(--card)",
              border: "1px solid var(--border)"
            }
      }
      role={interativo ? "button" : undefined}
      aria-pressed={filtravel ? ativo : undefined}
      tabIndex={interativo ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interativo
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p
            className="text-sm font-medium"
            style={{ color: "var(--muted)" }}
          >
            {title}
          </p>
          <strong
            className="mt-2 block text-2xl font-bold tracking-tight"
            style={{ color: "var(--foreground)" }}
          >
            {value}
          </strong>
        </div>
        {Icon ? (
          <span
            className={cn(
              "rounded-2xl p-3 ring-1",
              selecionado
                ? toneStylesAtivoIcone[tone]
                : cn(toneStyles[tone], toneStylesDark[tone])
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
      </div>
      <div
        className="mt-4 text-sm leading-6"
        style={{ color: "var(--muted)" }}
      >
        {description}
      </div>
      {trend ? (
        <span
          className={cn(
            "mt-4 inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1",
            toneStyles[trendTone ?? tone],
            toneStylesDark[trendTone ?? tone]
          )}
        >
          {trend}
        </span>
      ) : null}
    </article>
  );
}
