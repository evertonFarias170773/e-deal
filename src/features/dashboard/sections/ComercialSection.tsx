"use client";

import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { cn } from "@/lib/utils";
import { useChartTheme } from "@/hooks/useChartTheme";
import { formatCurrency } from "@/lib/formatters/currency";
import { ChartCard, chartTooltipProps } from "@/features/dashboard/components/ChartCard";
import { formatTrend, type TrendChip } from "@/features/dashboard/utils/trend";
import type { DashboardExecutivoPayload } from "@/features/dashboard/types";

type ComercialSectionProps = {
  com: DashboardExecutivoPayload["comercial"];
  companyId: number;
};

const chipClasses: Record<TrendChip["tone"], string> = {
  success: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:ring-teal-800",
  danger: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800",
  info: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800",
  neutral: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  warning: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:ring-orange-800",
  special: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:ring-teal-800"
};

function TrendPill({ chip }: { chip?: TrendChip }) {
  if (!chip) return null;
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1",
        chipClasses[chip.tone]
      )}
    >
      {chip.label}
    </span>
  );
}

type BarClickState = { activePayload?: Array<{ payload?: { status?: string } }> };

/** Rótulos amigáveis para tipo_cobranca (fallback: valor cru do banco). */
const TIPO_COBRANCA_LABELS: Record<string, string> = {
  PIX: "PIX",
  BOLETO: "Boleto",
  CREDIT_CARD: "Cartão de crédito",
  CARD_PARCELADO: "Cartão parcelado",
  "E-FATURADO": "Faturado",
  "E-CREDITO": "Crédito",
  "SEM TIPO": "Sem tipo"
};

