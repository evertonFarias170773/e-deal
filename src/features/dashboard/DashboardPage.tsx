"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { PeriodSelector } from "@/components/common/PeriodSelector";
import { useCompany } from "@/features/companies/CompanyProvider";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { codecs } from "@/lib/url-state";
import {
  PERIOD_PRESET_LABELS,
  PERIOD_PRESET_VALUES,
  formatRangeLabel,
  hojeSP,
  previousRange,
  resolveRange,
  type PeriodPreset
} from "@/lib/period";
import { useDashboardExecutivo } from "@/features/dashboard/hooks/useDashboardExecutivo";
import { AlertasBanner } from "@/features/dashboard/sections/AlertasBanner";
import { KpiCardsSection } from "@/features/dashboard/sections/KpiCardsSection";
import { FinanceiroSection } from "@/features/dashboard/sections/FinanceiroSection";
import { ComercialSection } from "@/features/dashboard/sections/ComercialSection";
import { ProducaoSection } from "@/features/dashboard/sections/ProducaoSection";
import { FiscalSection } from "@/features/dashboard/sections/FiscalSection";
import { ClientesSection } from "@/features/dashboard/sections/ClientesSection";
import { WidgetsSection } from "@/features/dashboard/sections/WidgetsSection";

export function DashboardPage() {
  const { activeCompany, companies } = useCompany();

  const hoje = hojeSP();

  // Período global na URL (padrão do projeto: useUrlFilters + codecs).
  const filtrosSchema = useMemo(
    () => ({
      per: { codec: codecs.enumOf(PERIOD_PRESET_VALUES), default: "mes" as PeriodPreset },
      ini: { codec: codecs.dataIso(), default: "" },
      fim: { codec: codecs.dataIso(), default: "" }
    }),
    []
  );
  const { filters, setFilters } = useUrlFilters(filtrosSchema);

  const range = useMemo(
    () => resolveRange(filters.per, filters.ini, filters.fim, hoje),
    [filters.per, filters.ini, filters.fim, hoje]
  );
  const prevRange = useMemo(() => previousRange(filters.per, range), [filters.per, range]);

  const { data, proximosBoletos, ultimosPagamentos, isLoading, errors } = useDashboardExecutivo(
    range,
    prevRange,
    activeCompany.id
  );

  const companyNames = useMemo(
    () => Object.fromEntries(companies.map((empresa) => [empresa.id, empresa.shortName])),
    [companies]
  );

  const handlePeriodoChange = (valor: { preset: PeriodPreset; ini?: string; fim?: string }) => {
    if (valor.preset === "custom") {
      // Ao entrar em "Personalizado", pré-carrega o range vigente nos inputs.
      setFilters({
        per: "custom",
        ini: valor.ini ?? (filters.ini || range.inicio),
        fim: valor.fim ?? (filters.fim || range.fim)
      });
      return;
    }
    setFilters({ per: valor.preset, ini: "", fim: "" });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={`Indicadores comerciais, financeiros, fiscais e de produção com dados reais. Contexto: ${activeCompany.shortName} · ${PERIOD_PRESET_LABELS[filters.per]} (${formatRangeLabel(range)}).`}
        context="Painel executivo"
        action={
          <PeriodSelector
            preset={filters.per}
            customIni={filters.ini || range.inicio}
            customFim={filters.fim || range.fim}
            onChange={handlePeriodoChange}
          />
        }
      />

      {isLoading ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, indice) => (
              <div
                key={indice}
                className="h-36 animate-pulse rounded-2xl"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              />
            ))}
          </section>
          <section className="grid gap-6 xl:grid-cols-2">
            {Array.from({ length: 2 }).map((_, indice) => (
              <div
                key={indice}
                className="h-80 animate-pulse rounded-3xl"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              />
            ))}
          </section>
        </>
      ) : !data ? (
        <div
          className="flex items-center gap-4 rounded-3xl border p-6 shadow-sm"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <span className="rounded-2xl p-3 ring-1 bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              Não foi possível carregar os indicadores
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {errors.agregados ?? "Erro de consulta."} Recarregue a página ou tente novamente em
              instantes — nenhum número é exibido para não confundir falha com zero.
            </p>
          </div>
        </div>
      ) : (
        <>
          <AlertasBanner data={data} />
          <KpiCardsSection data={data} range={range} />
          <FinanceiroSection
            fin={data.financeiro}
            range={range}
            companyId={activeCompany.id}
            companyNames={companyNames}
          />
          <ComercialSection com={data.comercial} companyId={activeCompany.id} />
          <ProducaoSection prod={data.producao} />
          <FiscalSection fiscal={data.fiscal} range={range} />
          <ClientesSection cli={data.clientes} range={range} />
        </>
      )}

      {!isLoading ? (
        <WidgetsSection
          hoje={hoje}
          boletos={proximosBoletos}
          pagamentos={ultimosPagamentos}
          aprovacoes={data?.widgets.ultimas_aprovacoes ?? []}
          errors={{
            boletos: errors.boletos,
            pagamentos: errors.pagamentos,
            agregados: errors.agregados
          }}
        />
      ) : null}
    </div>
  );
}
