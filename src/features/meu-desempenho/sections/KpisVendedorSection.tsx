"use client";

import { Banknote, PackageCheck, Percent, ReceiptText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { StatusTone } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatTrend, formatTrendPontos, taxaConversao, type TrendChip } from "@/features/dashboard/utils/trend";
import type { DashboardVendedorPayload } from "@/features/meu-desempenho/types";

const toneStyles: Record<StatusTone, string> = {
  success: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:ring-teal-800",
  info:    "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800",
  warning: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:ring-orange-800",
  danger:  "bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800",
  neutral: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  special: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:ring-teal-800"
};

type KpiGrandeProps = {
  title: string;
  value: string;
  description: string;
  tone: StatusTone;
  icon: LucideIcon;
  trend?: TrendChip;
};

/** Card de KPI em destaque: maior que o SummaryCard, com hover discreto. */
function KpiGrandeCard({ title, value, description, tone, icon: Icon, trend }: KpiGrandeProps) {
  return (
    <article
      className="rounded-3xl p-6 shadow-sm transition motion-safe:duration-200 hover:shadow-lg motion-safe:hover:-translate-y-0.5"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          {title}
        </p>
        <span className={cn("rounded-2xl p-3 ring-1", toneStyles[tone])}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p
        className="mt-3 text-3xl font-extrabold tracking-tight"
        style={{ color: "var(--foreground)" }}
      >
        {value}
      </p>
      <p className="mt-2 text-sm leading-6" style={{ color: "var(--muted)" }}>
        {description}
      </p>
      {trend ? (
        <span
          className={cn(
            "mt-4 inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1",
            toneStyles[trend.tone]
          )}
        >
          {trend.label}
        </span>
      ) : null}
    </article>
  );
}

export function KpisVendedorSection({ data }: { data: DashboardVendedorPayload }) {
  const fat = data.faturamento.proprio;
  const { criadas, ganhas } = data.propostas;

  const ticketAtual = fat.atual.pedidos > 0 ? fat.atual.valor / fat.atual.pedidos : null;
  const ticketAnterior = fat.anterior.pedidos > 0 ? fat.anterior.valor / fat.anterior.pedidos : null;

  const conversaoAtual = taxaConversao(ganhas.atual.qtd, criadas.atual.qtd);
  const conversaoAnterior = taxaConversao(ganhas.anterior.qtd, criadas.anterior.qtd);

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiGrandeCard
        title="Faturamento"
        value={formatCurrency(fat.atual.valor)}
        description="Pagamentos confirmados das suas propostas"
        tone="success"
        icon={Banknote}
        trend={formatTrend(fat.atual.valor, fat.anterior.valor)}
      />
      <KpiGrandeCard
        title="Pedidos faturados"
        value={String(fat.atual.pedidos)}
        description="Propostas suas com pagamento confirmado"
        tone="info"
        icon={PackageCheck}
        trend={formatTrend(fat.atual.pedidos, fat.anterior.pedidos)}
      />
      <KpiGrandeCard
        title="Ticket médio"
        value={ticketAtual === null ? "—" : formatCurrency(ticketAtual)}
        description={
          ticketAtual === null ? "Sem pedidos faturados no período" : "Faturamento ÷ pedidos do período"
        }
        tone="special"
        icon={ReceiptText}
        trend={
          ticketAtual !== null && ticketAnterior !== null
            ? formatTrend(ticketAtual, ticketAnterior)
            : undefined
        }
      />
      <KpiGrandeCard
        title="Conversão"
        value={conversaoAtual === null ? "—" : `${conversaoAtual.toFixed(1).replace(".", ",")}%`}
        description={
          conversaoAtual === null
            ? "Sem propostas criadas no período"
            : `${ganhas.atual.qtd} de ${criadas.atual.qtd} propostas ganhas`
        }
        tone="warning"
        icon={Percent}
        trend={
          conversaoAtual !== null && conversaoAnterior !== null
            ? formatTrendPontos(conversaoAtual, conversaoAnterior)
            : undefined
        }
      />
    </section>
  );
}
