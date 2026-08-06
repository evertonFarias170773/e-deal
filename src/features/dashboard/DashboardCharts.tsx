"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

type DashboardChartsProps = {
  salesByMonth: Array<{ month: string; vendas: number }>;
  receivablesByStatus: Array<{ status: string; valor: number }>;
  proposalsByStatus: Array<{ status: string; total: number }>;
  salesByCompany: Array<{ empresa: string; vendas: number }>;
};

// Recharts pinta SVG com cores inline — CSS externo (tokens/overrides) não
// alcança. O tema entra via JS, observando a classe .dark do <html>
// (mesmo mecanismo do ThemedLogo).
function subscribeTheme(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getThemeSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

const CHART_THEME = {
  light: {
    series: ["#0f9f9a", "#0b2f4a", "#f28c28", "#ef4444", "#64748b"],
    grid: "#e7eef0",
    axis: "#64748b",
    accent: "#0f9f9a",
    accentStrong: "#0b2f4a",
    tooltipBg: "#ffffff",
    tooltipBorder: "#d7e5e8",
    text: "#0d1b2a"
  },
  dark: {
    series: ["#2dbfb0", "#4a9de8", "#f59e0b", "#f87171", "#94a3b8"],
    grid: "#1e3a54",
    axis: "#8ab0cc",
    accent: "#2dbfb0",
    accentStrong: "#4a9de8",
    tooltipBg: "#0f1e2e",
    tooltipBorder: "#1e3a54",
    text: "#ddeaf6"
  }
} as const;

function useChartTheme() {
  const isDark = useSyncExternalStore(subscribeTheme, getThemeSnapshot, () => false);
  return CHART_THEME[isDark ? "dark" : "light"];
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(value);
}

export function DashboardCharts({
  salesByMonth,
  receivablesByStatus,
  proposalsByStatus,
  salesByCompany
}: DashboardChartsProps) {
  const t = useChartTheme();
  const tooltipProps = {
    contentStyle: {
      backgroundColor: t.tooltipBg,
      border: `1px solid ${t.tooltipBorder}`,
      borderRadius: 12,
      color: t.text
    },
    labelStyle: { color: t.text }
  };

  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <ChartCard title="Vendas por mes" description="Evolucao comercial mockada por periodo.">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={salesByMonth} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
            <CartesianGrid stroke={t.grid} strokeDasharray="4 4" />
            <XAxis dataKey="month" stroke={t.axis} fontSize={12} />
            <YAxis stroke={t.axis} fontSize={12} tickFormatter={(value) => `${Number(value) / 1000}k`} />
            <Tooltip {...tooltipProps} formatter={(value) => formatCurrency(Number(value))} />
            <Line
              type="monotone"
              dataKey="vendas"
              stroke={t.accent}
              strokeWidth={3}
              dot={{ r: 4, fill: t.accentStrong }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Contas a receber por status" description="Distribuicao mockada dos recebiveis.">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={receivablesByStatus}
              dataKey="valor"
              nameKey="status"
              cx="50%"
              cy="50%"
              innerRadius={62}
              outerRadius={92}
              paddingAngle={3}
            >
              {receivablesByStatus.map((entry, index) => (
                <Cell key={entry.status} fill={t.series[index % t.series.length]} />
              ))}
            </Pie>
            <Tooltip {...tooltipProps} formatter={(value) => formatCurrency(Number(value))} />
            <Legend wrapperStyle={{ color: t.text }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Propostas por status" description="Volume de propostas em cada etapa comercial.">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={proposalsByStatus} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
            <CartesianGrid stroke={t.grid} strokeDasharray="4 4" />
            <XAxis dataKey="status" stroke={t.axis} fontSize={12} />
            <YAxis stroke={t.axis} fontSize={12} />
            <Tooltip {...tooltipProps} />
            <Bar dataKey="total" radius={[12, 12, 0, 0]} fill={t.accentStrong} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Vendas por empresa" description="Comparativo gerencial por contexto de empresa.">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={salesByCompany} layout="vertical" margin={{ left: 20, right: 16, top: 10, bottom: 0 }}>
            <CartesianGrid stroke={t.grid} strokeDasharray="4 4" />
            <XAxis type="number" stroke={t.axis} fontSize={12} tickFormatter={(value) => `${Number(value) / 1000}k`} />
            <YAxis dataKey="empresa" type="category" stroke={t.axis} fontSize={12} width={64} />
            <Tooltip {...tooltipProps} formatter={(value) => formatCurrency(Number(value))} />
            <Bar dataKey="vendas" radius={[0, 12, 12, 0]} fill={t.accent} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </section>
  );
}

function ChartCard({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">{title}</h2>
        <p className="mt-1 text-sm text-[var(--muted-subtle)]">{description}</p>
      </div>
      {children}
    </article>
  );
}
