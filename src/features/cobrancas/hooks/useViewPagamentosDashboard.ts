"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchViewPagamentosPagos,
  calcConfirmadosDia,
  calcFaturamentoPeriodo,
  calcFaturamentoPorEmpresa,
  type ViewPagamentosPagosRow,
  type ViewEmpresaTotal,
} from "@/features/cobrancas/services/view-pagamentos-pagos.service";

export type { ViewEmpresaTotal };

function getTodaySP(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

function getMesRange(mesSelecionado: string): { inicio: string; fim: string } {
  const [y, m] = mesSelecionado.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    inicio: `${mesSelecionado}-01`,
    fim: `${mesSelecionado}-${String(lastDay).padStart(2, "0")}`,
  };
}

export type ViewPagamentosDashboard = {
  isLoading: boolean;
  error: string | null;
  /** SUM(total) e COUNT(*) de registros com data_confirmacao = hoje (America/Sao_Paulo) */
  confirmadosDia: { count: number; total: number };
  /** SUM(total) e COUNT(*) no intervalo dataInicial–dataFinal do seletor manual */
  faturamentoPeriodo: { count: number; total: number };
  faturamentoPorEmpresaPeriodo: ViewEmpresaTotal[];
  /** SUM(total) e COUNT(*) no mês selecionado */
  faturamentoMes: { count: number; total: number };
  faturamentoPorEmpresaMes: ViewEmpresaTotal[];
};

/**
 * Consulta a view_pagamentos_pagos_v2 e devolve os indicadores financeiros
 * para os três cards da Conferência de Pagamentos.
 *
 * Uma única busca cobre todos os cards: janela = min(datas solicitadas) → max(datas solicitadas).
 */
export function useViewPagamentosDashboard(params: {
  dataInicial: string;
  dataFinal: string;
  mesSelecionado: string;
}): ViewPagamentosDashboard {
  const { dataInicial, dataFinal, mesSelecionado } = params;

  // today é computado uma vez por montagem do hook
  const today = useMemo(getTodaySP, []);
  const mesRange = useMemo(() => getMesRange(mesSelecionado), [mesSelecionado]);

  // Janela que cobre período manual + mês selecionado + hoje sem múltiplos fetches
  const fetchInicio = useMemo(
    () => [dataInicial, mesRange.inicio, today].sort()[0],
    [dataInicial, mesRange.inicio, today]
  );
  const fetchFim = useMemo(
    () => [dataFinal, mesRange.fim, today].sort().reverse()[0],
    [dataFinal, mesRange.fim, today]
  );

  const [rows, setRows] = useState<ViewPagamentosPagosRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    void (async () => {
      const result = await fetchViewPagamentosPagos(fetchInicio, fetchFim);
      if (!active) return;

      if (result.error) {
        console.error("[useViewPagamentosDashboard] Erro ao consultar view:", result.error);
        setError(result.error);
      } else {
        setRows(result.rows);
        setError(null);
      }

      setIsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [fetchInicio, fetchFim]);

  const confirmadosDia = useMemo(
    () => calcConfirmadosDia(rows, today),
    [rows, today]
  );

  const faturamentoPeriodo = useMemo(
    () => calcFaturamentoPeriodo(rows, dataInicial, dataFinal),
    [rows, dataInicial, dataFinal]
  );

  const faturamentoPorEmpresaPeriodo = useMemo(
    () => calcFaturamentoPorEmpresa(rows, dataInicial, dataFinal),
    [rows, dataInicial, dataFinal]
  );

  const faturamentoMes = useMemo(
    () => calcFaturamentoPeriodo(rows, mesRange.inicio, mesRange.fim),
    [rows, mesRange.inicio, mesRange.fim]
  );

  const faturamentoPorEmpresaMes = useMemo(
    () => calcFaturamentoPorEmpresa(rows, mesRange.inicio, mesRange.fim),
    [rows, mesRange.inicio, mesRange.fim]
  );

  return {
    isLoading,
    error,
    confirmadosDia,
    faturamentoPeriodo,
    faturamentoPorEmpresaPeriodo,
    faturamentoMes,
    faturamentoPorEmpresaMes,
  };
}
