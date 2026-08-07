"use client";

import Link from "next/link";
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
import { Scale } from "lucide-react";
import { useChartTheme } from "@/hooks/useChartTheme";
import { formatCurrency } from "@/lib/formatters/currency";
import { addDays, type DateRange } from "@/lib/period";
import { ChartCard, chartTooltipProps } from "@/features/dashboard/components/ChartCard";
import type { DashboardExecutivoPayload } from "@/features/dashboard/types";

type FinanceiroSectionProps = {
  fin: DashboardExecutivoPayload["financeiro"];
  range: DateRange;
  companyId: number;
  companyNames: Record<number, string>;
};

function eixoMoedaCompacto(valor: number): string {
  if (Math.abs(valor) >= 1000) return `${Math.round(valor / 1000)}k`;
  return String(valor);
}

/** Preenche dias/meses sem recebimento com zero para a linha não "pular" datas. */
function zeroFillSerie(
  serie: Array<{ ref: string; total: number }>,
  bucket: "dia" | "mes",
  range: DateRange
): Array<{ ref: string; total: number }> {
  const porRef = new Map(serie.map((p) => [p.ref, p.total]));
  const resultado: Array<{ ref: string; total: number }> = [];

  if (bucket === "dia") {
    for (let dia = range.inicio; dia <= range.fim; dia = addDays(dia, 1)) {
      resultado.push({ ref: dia, total: porRef.get(dia) ?? 0 });
    }
    return resultado;
  }

  let mes = range.inicio.slice(0, 7);
  const mesFim = range.fim.slice(0, 7);
  while (mes <= mesFim) {
    resultado.push({ ref: mes, total: porRef.get(mes) ?? 0 });
    const [ano, m] = mes.split("-").map(Number);
    mes = m === 12 ? `${ano + 1}-01` : `${ano}-${String(m + 1).padStart(2, "0")}`;
  }
  return resultado;
}

function rotuloEixo(ref: string, bucket: "dia" | "mes"): string {
  if (bucket === "dia") return `${ref.slice(8, 10)}/${ref.slice(5, 7)}`;
  return `${ref.slice(5, 7)}/${ref.slice(2, 4)}`;
}

