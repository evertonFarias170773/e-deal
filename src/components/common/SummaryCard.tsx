import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { StatusTone } from "@/lib/types";
import { cn } from "@/lib/utils";

const toneStyles: Record<StatusTone, string> = {
  success: "bg-teal-50 text-teal-700 ring-teal-100",
  info: "bg-sky-50 text-sky-800 ring-sky-100",
  warning: "bg-orange-50 text-orange-700 ring-orange-100",
  danger: "bg-red-50 text-red-700 ring-red-100",
  neutral: "bg-slate-50 text-slate-700 ring-slate-100",
  special: "bg-[#edf7f7] text-[#0b7774] ring-[#caeeeb]"
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
    <article className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <strong className="mt-2 block text-2xl font-bold tracking-tight text-slate-950">
            {value}
          </strong>
        </div>
        {Icon ? (
          <span className={cn("rounded-2xl p-3 ring-1", toneStyles[tone])}>
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
      </div>
      <div className="mt-4 text-sm leading-6 text-slate-500">{description}</div>
      {trend ? (
        <span className={cn("mt-4 inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1", toneStyles[tone])}>
          {trend}
        </span>
      ) : null}
    </article>
  );
}
