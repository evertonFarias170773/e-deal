"use client";

import { useEffect, useMemo, useState } from "react";
import type { Cobranca } from "@/features/cobrancas/types";
import {
  buildDashboardFinanceiroFallbackSnapshot,
  fetchDashboardFinanceiroSnapshot,
  type DashboardFinanceiroSnapshot
} from "@/features/cobrancas/services/dashboard-financeiro.service";

type UseDashboardFinanceiroSnapshotArgs = {
  cobrancasStats: Cobranca[];
  mesSelecionado: string;
};

export function useDashboardFinanceiroSnapshot({ cobrancasStats, mesSelecionado }: UseDashboardFinanceiroSnapshotArgs) {
  const fallbackSnapshot = useMemo(
    () => buildDashboardFinanceiroFallbackSnapshot(cobrancasStats, mesSelecionado),
    [cobrancasStats, mesSelecionado]
  );
  const requestKey = useMemo(
    () => `${mesSelecionado}:${cobrancasStats.map((cobranca) => cobranca.id).join("|")}`,
    [cobrancasStats, mesSelecionado]
  );

  const [remoteSnapshotsByKey, setRemoteSnapshotsByKey] = useState<Record<string, DashboardFinanceiroSnapshot>>({});

  useEffect(() => {
    let active = true;

    void (async () => {
      const remote = await fetchDashboardFinanceiroSnapshot(cobrancasStats, mesSelecionado);
      if (active) {
        setRemoteSnapshotsByKey((current) => {
          if (current[requestKey]) {
            return current;
          }

          return {
            ...current,
            [requestKey]: remote
          };
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [cobrancasStats, mesSelecionado, requestKey]);

  return remoteSnapshotsByKey[requestKey] ?? fallbackSnapshot;
}

