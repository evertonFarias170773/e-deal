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
import { useChartTheme } from "@/hooks/useChartTheme";
import { ChartCard, chartTooltipProps } from "@/features/dashboard/components/ChartCard";
import type { DashboardExecutivoPayload } from "@/features/dashboard/types";

type ProducaoSectionProps = {
  prod: DashboardExecutivoPayload["producao"];
};

/**
 * Foto atual da esteira (mesmo universo da tela /producao). Tempo médio de
 * produção e pedidos atrasados ficam fora: não há datas de prazo/conclusão
 * confiáveis no banco — sem dado real, o componente não existe.
 */
export function ProducaoSection({ prod }: ProducaoSectionProps) {
  const t = useChartTheme();
  const tooltip = chartTooltipProps(t);

  const etapasVazia = prod.por_etapa.length === 0;
  const setoresVazio = prod.por_setor.length === 0;
  const alturaEtapas = Math.max(180, prod.por_etapa.length * 44 + 60);
  const alturaSetores = Math.max(180, prod.por_setor.length * 44 + 60);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
        Produção
      </h2>
      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard
          title="OS por etapa"
          description="Pedidos aprovados na esteira agora — foto atual, independe do período."
          href="/producao"
          isEmpty={etapasVazia}
          emptyMessage="Nenhuma OS em produção no momento."
        >
          <ResponsiveContainer width="100%" height={alturaEtapas}>
            <BarChart data={prod.por_etapa} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 0 }}>
              <CartesianGrid stroke={t.grid} strokeDasharray="4 4" horizontal={false} />
              <XAxis type="number" stroke={t.axis} fontSize={12} tickLine={false} allowDecimals={false} />
              <YAxis dataKey="etapa" type="category" stroke={t.axis} fontSize={12} tickLine={false} width={168} />
              <Tooltip {...tooltip} formatter={(value) => [`${value} pedido(s)`, "Quantidade"]} />
              <Bar dataKey="qtd" fill={t.accent} radius={[0, 6, 6, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Modelos por setor"
          description="Modelos dos pedidos em produção, por setor responsável."
          href="/producao"
          isEmpty={setoresVazio}
          emptyMessage="Nenhum modelo em produção no momento."
        >
          <ResponsiveContainer width="100%" height={alturaSetores}>
            <BarChart data={prod.por_setor} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 0 }}>
              <CartesianGrid stroke={t.grid} strokeDasharray="4 4" horizontal={false} />
              <XAxis type="number" stroke={t.axis} fontSize={12} tickLine={false} allowDecimals={false} />
              <YAxis dataKey="setor" type="category" stroke={t.axis} fontSize={12} tickLine={false} width={120} />
              <Tooltip {...tooltip} formatter={(value) => [`${value} modelo(s)`, "Quantidade"]} />
              <Bar dataKey="qtd" fill={t.accentStrong} radius={[0, 6, 6, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </section>
  );
}
