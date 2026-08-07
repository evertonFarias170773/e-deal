"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ChartTheme } from "@/hooks/useChartTheme";

type ChartCardProps = {
  title: string;
  description?: string;
  /** Drill-down: link para o módulo correspondente. */
  href?: string;
  hrefLabel?: string;
  isEmpty?: boolean;
  emptyMessage?: string;
  className?: string;
  children: ReactNode;
};

/** Card padrão dos gráficos do Dashboard (tokens + dark mode automáticos). */
export function ChartCard({
  title,
  description,
  href,
  hrefLabel = "Abrir módulo",
  isEmpty = false,
  emptyMessage = "Sem dados no período selecionado.",
  className,
  children
}: ChartCardProps) {
  return (
    <article
      className={cn("rounded-3xl border p-5 shadow-sm", className)}
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-sm" style={{ color: "var(--muted-subtle)" }}>
              {description}
            </p>
          ) : null}
        </div>
        {href ? (
          <Link
            href={href}
            className="shrink-0 text-xs font-semibold hover:underline"
            style={{ color: "var(--secondary)" }}
          >
            {hrefLabel}
          </Link>
        ) : null}
      </div>
      {isEmpty ? (
        <div
          className="flex h-64 items-center justify-center rounded-2xl border border-dashed px-6 text-center text-sm"
          style={{ borderColor: "var(--border-strong)", color: "var(--muted)" }}
        >
          {emptyMessage}
        </div>
      ) : (
        children
      )}
    </article>
  );
}

/** Props compartilhadas do Tooltip do Recharts, pareadas com o tema. */
export function chartTooltipProps(t: ChartTheme) {
  return {
    contentStyle: {
      backgroundColor: t.tooltipBg,
      border: `1px solid ${t.tooltipBorder}`,
      borderRadius: 12,
      color: t.text
    },
    labelStyle: { color: t.text }
  };
}
