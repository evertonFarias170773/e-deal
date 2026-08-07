"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/common/StatusBadge";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDateTime } from "@/lib/formatters/date";
import type { DashboardVendedorPayload } from "@/features/meu-desempenho/types";

type UltimosSectionProps = {
  widgets: DashboardVendedorPayload["widgets"];
};

function CardLista({
  title,
  href,
  vazio,
  mensagemVazio,
  children
}: {
  title: string;
  href: string;
  vazio: boolean;
  mensagemVazio: string;
  children: React.ReactNode;
}) {
  return (
    <article
      className="rounded-3xl p-5 shadow-sm"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
          {title}
        </h3>
        <Link
          href={href}
          className="shrink-0 text-xs font-semibold hover:underline"
          style={{ color: "var(--secondary)" }}
        >
          Ver todos
        </Link>
      </div>
      {vazio ? (
        <p className="py-6 text-center text-sm" style={{ color: "var(--muted)" }}>
          {mensagemVazio}
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {children}
        </ul>
      )}
    </article>
  );
}

export function UltimosSection({ widgets }: UltimosSectionProps) {
  const { ultimos_pagamentos: pagamentos, ultimas_propostas: propostas } = widgets;

  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <CardLista
        title="Meus últimos pagamentos"
        href="/cobrancas"
        vazio={pagamentos.length === 0}
        mensagemVazio="Nenhum pagamento confirmado ainda."
      >
        {pagamentos.map((pagamento) => (
          <li key={`${pagamento.id_int}-${pagamento.data_confirmacao}`}>
            <Link
              href={`/orcamentos?q=${pagamento.id_int}`}
              className="flex items-center justify-between gap-3 py-2.5 transition hover:opacity-80"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium" style={{ color: "var(--foreground)" }}>
                  {pagamento.cliente}
                </span>
                <span className="block text-xs" style={{ color: "var(--muted)" }}>
                  Proposta #{pagamento.id_int}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                  {formatCurrency(pagamento.valor)}
                </span>
                <span className="block text-xs" style={{ color: "var(--muted)" }}>
                  {formatDateTime(pagamento.data_confirmacao)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </CardLista>

      <CardLista
        title="Minhas últimas propostas"
        href="/orcamentos"
        vazio={propostas.length === 0}
        mensagemVazio="Nenhuma proposta registrada ainda."
      >
        {propostas.map((proposta) => (
          <li key={proposta.id_int}>
            <Link
              href={`/orcamentos?q=${proposta.id_int}`}
              className="flex items-center justify-between gap-3 py-2.5 transition hover:opacity-80"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium" style={{ color: "var(--foreground)" }}>
                  {proposta.cliente}
                </span>
                <span className="mt-0.5 block text-xs" style={{ color: "var(--muted)" }}>
                  #{proposta.id_int} · {formatDateTime(proposta.created_at)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <StatusBadge status={proposta.status} />
                <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                  {formatCurrency(proposta.valor)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </CardLista>
    </section>
  );
}
