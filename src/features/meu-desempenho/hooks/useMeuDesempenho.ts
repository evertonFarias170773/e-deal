"use client";

import { useEffect, useState } from "react";
import type { DateRange } from "@/lib/period";
import {
  fetchMeuDesempenho,
  type MeuDesempenhoResult
} from "@/features/meu-desempenho/services/meu-desempenho.service";

export type MeuDesempenhoState = MeuDesempenhoResult & { isLoading: boolean };

type Carga = MeuDesempenhoResult & { key: string };

const SENTINELA_PROPRIO = "@proprio";

/**
 * Uma chamada por mudança de período/vendedor consultado. `isLoading` derivado
 * da chave da carga (mesmo padrão de useDashboardExecutivo).
 *
 * `vendedorConsultado`:
 *  · null  → vendedor autenticado (o banco resolve pelo auth.uid());
 *  · nome  → modo consulta (só surte efeito para perfil administrativo);
 *  · ""    → aguardando seleção (admin com lista ainda carregando) — não busca.
 */
export function useMeuDesempenho(
  range: DateRange,
  prevRange: DateRange,
  vendedorConsultado: string | null
): MeuDesempenhoState {
  const aguardandoSelecao = vendedorConsultado === "";
  const requestKey = `${range.inicio}|${range.fim}|${prevRange.inicio}|${prevRange.fim}|${vendedorConsultado ?? SENTINELA_PROPRIO}`;
  const [carga, setCarga] = useState<Carga | null>(null);

  useEffect(() => {
    if (aguardandoSelecao) return;
    let active = true;

    const [inicio, fim, inicioPrev, fimPrev, vendedor] = requestKey.split("|");

    void fetchMeuDesempenho(
      { inicio, fim },
      { inicio: inicioPrev, fim: fimPrev },
      vendedor === SENTINELA_PROPRIO ? null : vendedor
    ).then((resultado) => {
      if (!active) return;
      setCarga({ key: requestKey, ...resultado });
    });

    return () => {
      active = false;
    };
  }, [requestKey, aguardandoSelecao]);

  if (aguardandoSelecao || !carga || carga.key !== requestKey) {
    return { data: null, error: null, accessDenied: false, isLoading: true };
  }

  return {
    data: carga.data,
    error: carga.error,
    accessDenied: carga.accessDenied,
    isLoading: false
  };
}
