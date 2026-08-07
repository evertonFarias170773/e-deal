"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useChartTheme } from "@/hooks/useChartTheme";
import { formatCurrency } from "@/lib/formatters/currency";
import { addDays, type DateRange } from "@/lib/period";
import { ChartCard, chartTooltipProps } from "@/features/dashboard/components/ChartCard";
import type { DashboardVendedorPayload } from "@/features/meu-desempenho/types";

type EvolucaoSectionProps = {
  serie: DashboardVendedorPayload["serie"];
  bucket: DashboardVendedorPayload["serie_bucket"];
  range: DateRange;
};

function zeroFill(
  serie: Array<{ ref: string; total: number }>,
  bucket: "dia" | "mes",
  range: DateRange
): Array<{ ref: string; total: number; rotulo: string }> {
  const porRef = new Map(serie.map((p) => [p.ref, p.total]));
  const resultado: Array<{ ref: string; total: number; rotulo: string }> = [];

  if (bucket === "dia") {
    for (let dia = range.inicio; dia <= range.fim; dia = addDays(dia, 1)) {
      resultado.push({
        ref: dia,
        total: porRef.get(dia) ?? 0,
        rotulo: `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
      });
    }
    return resultado;
  }

  let mes = range.inicio.slice(0, 7);
  const mesFim = range.fim.slice(0, 7);
  while (mes <= mesFim) {
    resultado.push({
      ref: mes,
      total: porRef.get(mes) ?? 0,
      rotulo: `${mes.slice(5, 7)}/${mes.slice(2, 4)}`
    });
    const [ano, m] = mes.split("-").map(Number);
    mes = m === 12 ? `${ano + 1}-01` : `${ano}-${String(m + 1).padStart(2, "0")}`;
  }
  return resultado;
}

export function EvolucaoSection({ serie, bucket, range }: EvolucaoSectionProps) {
  const t = useChartTheme();
  const dados = zeroFill(serie, bucket, range);

  return (
    <ChartCard
      title="Evolução do meu faturamento"
      description={bucket === "dia" ? "Pagamentos confirmados por dia." : "Pagamentos confirmados por mês."}
      isEmpty={serie.length === 0}
      emptyMessage="Nenhum pagamento confirmado no período selecionado."
    >
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={dados} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
          <CartesianGrid stroke={t.grid} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="rotulo" stroke={t.axis} fontSize={12} tickLine={false} minTickGap={24} />
          <YAxis
            stroke={t.axis}
            fontSize={12}
            tickLine={false}
            width={44}
            tickFormatter={(valor) =>
              Math.abs(Number(valor)) >= 1000 ? `${Math.round(Number(valor) / 1000)}k` : String(valor)
            }
          />
          <Tooltip
            {...chartTooltipProps(t)}
            formatter={(value) => [formatCurrency(Number(value)), "Faturado"]}
          />
          <Line
            type="monotone"
            dataKey="total"
            stroke={t.accent}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: t.accentStrong }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
