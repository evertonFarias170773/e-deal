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

  const [snapshot, setSnapshot] = useState<DashboardFinanceiroSnapshot>(fallbackSnapshot);

  useEffect(() => {
    let active = true;
    setSnapshot(fallbackSnapshot);

    void (async () => {
      const remote = await fetchDashboardFinanceiroSnapshot(cobrancasStats, mesSelecionado);
      if (active) {
        setSnapshot(remote);
      }
    })();

    return () => {
      active = false;
    };
  }, [cobrancasStats, fallbackSnapshot, mesSelecionado]);

  return snapshot;
}

