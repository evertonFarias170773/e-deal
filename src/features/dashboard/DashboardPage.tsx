"use client";

import { AlertTriangle, Banknote, ClipboardList, Factory, WalletCards } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SummaryCard } from "@/components/common/SummaryCard";
import { useCompany } from "@/features/companies/CompanyProvider";
import { DashboardCharts } from "@/features/dashboard/DashboardCharts";
import { useDashboardMetrics } from "@/features/dashboard/hooks/useDashboardMetrics";
import { dashboardActivity, getDashboardMockData } from "@/lib/mocks/dashboard.mock";
import type { LucideIcon } from "lucide-react";
import type { DashboardCardKey } from "@/features/dashboard/services/dashboard.service";

// Mapa de ícones por card key (mantém a ordem visual dos cards)
const cardIcons: Record<DashboardCardKey, LucideIcon> = {
  vendasMes: Banknote,
  contasReceber: WalletCards,
  propostasAguardando: ClipboardList,
  notasErro: AlertTriangle,
  producao: Factory,
};

type Activity = (typeof dashboardActivity)[number];

export function DashboardPage() {
  const { activeCompany } = useCompany();
  const { cards, isLoading: isCardsLoading } = useDashboardMetrics();

  // Gráficos permanecem com dados mock até a Fase 2 (não alterados)
  const dashboardData = getDashboardMockData(activeCompany.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={`Acompanhe os principais indicadores comerciais, financeiros, fiscais e de producao. Contexto: ${activeCompany.shortName}.`}
        context="Visao operacional"
        action={
          <button
            className="rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-sm transition"
            style={{
              background: "var(--action-save)",
              color: "var(--action-save-fg)"
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--action-save-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--action-save)";
            }}
          >
            Nova proposta
          </button>
        }
      />

      {/* ── Cards de indicadores (dados reais) ─────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {isCardsLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-36 animate-pulse rounded-3xl border border-slate-200 bg-white dark:bg-slate-800/40 dark:border-slate-700"
              />
            ))
          : cards.map((card) => {
              const Icon = cardIcons[card.key];
              return (
                <SummaryCard
                  key={card.key}
                  title={card.title}
                  value={card.value}
                  description={card.description}
                  trend={card.trend}
                  tone={card.tone}
                  icon={Icon}
                />
              );
            })}
      </section>

      {/* ── Gráficos (dados mock – Fase 2) ─────────────────────────────── */}
      <DashboardCharts
        salesByMonth={dashboardData.salesByMonth}
        receivablesByStatus={dashboardData.receivablesByStatus}
        proposalsByStatus={dashboardData.proposalsByStatus}
        salesByCompany={dashboardData.salesByCompany}
      />

      {/* ── Atividades recentes e próximas etapas (mock – Fase 2) ──────── */}
      <section className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>Atividades recentes</h2>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Eventos mockados para validar a leitura operacional do painel.
              </p>
            </div>
          </div>

          <ResponsiveList<Activity>
            items={dashboardActivity}
            getKey={(item) => item.id}
            columns={[
              {
                header: "Ref.",
                cell: (item) => <span className="font-semibold text-slate-950">{item.id}</span>
              },
              {
                header: "Atividade",
                cell: (item) => (
                  <div>
                    <p className="font-medium text-slate-900">{item.title}</p>
                    <p className="text-xs text-slate-500">{item.description}</p>
                  </div>
                )
              },
              {
                header: "Status",
                cell: (item) => <StatusBadge status={item.status} />,
                align: "center"
              },
              {
                header: "Ações",
                cell: () => (
                  <ActionsMenu
                    items={[
                      { label: "Ver detalhes" },
                      { label: "Abrir modulo", disabled: true },
                      { label: "Marcar como revisado" }
                    ]}
                  />
                ),
                align: "right"
              }
            ]}
            renderCard={(item) => (
              <article
                key={item.id}
                className="rounded-2xl p-5 shadow-sm"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)"
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                      {item.id}
                    </p>
                    <h3 className="mt-2 font-semibold" style={{ color: "var(--foreground)" }}>{item.title}</h3>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-3 text-sm leading-6" style={{ color: "var(--muted)" }}>{item.description}</p>
                <div className="mt-4">
                  <ActionsMenu
                    items={[
                      { label: "Ver detalhes" },
                      { label: "Abrir modulo", disabled: true },
                      { label: "Marcar como revisado" }
                    ]}
                  />
                </div>
              </article>
            )}
          />
        </div>

        <aside
          className="rounded-2xl p-5 shadow-sm"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)"
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>Proxima etapa</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>Preparado para os proximos modulos.</p>
            </div>
            <StatusBadge status="RASCUNHO" />
          </div>

          <div className="mt-6 space-y-4">
            {["Cadastros", "Produtos", "Orcamentos"].map((item) => (
              <div
                key={item}
                className="rounded-xl p-4"
                style={{
                  background: "var(--background)",
                  border: "1px solid var(--border)"
                }}
              >
                <p className="font-semibold" style={{ color: "var(--foreground)" }}>{item}</p>
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                  Estrutura reservada no menu para implementar a listagem completa na proxima fase.
                </p>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
