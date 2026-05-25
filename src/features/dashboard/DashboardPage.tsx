"use client";

import { AlertTriangle, Banknote, ClipboardList, Factory, WalletCards } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SummaryCard } from "@/components/common/SummaryCard";
import { useCompany } from "@/features/companies/CompanyProvider";
import { DashboardCharts } from "@/features/dashboard/DashboardCharts";
import { dashboardActivity, getDashboardMockData } from "@/lib/mocks/dashboard.mock";

const metricIcons = [Banknote, WalletCards, ClipboardList, AlertTriangle, Factory];

type Activity = (typeof dashboardActivity)[number];

export function DashboardPage() {
  const { activeCompany } = useCompany();
  const dashboardData = getDashboardMockData(activeCompany.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={`Acompanhe os principais indicadores comerciais, financeiros, fiscais e de producao. Contexto: ${activeCompany.shortName}.`}
        context="Visao operacional"
        action={
          <button className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]">
            Nova proposta
          </button>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {dashboardData.metrics.map((metric, index) => (
          <SummaryCard
            key={metric.title}
            title={metric.title}
            value={metric.value}
            description={metric.description}
            trend={metric.trend}
            tone={metric.tone}
            icon={metricIcons[index]}
          />
        ))}
      </section>

      <DashboardCharts
        salesByMonth={dashboardData.salesByMonth}
        receivablesByStatus={dashboardData.receivablesByStatus}
        proposalsByStatus={dashboardData.proposalsByStatus}
        salesByCompany={dashboardData.salesByCompany}
      />

      <section className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Atividades recentes</h2>
              <p className="text-sm text-slate-500">
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
                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {item.id}
                    </p>
                    <h3 className="mt-2 font-semibold text-slate-950">{item.title}</h3>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-500">{item.description}</p>
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

        <aside className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Proxima etapa</h2>
              <p className="mt-1 text-sm text-slate-500">Preparado para os proximos modulos.</p>
            </div>
            <StatusBadge status="RASCUNHO" />
          </div>

          <div className="mt-6 space-y-4">
            {["Cadastros", "Produtos", "Orcamentos"].map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold text-slate-900">{item}</p>
                <p className="mt-1 text-sm text-slate-500">
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
