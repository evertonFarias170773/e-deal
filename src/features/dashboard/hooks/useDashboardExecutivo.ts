"use client";

import { useEffect, useState } from "react";
import type { DateRange } from "@/lib/period";
import {
  fetchDashboardExecutivo,
  fetchProximosBoletos,
  fetchUltimosPagamentos
} from "@/features/dashboard/services/dashboard.service";
import type {
  DashboardExecutivoPayload,
  ProximoBoleto,
  UltimoPagamento
} from "@/features/dashboard/types";

export type DashboardExecutivoState = {
  data: DashboardExecutivoPayload | null;
  proximosBoletos: ProximoBoleto[];
  ultimosPagamentos: UltimoPagamento[];
  isLoading: boolean;
  errors: {
    agregados: string | null;
    boletos: string | null;
    pagamentos: string | null;
  };
};

type Carga = Omit<DashboardExecutivoState, "isLoading"> & {
  /** Chave (período+empresa) a que esta carga pertence. */
  key: string;
};

/**
 * Carga única do Dashboard executivo: 3 chamadas paralelas (RPC agregada +
 * 2 widgets leves) por mudança de período ou empresa. Nenhum service lança —
 * cada bloco falha isoladamente e a UI decide o que mostrar.
 *
 * `isLoading` é derivado: enquanto a carga guardada não corresponde à chave
 * atual, a tela está carregando (sem setState síncrono no effect).
 */
export function useDashboardExecutivo(
  range: DateRange,
  prevRange: DateRange,
  companyId: number
): DashboardExecutivoState {
  const requestKey = `${range.inicio}|${range.fim}|${prevRange.inicio}|${prevRange.fim}|${companyId}`;
  const [carga, setCarga] = useState<Carga | null>(null);

  useEffect(() => {
    let active = true;

    const [inicio, fim, inicioPrev, fimPrev, empresa] = requestKey.split("|");

    void Promise.all([
      fetchDashboardExecutivo(
        { inicio, fim },
        { inicio: inicioPrev, fim: fimPrev },
        Number(empresa)
      ),
      fetchProximosBoletos(Number(empresa)),
      fetchUltimosPagamentos(Number(empresa))
    ]).then(([agregados, boletos, pagamentos]) => {
      if (!active) return;
      setCarga({
        key: requestKey,
        data: agregados.data,
        proximosBoletos: boletos.data ?? [],
        ultimosPagamentos: pagamentos.data ?? [],
        errors: {
          agregados: agregados.error,
          boletos: boletos.error,
          pagamentos: pagamentos.error
        }
      });
    });

    return () => {
      active = false;
    };
  }, [requestKey]);

  if (!carga || carga.key !== requestKey) {
    return {
      data: null,
      proximosBoletos: [],
      ultimosPagamentos: [],
      isLoading: true,
      errors: { agregados: null, boletos: null, pagamentos: null }
    };
  }

  return {
    data: carga.data,
    proximosBoletos: carga.proximosBoletos,
    ultimosPagamentos: carga.ultimosPagamentos,
    isLoading: false,
    errors: carga.errors
  };
}
