"use client";

import { useRouter } from "next/navigation";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { cn } from "@/lib/utils";
import { useChartTheme } from "@/hooks/useChartTheme";
import { formatCurrency } from "@/lib/formatters/currency";
import { ChartCard, chartTooltipProps } from "@/features/dashboard/components/ChartCard";
import type { AbcCliente, ClasseAbc, DashboardVendedorPayload } from "@/features/meu-desempenho/types";

type AbcClientesSectionProps = {
  abc: DashboardVendedorPayload["abc"];
};

const MAX_BARRAS = 12;

const chipClasse: Record<ClasseAbc, string> = {
  A: "bg-teal-50 text-teal-800 ring-teal-300 dark:bg-teal-900/40 dark:text-teal-200 dark:ring-teal-700",
  B: "bg-teal-50/70 text-teal-700 ring-teal-200 dark:bg-teal-900/25 dark:text-teal-300 dark:ring-teal-800",
  C: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
};

type BarClickState = { activePayload?: Array<{ payload?: AbcCliente }> };

/**
 * Curva ABC dos clientes do vendedor no período (faturamento oficial).
 * Pareto em escala única de %: barras = participação individual,
 * linha = participação acumulada. Cores = rampa ordinal validada (A>B>C).
 */
export function AbcClientesSection({ abc }: AbcClientesSectionProps) {
  const t = useChartTheme();
  const router = useRouter();

  const clientes = abc.clientes;
  const exibidos = clientes.slice(0, MAX_BARRAS).map((cliente) => ({
    ...cliente,
    rotulo:
      cliente.cliente.length > 14 ? `${cliente.cliente.slice(0, 13)}…` : cliente.cliente
  }));

  const resumoOrdenado = (["A", "B", "C"] as const).flatMap((classe) => {
    const bloco = abc.resumo[classe];
    return bloco ? [{ classe, ...bloco }] : [];
  });

  return (
    <ChartCard
      title="Curva ABC de clientes"
      description="Concentração do seu faturamento por cliente no período. Clique na barra para abrir o cadastro."
      isEmpty={clientes.length === 0}
      emptyMessage="Nenhum faturamento no período selecionado."
    >
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={exibidos}
          margin={{ left: 0, right: 12, top: 10, bottom: 0 }}
          onClick={(state) => {
            const cliente = (state as BarClickState | null)?.activePayload?.[0]?.payload;
            if (cliente?.id_cliente) router.push(`/cadastros/${cliente.id_cliente}`);
          }}
        >
          <CartesianGrid stroke={t.grid} strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey="rotulo"
            stroke={t.axis}
            fontSize={11}
            tickLine={false}
            interval={0}
            angle={-30}
            height={64}
            textAnchor="end"
          />
          <YAxis
            stroke={t.axis}
            fontSize={12}
            tickLine={false}
            width={40}
            domain={[0, 100]}
            tickFormatter={(valor) => `${valor}%`}
          />
          <Tooltip
            {...chartTooltipProps(t)}
            formatter={(value, name, item) => {
              const dado = item?.payload as AbcCliente | undefined;
              if (name === "Acumulado") return [`${value}%`, "Acumulado"];
              return [
                `${formatCurrency(dado?.valor ?? 0)} · ${dado?.pedidos ?? 0} pedido(s) · classe ${dado?.classe ?? "?"}`,
                dado?.cliente ?? "Cliente"
              ];
            }}
          />
          <Bar dataKey="pct" name="Participação" radius={[6, 6, 0, 0]} maxBarSize={40} cursor="pointer">
            {exibidos.map((cliente) => (
              <Cell key={`${cliente.cliente}-${cliente.id_cliente ?? "s"}`} fill={t.abc[cliente.classe]} />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="pct_acum"
            name="Acumulado"
            stroke={t.accentStrong}
            strokeWidth={2}
            dot={{ r: 3, fill: t.accentStrong }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {resumoOrdenado.map(({ classe, qtd, valor, pct }) => (
          <span
            key={classe}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1",
              chipClasse[classe]
            )}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: t.abc[classe] }}
              aria-hidden
            />
            Classe {classe}: {qtd} cliente(s) · {formatCurrency(valor)} · {String(pct).replace(".", ",")}%
          </span>
        ))}
        {clientes.length > MAX_BARRAS ? (
          <span className="text-xs" style={{ color: "var(--muted-subtle)" }}>
            Gráfico mostra os {MAX_BARRAS} maiores de {clientes.length} clientes.
          </span>
        ) : null}
      </div>
    </ChartCard>
  );
}
