"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters/currency";
import { PERIOD_PRESET_LABELS, formatRangeLabel, type DateRange, type PeriodPreset } from "@/lib/period";
import type { DashboardVendedorPayload } from "@/features/meu-desempenho/types";

type HeroVendedorProps = {
  data: DashboardVendedorPayload;
  preset: PeriodPreset;
  range: DateRange;
  /** Slot do PeriodSelector (controlado pela página). */
  action: ReactNode;
};

function formatPct(valor: number): string {
  return `${valor.toFixed(1).replace(".", ",")}%`;
}

/** Mensagem motivacional derivada SOMENTE dos números reais do período. */
function mensagemDinamica(atual: number, anterior: number): string {
  if (atual === 0) return "Ainda não há faturamento neste período.";
  if (anterior === 0) return "Excelente desempenho neste período!";
  const variacaoPct = ((atual - anterior) / anterior) * 100;
  if (variacaoPct >= 20) return "Excelente desempenho neste período!";
  if (variacaoPct > 0) return "Você superou o período anterior.";
  if (variacaoPct >= -2) return "Mantenha o ritmo de crescimento.";
  return "Siga em frente — ainda dá tempo de alcançar o período anterior.";
}

const chipSubiu =
  "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:ring-teal-800";
const chipCaiu =
  "bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/40 dark:text-red-300 dark:ring-red-800";
const chipNeutro =
  "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700";

/**
 * Hero motivacional do vendedor — assinatura visual da página.
 * Usa apenas dados já retornados pela RPC (nome, valores atual/anterior,
 * participacao_pct); nenhuma consulta ou regra nova.
 */
export function HeroVendedor({ data, preset, range, action }: HeroVendedorProps) {
  const { nome } = data.vendedor;
  const emConsulta = data.modo === "consulta";
  const atual = data.faturamento.proprio.atual.valor;
  const anterior = data.faturamento.proprio.anterior.valor;
  const participacao = data.faturamento.participacao_pct.atual;
  const participacaoAnterior = data.faturamento.participacao_pct.anterior;

  const diferenca = atual - anterior;
  const variacaoPct = anterior > 0 ? (diferenca / Math.abs(anterior)) * 100 : null;
  const subiu = diferenca > 0;

  const deltaParticipacao =
    participacao !== null && participacaoAnterior !== null
      ? Math.round((participacao - participacaoAnterior) * 10) / 10
      : null;

  const textoSuave = { color: "color-mix(in srgb, var(--primary-foreground) 75%, transparent)" };

  return (
    <section
      aria-label="Resumo do meu desempenho"
      className="rounded-2xl p-6 shadow-md md:p-8"
      style={{
        background: "var(--primary)",
        border: "1px solid color-mix(in srgb, var(--primary) 80%, black)"
      }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <span
            className="mb-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
            style={{
              background: "color-mix(in srgb, var(--primary-foreground) 15%, transparent)",
              color: "color-mix(in srgb, var(--primary-foreground) 90%, transparent)"
            }}
          >
            {emConsulta ? "Modo consulta" : "Meu desempenho"} · {PERIOD_PRESET_LABELS[preset]}
          </span>
          <h1
            className="text-2xl font-bold tracking-tight md:text-3xl"
            style={{ color: "var(--primary-foreground)" }}
          >
            {emConsulta ? `Desempenho de ${nome}` : `Olá, ${nome} 👋`}
          </h1>
          <p className="mt-1 text-sm leading-6" style={textoSuave}>
            Seus resultados com dados reais · {formatRangeLabel(range)} · consolidado de todas as
            empresas
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        {/* Faturamento próprio + evolução */}
        <div>
          <p className="text-sm font-medium" style={textoSuave}>
            {emConsulta ? "Faturamento no período" : "Você faturou neste período"}
          </p>
          <p
            className="mt-1 text-4xl font-extrabold tracking-tight md:text-5xl"
            style={{ color: "var(--primary-foreground)" }}
          >
            {formatCurrency(atual)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {variacaoPct !== null ? (
              <>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold ring-1",
                    subiu ? chipSubiu : diferenca < 0 ? chipCaiu : chipNeutro
                  )}
                >
                  {subiu ? "▲" : diferenca < 0 ? "▼" : "="}{" "}
                  {`${diferenca > 0 ? "+" : ""}${variacaoPct.toFixed(1).replace(".", ",")}%`}
                </span>
                <span className="text-sm" style={textoSuave}>
                  ({diferenca >= 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(diferenca))} em relação ao período anterior)
                </span>
              </>
            ) : atual > 0 ? (
              <span className={cn("inline-flex rounded-full px-3 py-1 text-sm font-bold ring-1", chipSubiu)}>
                Sem base de comparação no período anterior
              </span>
            ) : null}
          </div>
          {!emConsulta ? (
            <p
              className="mt-4 text-base font-semibold"
              style={{ color: "color-mix(in srgb, var(--primary-foreground) 92%, transparent)" }}
            >
              {mensagemDinamica(atual, anterior)}
            </p>
          ) : null}
        </div>

        {/* Participação no faturamento total */}
        <div className="lg:pt-1">
          <p className="text-sm font-medium" style={textoSuave}>
            Participação no faturamento da empresa
          </p>
          {participacao !== null ? (
            <>
              <div
                className="mt-3 h-3 w-full overflow-hidden rounded-full"
                role="progressbar"
                aria-valuenow={participacao}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Participação de ${formatPct(participacao)} no faturamento total`}
                style={{ background: "color-mix(in srgb, var(--primary-foreground) 18%, transparent)" }}
              >
                <div
                  className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-out"
                  style={{
                    width: `${Math.min(100, Math.max(participacao > 0 ? 2 : 0, participacao))}%`,
                    background: "linear-gradient(90deg, #2dbfb0, #7ee0d6)"
                  }}
                />
              </div>
              <p className="mt-2 text-2xl font-bold" style={{ color: "var(--primary-foreground)" }}>
                {formatPct(participacao)}
                <span className="ml-2 text-sm font-medium" style={textoSuave}>
                  do faturamento total
                </span>
              </p>
              {deltaParticipacao !== null && deltaParticipacao !== 0 ? (
                <span
                  className={cn(
                    "mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1",
                    deltaParticipacao > 0 ? chipSubiu : chipCaiu
                  )}
                >
                  {deltaParticipacao > 0 ? "▲ +" : "▼ "}
                  {String(deltaParticipacao).replace(".", ",")} p.p. vs período anterior
                </span>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-sm leading-6" style={textoSuave}>
              A empresa ainda não registrou faturamento neste período.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
