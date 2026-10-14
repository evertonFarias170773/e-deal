"use client";

import { useEffect, useState, useCallback } from "react";
import { getNfeReadOnlyList, type NfeReadResult } from "../services/nfe.service";

export function useNfeReadOnlyData() {
  const [state, setState] = useState<NfeReadResult>({
    source: "supabase",
    nfeList: []
  });
  const [isLoading, setIsLoading] = useState(true);

  /**
   * `silencioso` (14/10/2026): rele sem o estado de carga, para o Historico se
   * atualizar ao trocar de aba ou ao voltar para a janela sem piscar a lista.
   */
  const refresh = useCallback(async (opcoes?: { silencioso?: boolean }) => {
    if (!opcoes?.silencioso) setIsLoading(true);
    try {
      const result = await getNfeReadOnlyList();
      setState(result);
      return result;
    } finally {
      if (!opcoes?.silencioso) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      setIsLoading(true);
      const result = await getNfeReadOnlyList();
      if (!active) return;
      setState(result);
      setIsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return {
    ...state,
    isLoading,
    loadedCount: state.nfeList.length,
    refresh,
    setState
  };
}
