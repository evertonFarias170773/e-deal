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

type DashboardChartsProps = {
  salesByMonth: Array<{ month: string; vendas: number }>;
  receivablesByStatus: Array<{ status: string; valor: number }>;
  proposalsByStatus: Array<{ status: string; total: number }>;
  salesByCompany: Array<{ empresa: string; vendas: number }>;
};

const chartColors = ["#0f9f9a", "#0b2f4a", "#f28c28", "#ef4444", "#64748b"];

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
  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <ChartCard title="Vendas por mes" description="Evolucao comercial mockada por periodo.">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={salesByMonth} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
            <CartesianGrid stroke="#e7eef0" strokeDasharray="4 4" />
            <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
            <YAxis stroke="#64748b" fontSize={12} tickFormatter={(value) => `${Number(value) / 1000}k`} />
            <Tooltip formatter={(value) => formatCurrency(Number(value))} />
            <Line
              type="monotone"
              dataKey="vendas"
              stroke="#0f9f9a"
              strokeWidth={3}
              dot={{ r: 4, fill: "#0b2f4a" }}
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
                <Cell key={entry.status} fill={chartColors[index % chartColors.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => formatCurrency(Number(value))} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Propostas por status" description="Volume de propostas em cada etapa comercial.">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={proposalsByStatus} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
            <CartesianGrid stroke="#e7eef0" strokeDasharray="4 4" />
            <XAxis dataKey="status" stroke="#64748b" fontSize={12} />
            <YAxis stroke="#64748b" fontSize={12} />
            <Tooltip />
            <Bar dataKey="total" radius={[12, 12, 0, 0]} fill="#0b2f4a" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Vendas por empresa" description="Comparativo gerencial por contexto de empresa.">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={salesByCompany} layout="vertical" margin={{ left: 20, right: 16, top: 10, bottom: 0 }}>
            <CartesianGrid stroke="#e7eef0" strokeDasharray="4 4" />
            <XAxis type="number" stroke="#64748b" fontSize={12} tickFormatter={(value) => `${Number(value) / 1000}k`} />
            <YAxis dataKey="empresa" type="category" stroke="#64748b" fontSize={12} width={64} />
            <Tooltip formatter={(value) => formatCurrency(Number(value))} />
            <Bar dataKey="vendas" radius={[0, 12, 12, 0]} fill="#0f9f9a" />
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
    <article className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {children}
    </article>
  );
}
