"use client";

import { useEffect, useState } from "react";
import { useCompany } from "@/features/companies/CompanyProvider";
import { getDashboardMetrics, type DashboardCardData } from "@/features/dashboard/services/dashboard.service";

export type UseDashboardMetricsResult = {
  cards: DashboardCardData[];
  isLoading: boolean;
  source: "supabase" | "fallback" | null;
  errorMessage?: string;
};

export function useDashboardMetrics(): UseDashboardMetricsResult {
  const { activeCompany } = useCompany();
  const [state, setState] = useState<UseDashboardMetricsResult>({
    cards: buildLoadingCards(),
    isLoading: true,
    source: null,
  });

  useEffect(() => {
    let active = true;

    // Exibe cards de loading enquanto aguarda os dados
    setState({ cards: buildLoadingCards(), isLoading: true, source: null });

    void getDashboardMetrics(activeCompany.id).then((result) => {
      if (!active) return;
      setState({
        cards: result.cards,
        isLoading: false,
        source: result.source,
        errorMessage: result.errorMessage,
      });
    });

    return () => {
      active = false;
    };
  }, [activeCompany.id]);

  return state;
}

/** Cards de loading exibidos enquanto os dados são buscados. */
function buildLoadingCards(): DashboardCardData[] {
  const defs: Array<{ key: DashboardCardData["key"]; title: string; tone: DashboardCardData["tone"] }> = [
    { key: "vendasMes", title: "Vendas do mês", tone: "success" },
    { key: "contasReceber", title: "Contas a receber", tone: "info" },
    { key: "propostasAguardando", title: "Propostas aguardando", tone: "warning" },
    { key: "notasLiberar", title: "Notas a liberar", tone: "neutral" },
    { key: "emProducao", title: "OS em produção", tone: "special" },
  ];

  return defs.map(({ key, title, tone }) => ({
    key,
    title,
    value: "—",
    description: "Carregando...",
    tone,
    isLoading: true,
  }));
}
