"use client";

import { Factory, Hourglass } from "lucide-react";
import { formatCurrency } from "@/lib/formatters/currency";
import type { DashboardVendedorPayload } from "@/features/meu-desempenho/types";

type FotosSectionProps = {
  fotos: DashboardVendedorPayload["fotos"];
};

/**
 * Fotos da situação atual (independem do período selecionado).
 * "Pedidos concluídos" entraria aqui como terceiro card quando existir fonte
 * real de conclusão no banco (status de entrega ou data de término populada).
 */
export function FotosSection({ fotos }: FotosSectionProps) {
  const { aguardando, producao } = fotos;

  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <article
        className="rounded-3xl p-6 shadow-sm"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              Propostas aguardando
            </h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted-subtle)" }}>
              Situação de hoje — independe do período.
            </p>
          </div>
          <span className="rounded-2xl p-3 ring-1 bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:ring-orange-800">
            <Hourglass className="h-5 w-5" />
          </span>
        </div>
        <p className="mt-3 text-3xl font-extrabold tracking-tight" style={{ color: "var(--foreground)" }}>
          {aguardando.qtd}
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {formatCurrency(aguardando.valor)} aguardando retorno ou aprovação
        </p>
      </article>

      <article
        className="rounded-3xl p-6 shadow-sm"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              Pedidos em produção
            </h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted-subtle)" }}>
              Situação de hoje — mesma régua da tela de produção.
            </p>
          </div>
          <span className="rounded-2xl p-3 ring-1 bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:ring-teal-800">
            <Factory className="h-5 w-5" />
          </span>
        </div>
        <p className="mt-3 text-3xl font-extrabold tracking-tight" style={{ color: "var(--foreground)" }}>
          {producao.qtd}
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {formatCurrency(producao.valor)} em pedidos na esteira
        </p>
        {producao.por_etapa.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {producao.por_etapa.map((etapa) => (
              <span
                key={etapa.etapa}
                className="inline-flex rounded-full px-3 py-1 text-xs font-semibold"
                style={{
                  background: "var(--background)",
                  border: "1px solid var(--border)",
                  color: "var(--foreground)"
                }}
              >
                {etapa.etapa} · {etapa.qtd}
              </span>
            ))}
          </div>
        ) : null}
      </article>
    </section>
  );
}
