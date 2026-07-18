"use client";

import { useEffect, useState, useCallback } from "react";
import { getPropostaDetailById } from "@/features/orcamentos/services/orcamentos.service";
import type { Proposta } from "@/features/orcamentos/types";

export function useOrcamentoDetail(idInt: number) {
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async (silent = false) => {
    if (!idInt || isNaN(idInt)) {
      if (!silent) setLoading(false);
      setError("ID de proposta inválido.");
      return;
    }

    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await getPropostaDetailById(idInt);
      if (data) {
        setProposta(data);
      }
    } catch (err) {
      console.error("[useOrcamentoDetail] Error fetching proposal detail:", err);
      const msg = err instanceof Error ? err.message : "Erro ao carregar os detalhes do orçamento.";
      setError(msg);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [idInt]);

  useEffect(() => {
    let active = true;

    void (async () => {
      if (!active) return;
      await fetchDetail();
    })();

    return () => {
      active = false;
    };
  }, [fetchDetail]);

  return {
    proposta,
    loading,
    error,
    reload: fetchDetail
  };
}
