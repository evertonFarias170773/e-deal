"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Cobranca, CriarCobrancaFormValues } from "@/features/cobrancas/types";
import { clonePagamentosMock, createCobrancaFromForm } from "@/lib/mocks/pagamentos.mock";
import { canLiberarParaPedido } from "@/features/cobrancas/cobrancas-utils";
import {
  getCobrancasReadOnlyData,
  type CobrancasReadResult,
  type CobrancasReadSource
} from "@/features/cobrancas/services/pagamentos-v2.service";

type CobrancasContextValue = {
  cobrancas: Cobranca[];
  cobrancasStats: Cobranca[];
  source: CobrancasReadSource;
  createCobranca: (values: CriarCobrancaFormValues) => Cobranca;
  confirmPagamento: (id: string) => void;
  cancelCobranca: (id: string, motivo: string) => void;
  liberarParaPedido: (idInt: number) => boolean;
  refreshCobrancas: () => Promise<CobrancasReadResult>;
  getCobrancaById: (id: string) => Cobranca | undefined;
  getCobrancaByToken: (token: string) => Cobranca | undefined;
  getCobrancasByProposta: (idInt: number) => Cobranca[];
};

const STORAGE_KEY = "erp_ideal_mock_cobrancas_v6";
const CobrancasContext = createContext<CobrancasContextValue | null>(null);

function createInitialState() {
  return clonePagamentosMock();
}

function readStoredCobrancas() {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Cobranca[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function CobrancasProvider({ children }: { children: ReactNode }) {
  const [cobrancas, setCobrancas] = useState<Cobranca[]>(createInitialState);
  const [cobrancasStats, setCobrancasStats] = useState<Cobranca[]>(createInitialState);
  const [source, setSource] = useState<CobrancasReadSource>("mock");
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const isMountedRef = useRef(true);

  const loadData = useCallback(async (): Promise<CobrancasReadResult> => {
    const stored = readStoredCobrancas();
    const result = await getCobrancasReadOnlyData();

    if (!isMountedRef.current) {
      return result;
    }

    if (result.warnings.length > 0) {
      console.info("[Cobrancas][Supabase]", result.warnings);
    }

    if (result.source === "supabase") {
      setCobrancas(result.cobrancas);
      setCobrancasStats(result.cobrancasStats);
      setSource("supabase");
    } else if (stored) {
      setCobrancas(stored);
      setCobrancasStats(result.cobrancasStats);
      setSource("mock");
    } else {
      setCobrancas(result.cobrancas.length > 0 ? result.cobrancas : createInitialState());
      setCobrancasStats(result.cobrancasStats.length > 0 ? result.cobrancasStats : createInitialState());
      setSource(result.source);
    }

    setHasLoadedStorage(true);
    return result;
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedStorage || source === "supabase") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cobrancas));
  }, [cobrancas, hasLoadedStorage, source]);

  const createCobranca = useCallback((values: CriarCobrancaFormValues) => {
    const next = createCobrancaFromForm(values);
    if (source === "supabase") {
      return next;
    }

    setCobrancas((current) => [next, ...current]);
    setCobrancasStats((current) => [next, ...current]);
    return next;
  }, [source]);

  const confirmPagamento = useCallback((id: string) => {
    if (source === "supabase") {
      return;
    }

    const updateCob = (list: Cobranca[]): Cobranca[] =>
      list.map((cobranca) => {
        if (cobranca.id !== id) {
          return cobranca;
        }

        const paidAt = new Date().toISOString();

        return {
          ...cobranca,
          status: "PAID",
          paid_at: paidAt,
          confirmado: true,
          confirmado_por: "Operador mockado",
          data_confirmacao: paidAt,
          historico: [
            {
              id: `hist_confirm_${paidAt}`,
              data: paidAt,
              titulo: "Pagamento confirmado no mock",
              descricao: "Status alterado para pago via ação manual.",
              tipo: "success"
            },
            ...cobranca.historico
          ]
        } as Cobranca;
      });

    setCobrancas(updateCob);
    setCobrancasStats(updateCob);
  }, [source]);

  const cancelCobranca = useCallback((id: string, motivo: string) => {
    if (source === "supabase") {
      return;
    }

    const updateCob = (list: Cobranca[]): Cobranca[] =>
      list.map((cobranca) => {
        if (cobranca.id !== id) {
          return cobranca;
        }

        const cancelledAt = new Date().toISOString();

        return {
          ...cobranca,
          status: "CANCELADO",
          motivo_cancela: motivo,
          historico: [
            {
              id: `hist_cancel_${cancelledAt}`,
              data: cancelledAt,
              titulo: "Cobrança cancelada no mock",
              descricao: motivo,
              tipo: "danger"
            },
            ...cobranca.historico
          ]
        } as Cobranca;
      });

    setCobrancas(updateCob);
    setCobrancasStats(updateCob);
  }, [source]);

  const liberarParaPedido = useCallback((idInt: number) => {
    if (source === "supabase") {
      return false;
    }

    const cobrancasDaProposta = cobrancasStats.filter((item) => item.id_int === idInt);

    if (!canLiberarParaPedido(cobrancasDaProposta)) {
      return false;
    }

    const liberadoAt = new Date().toISOString();

    const updateCob = (list: Cobranca[]): Cobranca[] =>
      list.map((cobranca) => {
        if (cobranca.id_int !== idInt) {
          return cobranca;
        }

        return {
          ...cobranca,
          pedidoLiberadoMock: true,
          historico: [
            {
              id: `hist_liberacao_${cobranca.id}_${liberadoAt}`,
              data: liberadoAt,
              titulo: "Proposta liberada para pedido no mock",
              descricao: "Financeiro conferiu os pagamentos válidos e liberou a proposta para virar pedido.",
              tipo: "success"
            },
            ...cobranca.historico
          ]
        } as Cobranca;
      });

    setCobrancas(updateCob);
    setCobrancasStats(updateCob);

    return true;
  }, [cobrancasStats, source]);

  const refreshCobrancas = useCallback(async () => {
    return loadData();
  }, [loadData]);

  const value = useMemo<CobrancasContextValue>(
    () => ({
      cobrancas,
      cobrancasStats,
      source,
      createCobranca,
      confirmPagamento,
      cancelCobranca,
      liberarParaPedido,
      refreshCobrancas,
      getCobrancaById: (id: string) => cobrancas.find((item) => item.id === id) ?? cobrancasStats.find((item) => item.id === id),
      getCobrancaByToken: (token: string) =>
        cobrancas.find((item) => item.token_publico === token) ?? cobrancasStats.find((item) => item.token_publico === token),
      getCobrancasByProposta: (idInt: number) => cobrancasStats.filter((item) => item.id_int === idInt)
    }),
    [cobrancas, cobrancasStats, source, cancelCobranca, confirmPagamento, createCobranca, liberarParaPedido, refreshCobrancas]
  );

  return <CobrancasContext.Provider value={value}>{children}</CobrancasContext.Provider>;
}

export function useCobrancas() {
  const context = useContext(CobrancasContext);

  if (!context) {
    throw new Error("useCobrancas deve ser usado dentro de CobrancasProvider.");
  }

  return context;
}