export function FinanceiroSection({ fin, range, companyId, companyNames }: FinanceiroSectionProps) {
  const t = useChartTheme();
  const tooltip = chartTooltipProps(t);

  const serie = zeroFillSerie(fin.serie, fin.serie_bucket, range).map((p) => ({
    ...p,
    rotulo: rotuloEixo(p.ref, fin.serie_bucket)
  }));
  const temRecebimento = fin.serie.length > 0;

  const carteira = [
    { name: "Vencidos", valor: fin.carteira.vencido.valor, qtd: fin.carteira.vencido.qtd, cor: t.status.vencido },
    { name: "Vencem hoje", valor: fin.carteira.hoje.valor, qtd: fin.carteira.hoje.qtd, cor: t.status.hoje },
    { name: "A vencer", valor: fin.carteira.a_vencer.valor, qtd: fin.carteira.a_vencer.qtd, cor: t.status.aVencer }
  ];
  const carteiraVazia = fin.carteira.total.qtd === 0;

  const fluxoVazio = fin.fluxo.length === 0;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
        Financeiro
      </h2>
      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard
          title="Recebimentos no período"
          description={
            fin.serie_bucket === "dia"
              ? "Faturamento confirmado por dia."
              : "Faturamento confirmado por mês."
          }
          href="/cobrancas"
          className="xl:col-span-2"
          isEmpty={!temRecebimento}
          emptyMessage="Nenhum recebimento confirmado no período selecionado."
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={serie} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
              <CartesianGrid stroke={t.grid} strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="rotulo" stroke={t.axis} fontSize={12} tickLine={false} minTickGap={24} />
              <YAxis stroke={t.axis} fontSize={12} tickLine={false} tickFormatter={eixoMoedaCompacto} width={44} />
              <Tooltip {...tooltip} formatter={(value) => [formatCurrency(Number(value)), "Recebido"]} />
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

        <ChartCard
          title="Carteira de boletos"
          description="Foto de hoje dos títulos em aberto — independe do período."
          href="/contas-a-receber"
          isEmpty={carteiraVazia}
          emptyMessage="Nenhum boleto em aberto no momento."
        >
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={carteira}
                dataKey="valor"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={62}
                outerRadius={92}
                paddingAngle={3}
              >
                {carteira.map((fatia) => (
                  <Cell key={fatia.name} fill={fatia.cor} />
                ))}
              </Pie>
              <Tooltip
                {...tooltip}
                formatter={(value, name, item) => {
                  const qtd = (item?.payload as { qtd?: number } | undefined)?.qtd ?? 0;
                  return [`${formatCurrency(Number(value))} · ${qtd} título(s)`, name];
                }}
              />
              <Legend wrapperStyle={{ color: t.text }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Fluxo de recebimento"
          description="Boletos em aberto por faixa de vencimento, a partir de hoje."
          href="/contas-a-receber"
          isEmpty={fluxoVazio}
          emptyMessage="Nenhum boleto a vencer daqui em diante."
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={fin.fluxo} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
              <CartesianGrid stroke={t.grid} strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="faixa" stroke={t.axis} fontSize={12} tickLine={false} />
              <YAxis stroke={t.axis} fontSize={12} tickLine={false} tickFormatter={eixoMoedaCompacto} width={44} />
              <Tooltip
                {...tooltip}
                formatter={(value, _name, item) => {
                  const qtd = (item?.payload as { qtd?: number } | undefined)?.qtd ?? 0;
                  return [`${formatCurrency(Number(value))} · ${qtd} boleto(s)`, "A receber"];
                }}
              />
              <Bar dataKey="valor" fill={t.accent} radius={[6, 6, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {companyId === 0 ? (
          <ChartCard
            title="Recebido por empresa"
            description="Faturamento confirmado no período, por contexto de empresa."
            href="/cobrancas"
            isEmpty={fin.por_empresa.length === 0}
            emptyMessage="Nenhum recebimento confirmado no período selecionado."
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={fin.por_empresa.map((linha) => ({
                  ...linha,
                  empresa: companyNames[linha.id_empresa] ?? `Empresa ${linha.id_empresa}`
                }))}
                layout="vertical"
                margin={{ left: 8, right: 16, top: 10, bottom: 0 }}
              >
                <CartesianGrid stroke={t.grid} strokeDasharray="4 4" horizontal={false} />
                <XAxis type="number" stroke={t.axis} fontSize={12} tickLine={false} tickFormatter={eixoMoedaCompacto} />
                <YAxis dataKey="empresa" type="category" stroke={t.axis} fontSize={12} tickLine={false} width={96} />
                <Tooltip
                  {...tooltip}
                  formatter={(value, _name, item) => {
                    const qtd = (item?.payload as { qtd?: number } | undefined)?.qtd ?? 0;
                    return [`${formatCurrency(Number(value))} · ${qtd} pagamento(s)`, "Recebido"];
                  }}
                />
                <Bar dataKey="valor" fill={t.accent} radius={[0, 6, 6, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        ) : null}

        <Link
          href="/conta-corrente"
          className="flex items-center justify-between gap-4 rounded-3xl border p-5 shadow-sm transition hover:shadow-md"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <div>
            <h3 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              Pendências de conta corrente
            </h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted-subtle)" }}>
              Foto atual, todas as empresas (a tabela não segmenta por empresa).
            </p>
            <p className="mt-3 text-2xl font-bold tracking-tight" style={{ color: "var(--foreground)" }}>
              {formatCurrency(fin.pendencias_cc.valor)}
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {fin.pendencias_cc.qtd} pendência(s) em aberto
            </p>
          </div>
          <span
            className="rounded-2xl p-3 ring-1 bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800"
          >
            <Scale className="h-5 w-5" />
          </span>
        </Link>
      </div>
    </section>
  );
}
