"use client";

import { useEffect, useRef, useState } from "react";
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

/**
 * Quantas barras o gráfico desenha. É recorte VISUAL apenas: a classificação
 * A/B/C e os totais por classe vêm de `abc.resumo`, agregado na RPC sobre todos
 * os clientes do período (CTE `classificado`, sem limite) — reduzir este número
 * não muda nenhum total.
 */
const MAX_BARRAS = 6;

/** Teto de caracteres do rótulo do eixo, quando há largura de sobra. */
const MAX_ROTULO = 16;
/** Piso: abaixo disso o rótulo não informa nada — o nome inteiro está no tooltip. */
const MIN_ROTULO = 6;
/**
 * Largura de um caractere a 11px, medida no eixo já renderizado. Nomes de
 * cliente vêm quase sempre em CAIXA ALTA, que é mais larga que a média do
 * alfabeto — usar a média deixava os rótulos se tocando por alguns pixels.
 */
const LARGURA_CARACTERE = 8.5;
/** Espaço tomado pelo eixo Y (width 40) mais folga entre categorias. */
const RESERVA_EIXO_Y = 52;

/**
 * Quantos caracteres cabem por rótulo sem os nomes se encostarem.
 *
 * O card vive em grade de duas colunas no desktop e ocupa a largura toda no
 * mobile, então a largura por categoria varia demais para um corte fixo: 16
 * caracteres cabem folgados em tela cheia e viram um borrão a 420px. Enquanto a
 * medição não chega (primeiro paint, SSR), usa o teto.
 */
function caracteresPorRotulo(larguraDisponivel: number, categorias: number): number {
  if (!larguraDisponivel || categorias <= 0) return MAX_ROTULO;
  const porCategoria = (larguraDisponivel - RESERVA_EIXO_Y) / categorias;
  const cabem = Math.floor(porCategoria / LARGURA_CARACTERE);
  return Math.max(MIN_ROTULO, Math.min(MAX_ROTULO, cabem));
}

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

  // Largura real do gráfico, para dimensionar o rótulo do eixo. 0 até o
  // ResizeObserver responder — nesse intervalo vale o teto de caracteres.
  const areaRef = useRef<HTMLDivElement>(null);
  const [larguraArea, setLarguraArea] = useState(0);

  useEffect(() => {
    const alvo = areaRef.current;
    if (!alvo || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entradas) => {
      const largura = entradas[0]?.contentRect.width ?? 0;
      setLarguraArea((atual) => (Math.abs(atual - largura) > 1 ? largura : atual));
    });
    observer.observe(alvo);
    return () => observer.disconnect();
  }, []);

  // A RPC já entrega ordenado por faturamento decrescente (order by valor desc,
  // cliente). O slice pega os maiores; nada é reordenado aqui.
  const clientes = abc.clientes;
  const visiveis = Math.min(clientes.length, MAX_BARRAS);
  const limiteRotulo = caracteresPorRotulo(larguraArea, visiveis);
  const exibidos = clientes.slice(0, MAX_BARRAS).map((cliente) => ({
    ...cliente,
    rotulo:
      cliente.cliente.length > limiteRotulo
        ? `${cliente.cliente.slice(0, limiteRotulo - 1)}…`
        : cliente.cliente
  }));

  const resumoOrdenado = (["A", "B", "C"] as const).flatMap((classe) => {
    const bloco = abc.resumo[classe];
    return bloco ? [{ classe, ...bloco }] : [];
  });

  // Total real do período: soma das classes, não o tamanho da lista. `clientes`
  // é limitado a 60 pela RPC, então usar o length subnotificaria quando houver
  // mais que isso. Cai para o length se o resumo vier vazio.
  const totalClientes =
    resumoOrdenado.reduce((acc, bloco) => acc + bloco.qtd, 0) || clientes.length;

  return (
    <ChartCard
      title="Curva ABC de clientes"
      description="Concentração do seu faturamento por cliente no período. Clique na barra para abrir o cadastro."
      isEmpty={clientes.length === 0}
      emptyMessage="Nenhum faturamento no período selecionado."
    >
      <div ref={areaRef}>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={exibidos}
          margin={{ left: 0, right: 12, top: 10, bottom: 0 }}
          // Espaço entre categorias: com poucas barras o respiro evita que os
          // rótulos horizontais encostem um no outro.
          barCategoryGap="28%"
          onClick={(state) => {
            const cliente = (state as BarClickState | null)?.activePayload?.[0]?.payload;
            if (cliente?.id_cliente) router.push(`/cadastros/${cliente.id_cliente}`);
          }}
        >
          <CartesianGrid stroke={t.grid} strokeDasharray="4 4" vertical={false} />
          {/* Rótulos na horizontal: com no máximo 6 categorias o nome cabe sem
              inclinar. O nome completo continua no tooltip. */}
          <XAxis
            dataKey="rotulo"
            stroke={t.axis}
            fontSize={11}
            tickLine={false}
            interval={0}
            height={32}
            tickMargin={8}
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
            // O cabeçalho do tooltip usa a categoria do eixo, que é o rótulo
            // truncado. Aqui ele volta a ser o nome inteiro do cliente.
            labelFormatter={(_rotulo, payload) => {
              const dado = payload?.[0]?.payload as AbcCliente | undefined;
              return dado?.cliente ?? _rotulo;
            }}
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
      </div>

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
        {/* O total do período aparece sempre — o recorte do gráfico não pode
            dar a impressão de que só existem esses clientes. */}
        <span className="text-xs" style={{ color: "var(--muted-subtle)" }}>
          {exibidos.length < totalClientes
            ? `Gráfico mostra os ${exibidos.length} maiores de ${totalClientes} clientes.`
            : `${totalClientes} cliente(s) no período.`}
        </span>
      </div>
    </ChartCard>
  );
}
