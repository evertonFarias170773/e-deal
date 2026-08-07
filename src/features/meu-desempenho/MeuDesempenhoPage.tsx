"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { AccessDenied } from "@/components/common/AccessDenied";
import { PeriodSelector } from "@/components/common/PeriodSelector";
import { useAuth } from "@/features/auth/AuthProvider";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { codecs } from "@/lib/url-state";
import {
  PERIOD_PRESET_VALUES,
  hojeSP,
  previousRange,
  resolveRange,
  type PeriodPreset
} from "@/lib/period";
import { useMeuDesempenho } from "@/features/meu-desempenho/hooks/useMeuDesempenho";
import { HeroVendedor } from "@/features/meu-desempenho/sections/HeroVendedor";
import { KpisVendedorSection } from "@/features/meu-desempenho/sections/KpisVendedorSection";
import { EvolucaoSection } from "@/features/meu-desempenho/sections/EvolucaoSection";
import { PropostasStatusSection } from "@/features/meu-desempenho/sections/PropostasStatusSection";
import { FotosSection } from "@/features/meu-desempenho/sections/FotosSection";
import { UltimosSection } from "@/features/meu-desempenho/sections/UltimosSection";

export function MeuDesempenhoPage() {
  const { user, isLoading: isAuthLoading } = useAuth();

  const hoje = hojeSP();
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

  // Guard de UX: só o perfil vendedor (o legado is_vendedor vira este slug no
  // fallback). A barreira real é a RPC, que rejeita não-vendedores no banco.
  const isVendedor = user?.perfilSlug === "vendedor";

  const { data, error, accessDenied, isLoading } = useMeuDesempenho(range, prevRange);

  if (isAuthLoading) return null;
  if (!isVendedor || accessDenied) {
    return <AccessDenied message="Página exclusiva do perfil vendedor." />;
  }

  const handlePeriodoChange = (valor: { preset: PeriodPreset; ini?: string; fim?: string }) => {
    if (valor.preset === "custom") {
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
      {isLoading ? (
        <>
          <div
            className="h-64 animate-pulse rounded-2xl"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          />
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, indice) => (
              <div
                key={indice}
                className="h-44 animate-pulse rounded-3xl"
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
              Não foi possível carregar seu desempenho
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {error ?? "Erro de consulta."} Recarregue a página ou tente novamente em instantes.
            </p>
          </div>
        </div>
      ) : (
        <>
          <HeroVendedor
            data={data}
            preset={filters.per}
            range={range}
            action={
              <PeriodSelector
                preset={filters.per}
                customIni={filters.ini || range.inicio}
                customFim={filters.fim || range.fim}
                onChange={handlePeriodoChange}
              />
            }
          />
          <KpisVendedorSection data={data} />
          <section className="grid gap-6 xl:grid-cols-2">
            <EvolucaoSection serie={data.serie} bucket={data.serie_bucket} range={range} />
            <PropostasStatusSection propostas={data.propostas} />
          </section>
          <FotosSection fotos={data.fotos} />
          <UltimosSection widgets={data.widgets} />
        </>
      )}
    </div>
  );
}
