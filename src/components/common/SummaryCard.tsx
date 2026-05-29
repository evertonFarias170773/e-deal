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

type SummaryCardProps = {
  title: string;
  value: string;
  description: ReactNode;
  tone?: StatusTone;
  trend?: string;
  icon?: LucideIcon;
};

export function SummaryCard({
  title,
  value,
  description,
  tone = "neutral",
  trend,
  icon: Icon
}: SummaryCardProps) {
  return (
    <article
      className="rounded-2xl p-5 shadow-sm transition hover:shadow-md"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)"
      }}
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
              toneStyles[tone],
              toneStylesDark[tone]
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
            toneStyles[tone],
            toneStylesDark[tone]
          )}
        >
          {trend}
        </span>
      ) : null}
    </article>
  );
}