export function ComercialSection({ com, companyId }: ComercialSectionProps) {
  const t = useChartTheme();
  const router = useRouter();
  const tooltip = chartTooltipProps(t);

  const porStatus = com.por_status;
  const alturaStatus = Math.max(200, porStatus.length * 44 + 60);

  const aprovadasPorTipo = com.aprovadas_por_tipo.map((linha) => ({
    ...linha,
    rotulo: TIPO_COBRANCA_LABELS[linha.tipo] ?? linha.tipo
  }));
  const alturaTipos = Math.max(140, aprovadasPorTipo.length * 40 + 40);

  const ganhoPerdido = [
    { label: "Ganho", valor: com.ganho.atual.valor, qtd: com.ganho.atual.qtd, cor: t.accent },
    { label: "Perdido", valor: com.perdido.atual.valor, qtd: com.perdido.atual.qtd, cor: t.danger }
  ];
  const trendGanho = formatTrend(com.ganho.atual.valor, com.ganho.anterior.valor);
  const trendPerdido = formatTrend(com.perdido.atual.valor, com.perdido.anterior.valor, {
    invert: true
  });

  const tempoAtual = com.tempo_aprovacao.atual;
  const tempoAnterior = com.tempo_aprovacao.anterior;
  const trendTempo =
    tempoAtual && tempoAnterior
      ? formatTrend(tempoAtual.media_horas, tempoAnterior.media_horas, { invert: true })
      : undefined;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          Comercial
        </h2>
        {companyId !== 0 ? (
          <p className="mt-1 text-xs" style={{ color: "var(--muted-subtle)" }}>
            Recorte por empresa em propostas usa o texto do campo &quot;empresa&quot;; propostas sem
            preenchimento só aparecem em &quot;Todas as empresas&quot;.
          </p>
        ) : null}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <ChartCard
          title="Propostas por status"
          description="Propostas criadas no período, pela situação atual. Clique para abrir filtrado."
          href="/orcamentos"
          isEmpty={porStatus.length === 0}
          emptyMessage="Nenhuma proposta criada no período selecionado."
        >
          <ResponsiveContainer width="100%" height={alturaStatus}>
            <BarChart
              data={porStatus}
              layout="vertical"
              margin={{ left: 8, right: 16, top: 4, bottom: 0 }}
              onClick={(state) => {
                const status = (state as BarClickState | null)?.activePayload?.[0]?.payload?.status;
                if (status && status !== "SEM STATUS") {
                  router.push(`/orcamentos?status=${encodeURIComponent(status)}`);
                }
              }}
            >
              <CartesianGrid stroke={t.grid} strokeDasharray="4 4" horizontal={false} />
              <XAxis type="number" stroke={t.axis} fontSize={12} tickLine={false} allowDecimals={false} />
              <YAxis dataKey="status" type="category" stroke={t.axis} fontSize={12} tickLine={false} width={168} />
              <Tooltip
                {...tooltip}
                formatter={(value, _name, item) => {
                  const valor = (item?.payload as { valor?: number } | undefined)?.valor ?? 0;
                  return [`${value} proposta(s) · ${formatCurrency(valor)}`, "Quantidade"];
                }}
              />
              <Bar dataKey="qtd" fill={t.accentStrong} radius={[0, 6, 6, 0]} maxBarSize={26} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>

          {aprovadasPorTipo.length > 0 ? (
            <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <h4 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                Valores aprovados por tipo de cobrança
              </h4>
              <p className="mt-0.5 text-xs" style={{ color: "var(--muted-subtle)" }}>
                Pagamentos válidos (pagos ou confirmados) das propostas aprovadas do período.
              </p>
              <ResponsiveContainer width="100%" height={alturaTipos}>
                <BarChart
                  data={aprovadasPorTipo}
                  layout="vertical"
                  margin={{ left: 8, right: 16, top: 12, bottom: 0 }}
                >
                  <CartesianGrid stroke={t.grid} strokeDasharray="4 4" horizontal={false} />
                  <XAxis
                    type="number"
                    stroke={t.axis}
                    fontSize={12}
                    tickLine={false}
                    tickFormatter={(valor) =>
                      Math.abs(Number(valor)) >= 1000 ? `${Math.round(Number(valor) / 1000)}k` : String(valor)
                    }
                  />
                  <YAxis dataKey="rotulo" type="category" stroke={t.axis} fontSize={12} tickLine={false} width={128} />
                  <Tooltip
                    {...tooltip}
                    formatter={(value, _name, item) => {
                      const qtd = (item?.payload as { qtd?: number } | undefined)?.qtd ?? 0;
                      return [`${formatCurrency(Number(value))} · ${qtd} cobrança(s)`, "Aprovado"];
                    }}
                  />
                  <Bar dataKey="valor" fill={t.accent} radius={[0, 6, 6, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </ChartCard>

        <div className="space-y-6">
          <ChartCard
            title="Ganho × Perdido"
            description="Valor das propostas criadas no período, por desfecho."
            href="/orcamentos"
            isEmpty={com.criadas.atual.qtd === 0}
            emptyMessage="Nenhuma proposta criada no período selecionado."
          >
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={ganhoPerdido} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
                <CartesianGrid stroke={t.grid} strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="label" stroke={t.axis} fontSize={12} tickLine={false} />
                <YAxis
                  stroke={t.axis}
                  fontSize={12}
                  tickLine={false}
                  width={44}
                  tickFormatter={(valor) => (Math.abs(Number(valor)) >= 1000 ? `${Math.round(Number(valor) / 1000)}k` : String(valor))}
                />
                <Tooltip
                  {...tooltip}
                  formatter={(value, _name, item) => {
                    const qtd = (item?.payload as { qtd?: number } | undefined)?.qtd ?? 0;
                    return [`${formatCurrency(Number(value))} · ${qtd} proposta(s)`, "Valor"];
                  }}
                />
                <Bar dataKey="valor" radius={[6, 6, 0, 0]} maxBarSize={72}>
                  {ganhoPerdido.map((linha) => (
                    <Cell key={linha.label} fill={linha.cor} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 flex flex-wrap gap-2">
              <TrendPill chip={trendGanho ? { ...trendGanho, label: `Ganho ${trendGanho.label}` } : undefined} />
              <TrendPill chip={trendPerdido ? { ...trendPerdido, label: `Perdido ${trendPerdido.label}` } : undefined} />
            </div>
          </ChartCard>

          {tempoAtual ? (
            <ChartCard
              title="Tempo até aprovação"
              description={`${tempoAtual.qtd} aprovação(ões) no período (trilha de auditoria).`}
              href="/orcamentos"
            >
              <div className="grid grid-cols-2 gap-4">
                <div
                  className="rounded-2xl p-4"
                  style={{ background: "var(--background)", border: "1px solid var(--border)" }}
                >
                  <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    Média
                  </p>
                  <p className="mt-1 text-2xl font-bold tracking-tight" style={{ color: "var(--foreground)" }}>
                    {String(tempoAtual.media_horas).replace(".", ",")} h
                  </p>
                </div>
                <div
                  className="rounded-2xl p-4"
                  style={{ background: "var(--background)", border: "1px solid var(--border)" }}
                >
                  <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    Mediana
                  </p>
                  <p className="mt-1 text-2xl font-bold tracking-tight" style={{ color: "var(--foreground)" }}>
                    {String(tempoAtual.mediana_horas).replace(".", ",")} h
                  </p>
                </div>
              </div>
              <div className="mt-3">
                <TrendPill chip={trendTempo ? { ...trendTempo, label: `Média ${trendTempo.label}` } : undefined} />
              </div>
            </ChartCard>
          ) : null}
        </div>
      </div>
    </section>
  );
}
