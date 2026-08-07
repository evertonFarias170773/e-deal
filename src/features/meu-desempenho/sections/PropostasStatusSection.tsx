"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { cn } from "@/lib/utils";
import { useChartTheme } from "@/hooks/useChartTheme";
import { formatCurrency } from "@/lib/formatters/currency";
import { ChartCard, chartTooltipProps } from "@/features/dashboard/components/ChartCard";
import { formatTrend } from "@/features/dashboard/utils/trend";
import type { DashboardVendedorPayload } from "@/features/meu-desempenho/types";

type PropostasStatusSectionProps = {
  propostas: DashboardVendedorPayload["propostas"];
};

const chipClasses: Record<string, string> = {
  success: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:ring-teal-800",
  danger: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800",
  info: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800",
  neutral: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  warning: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:ring-orange-800",
  special: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:ring-teal-800"
};

export function PropostasStatusSection({ propostas }: PropostasStatusSectionProps) {
  const t = useChartTheme();
  const { criadas, ganhas, perdidas, por_status: porStatus } = propostas;
  const altura = Math.max(200, porStatus.length * 44 + 60);

  const resumo = [
    { rotulo: "Criadas", par: criadas, trend: formatTrend(criadas.atual.qtd, criadas.anterior.qtd) },
    { rotulo: "Ganhas", par: ganhas, trend: formatTrend(ganhas.atual.qtd, ganhas.anterior.qtd) },
    {
      rotulo: "Perdidas",
      par: perdidas,
      trend: formatTrend(perdidas.atual.qtd, perdidas.anterior.qtd, { invert: true })
    }
  ];

  return (
    <ChartCard
      title="Minhas propostas por status"
      description="Propostas criadas no período, pela situação atual."
      href="/orcamentos"
      isEmpty={porStatus.length === 0}
      emptyMessage="Nenhuma proposta criada no período selecionado."
    >
      <ResponsiveContainer width="100%" height={altura}>
        <BarChart data={porStatus} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 0 }}>
          <CartesianGrid stroke={t.grid} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" stroke={t.axis} fontSize={12} tickLine={false} allowDecimals={false} />
          <YAxis dataKey="status" type="category" stroke={t.axis} fontSize={12} tickLine={false} width={168} />
          <Tooltip
            {...chartTooltipProps(t)}
            formatter={(value, _name, item) => {
              const valor = (item?.payload as { valor?: number } | undefined)?.valor ?? 0;
              return [`${value} proposta(s) · ${formatCurrency(valor)}`, "Quantidade"];
            }}
          />
          <Bar dataKey="qtd" fill={t.accentStrong} radius={[0, 6, 6, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {resumo.map(({ rotulo, par, trend }) => (
          <div
            key={rotulo}
            className="rounded-2xl p-4"
            style={{ background: "var(--background)", border: "1px solid var(--border)" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              {rotulo}
            </p>
            <p className="mt-1 text-xl font-bold" style={{ color: "var(--foreground)" }}>
              {par.atual.qtd}
            </p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {formatCurrency(par.atual.valor)}
            </p>
            {trend ? (
              <span
                className={cn(
                  "mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1",
                  chipClasses[trend.tone]
                )}
              >
                {trend.label.replace(" vs período anterior", "")}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </ChartCard>
  );
}
