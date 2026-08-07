"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus, Users } from "lucide-react";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatRangeLabel, type DateRange } from "@/lib/period";
import { formatTrend } from "@/features/dashboard/utils/trend";
import type { DashboardExecutivoPayload } from "@/features/dashboard/types";

type ClientesSectionProps = {
  cli: DashboardExecutivoPayload["clientes"];
  range: DateRange;
};

export function ClientesSection({ cli, range }: ClientesSectionProps) {
  const router = useRouter();
  const rotulo = formatRangeLabel(range);

  const trendNovos = formatTrend(cli.novos.atual, cli.novos.anterior);
  const trendAtivos = formatTrend(cli.ativos.atual, cli.ativos.anterior);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
        Clientes
      </h2>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <SummaryCard
            title="Novos clientes"
            value={String(cli.novos.atual)}
            description={`Cadastrados em ${rotulo} (todas as empresas)`}
            tone="info"
            trend={trendNovos?.label}
            trendTone={trendNovos?.tone}
            icon={UserPlus}
            onClick={() => router.push("/cadastros")}
          />
          <SummaryCard
            title="Clientes ativos"
            value={String(cli.ativos.atual)}
            description="Com proposta ganha no período"
            tone="special"
            trend={trendAtivos?.label}
            trendTone={trendAtivos?.tone}
            icon={Users}
            onClick={() => router.push("/cadastros")}
          />
        </div>

        <article
          className="min-w-0 rounded-3xl border p-5 shadow-sm"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
                Maiores clientes do período
              </h3>
              <p className="mt-1 text-sm" style={{ color: "var(--muted-subtle)" }}>
                Top 5 por valor de propostas ganhas em {rotulo}.
              </p>
            </div>
            <Link
              href="/cadastros"
              className="shrink-0 text-xs font-semibold hover:underline"
              style={{ color: "var(--secondary)" }}
            >
              Abrir módulo
            </Link>
          </div>
          {cli.top.length === 0 ? (
            <div
              className="flex h-48 items-center justify-center rounded-2xl border border-dashed px-6 text-center text-sm"
              style={{ borderColor: "var(--border-strong)", color: "var(--muted)" }}
            >
              Nenhuma proposta ganha no período selecionado.
            </div>
          ) : (
            <ol className="space-y-2">
              {cli.top.map((cliente, indice) => (
                <li key={cliente.id_cliente}>
                  <Link
                    href={`/cadastros/${cliente.id_cliente}`}
                    className="flex items-center gap-3 rounded-2xl p-3 transition hover:shadow-sm"
                    style={{ background: "var(--background)", border: "1px solid var(--border)" }}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                      style={{ background: "var(--card)", color: "var(--secondary)", border: "1px solid var(--border)" }}
                    >
                      {indice + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                        {cliente.cliente}
                      </span>
                      <span className="block text-xs" style={{ color: "var(--muted)" }}>
                        {cliente.qtd} proposta(s) ganha(s)
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-bold" style={{ color: "var(--foreground)" }}>
                      {formatCurrency(cliente.valor)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </article>
      </div>
    </section>
  );
}
