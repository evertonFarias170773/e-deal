"use client";

import { useEffect, useState } from "react";
import type { DateRange } from "@/lib/period";
import {
  fetchMeuDesempenho,
  type MeuDesempenhoResult
} from "@/features/meu-desempenho/services/meu-desempenho.service";

export type MeuDesempenhoState = MeuDesempenhoResult & { isLoading: boolean };

type Carga = MeuDesempenhoResult & { key: string };

/**
 * Uma chamada por mudança de período. `isLoading` derivado da chave da carga
 * (mesmo padrão de useDashboardExecutivo — sem setState síncrono no effect).
 * Sem companyId: a página é consolidada e o vendedor vem do auth.uid() no banco.
 */
export function useMeuDesempenho(range: DateRange, prevRange: DateRange): MeuDesempenhoState {
  const requestKey = `${range.inicio}|${range.fim}|${prevRange.inicio}|${prevRange.fim}`;
  const [carga, setCarga] = useState<Carga | null>(null);

  useEffect(() => {
    let active = true;
    const [inicio, fim, inicioPrev, fimPrev] = requestKey.split("|");

    void fetchMeuDesempenho({ inicio, fim }, { inicio: inicioPrev, fim: fimPrev }).then(
      (resultado) => {
        if (!active) return;
        setCarga({ key: requestKey, ...resultado });
      }
    );

    return () => {
      active = false;
    };
  }, [requestKey]);

  if (!carga || carga.key !== requestKey) {
    return { data: null, error: null, accessDenied: false, isLoading: true };
  }

  return {
    data: carga.data,
    error: carga.error,
    accessDenied: carga.accessDenied,
    isLoading: false
  };
}
