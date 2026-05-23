"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Cobranca, CriarCobrancaFormValues } from "@/features/cobrancas/types";
import { clonePagamentosMock, createCobrancaFromForm } from "@/lib/mocks/pagamentos.mock";
import { canLiberarParaPedido } from "@/features/cobrancas/cobrancas-utils";

type CobrancasContextValue = {
  cobrancas: Cobranca[];
  createCobranca: (values: CriarCobrancaFormValues) => Cobranca;
  confirmPagamento: (id: string) => void;
  cancelCobranca: (id: string, motivo: string) => void;
  liberarParaPedido: (idInt: number) => boolean;
  getCobrancaById: (id: string) => Cobranca | undefined;
  getCobrancaByToken: (token: string) => Cobranca | undefined;
  getCobrancasByProposta: (idInt: number) => Cobranca[];
};

const STORAGE_KEY = "erp_ideal_mock_cobrancas_v5";
const CobrancasContext = createContext<CobrancasContextValue | null>(null);

function createInitialState() {
  return clonePagamentosMock();
}

export function CobrancasProvider({ children }: { children: ReactNode }) {
  const [cobrancas, setCobrancas] = useState<Cobranca[]>(createInitialState);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      setHasLoadedStorage(true);
      return;
    }

    try {
      setCobrancas(JSON.parse(stored) as Cobranca[]);
    } catch {
      setCobrancas(createInitialState());
    } finally {
      setHasLoadedStorage(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedStorage) {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cobrancas));
  }, [cobrancas, hasLoadedStorage]);

  function createCobranca(values: CriarCobrancaFormValues) {
    const next = createCobrancaFromForm(values);
    setCobrancas((current) => [next, ...current]);
    return next;
  }

  function confirmPagamento(id: string) {
    setCobrancas((current) =>
      current.map((cobranca) => {
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
        };
      })
    );
  }

  function cancelCobranca(id: string, motivo: string) {
    setCobrancas((current) =>
      current.map((cobranca) => {
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
        };
      })
    );
  }

  function liberarParaPedido(idInt: number) {
    const cobrancasDaProposta = cobrancas.filter((item) => item.id_int === idInt);

    if (!canLiberarParaPedido(cobrancasDaProposta)) {
      return false;
    }

    const liberadoAt = new Date().toISOString();

    setCobrancas((current) =>
      current.map((cobranca) => {
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
        };
      })
    );

    return true;
  }

  const value = useMemo<CobrancasContextValue>(
    () => ({
      cobrancas,
      createCobranca,
      confirmPagamento,
      cancelCobranca,
      liberarParaPedido,
      getCobrancaById: (id: string) => cobrancas.find((item) => item.id === id),
      getCobrancaByToken: (token: string) => cobrancas.find((item) => item.token_publico === token),
      getCobrancasByProposta: (idInt: number) => cobrancas.filter((item) => item.id_int === idInt)
    }),
    [cobrancas]
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
