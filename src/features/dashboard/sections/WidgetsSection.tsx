"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDateTime } from "@/lib/formatters/date";
import type { ProximoBoleto, UltimoPagamento } from "@/features/dashboard/types";
import type { DashboardExecutivoPayload } from "@/features/dashboard/types";

type WidgetsSectionProps = {
  hoje: string;
  boletos: ProximoBoleto[];
  pagamentos: UltimoPagamento[];
  aprovacoes: DashboardExecutivoPayload["widgets"]["ultimas_aprovacoes"];
  errors: { boletos: string | null; pagamentos: string | null; agregados: string | null };
};

/** Data ISO date-only (YYYY-MM-DD) em dd/mm — sem passar por Date (evita shift de fuso). */
function brDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function WidgetCard({
  title,
  href,
  error,
  isEmpty,
  emptyMessage,
  children
}: {
  title: string;
  href: string;
  error: string | null;
  isEmpty: boolean;
  emptyMessage: string;
  children: ReactNode;
}) {
  return (
    <article
      className="rounded-3xl border p-5 shadow-sm"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
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
      {error ? (
        <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">
          Não foi possível carregar (erro de consulta).
        </p>
      ) : isEmpty ? (
        <p className="py-6 text-center text-sm" style={{ color: "var(--muted)" }}>
          {emptyMessage}
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {children}
        </ul>
      )}
    </article>
  );
}

function LinhaWidget({
  href,
  titulo,
  subtitulo,
  valor,
  detalhe,
  detalheClasse
}: {
  href: string;
  titulo: string;
  subtitulo: string;
  valor: string;
  detalhe: string;
  detalheClasse?: string;
}) {
  return (
    <li style={{ borderColor: "var(--border)" }}>
      <Link href={href} className="flex items-center justify-between gap-3 py-2.5 transition hover:opacity-80">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium" style={{ color: "var(--foreground)" }}>
            {titulo}
          </span>
          <span className="block text-xs" style={{ color: "var(--muted)" }}>
            {subtitulo}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            {valor}
          </span>
          <span
            className={cn("block text-xs", !detalheClasse && "opacity-80")}
            style={detalheClasse ? undefined : { color: "var(--muted)" }}
          >
            <span className={detalheClasse}>{detalhe}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}

export function WidgetsSection({ hoje, boletos, pagamentos, aprovacoes, errors }: WidgetsSectionProps) {
  return (
    <section className="grid gap-6 xl:grid-cols-3">
      <WidgetCard
        title="Próximos boletos a vencer"
        href="/contas-a-receber"
        error={errors.boletos}
        isEmpty={boletos.length === 0}
        emptyMessage="Nenhum boleto em aberto no momento."
      >
        {boletos.map((boleto) => {
          const vencido = boleto.vencimento < hoje;
          const venceHoje = boleto.vencimento === hoje;
          return (
            <LinhaWidget
              key={boleto.id}
              href="/contas-a-receber"
              titulo={boleto.nome_cliente ?? "Sem cliente"}
              subtitulo={
                boleto.parcela && boleto.total_parcelas
                  ? `Parcela ${boleto.parcela}/${boleto.total_parcelas}`
                  : "Parcela única"
              }
              valor={formatCurrency(Number(boleto.valor_atualizado ?? boleto.valor ?? 0))}
              detalhe={
                vencido
                  ? `Vencido em ${brDate(boleto.vencimento)}`
                  : venceHoje
                    ? "Vence hoje"
                    : `Vence em ${brDate(boleto.vencimento)}`
              }
              detalheClasse={
                vencido
                  ? "font-semibold text-red-600 dark:text-red-400"
                  : venceHoje
                    ? "font-semibold text-orange-600 dark:text-orange-400"
                    : undefined
              }
            />
          );
        })}
      </WidgetCard>

      <WidgetCard
        title="Últimos pagamentos recebidos"
        href="/cobrancas"
        error={errors.pagamentos}
        isEmpty={pagamentos.length === 0}
        emptyMessage="Nenhum pagamento confirmado ainda."
      >
        {pagamentos.map((pagamento) => (
          <LinhaWidget
            key={pagamento.id}
            href="/cobrancas"
            titulo={pagamento.cliente ?? "Sem cliente"}
            subtitulo={pagamento.tipo_cobranca ?? "—"}
            valor={formatCurrency(Number(pagamento.valor ?? 0))}
            detalhe={formatDateTime(pagamento.data_confirmacao)}
          />
        ))}
      </WidgetCard>

      <WidgetCard
        title="Últimas propostas aprovadas"
        href="/orcamentos"
        error={errors.agregados}
        isEmpty={aprovacoes.length === 0}
        emptyMessage="Nenhuma aprovação registrada nos últimos 120 dias."
      >
        {aprovacoes.map((aprovacao) => (
          <LinhaWidget
            key={`${aprovacao.id_int}-${aprovacao.aprovado_em}`}
            href={`/orcamentos?q=${aprovacao.id_int}`}
            titulo={aprovacao.cliente}
            subtitulo={`Proposta #${aprovacao.id_int}`}
            valor={formatCurrency(aprovacao.valor)}
            detalhe={formatDateTime(aprovacao.aprovado_em)}
          />
        ))}
      </WidgetCard>
    </section>
  );
}
