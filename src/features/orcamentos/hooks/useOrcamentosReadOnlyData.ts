"use client";

import { useEffect, useRef, useState } from "react";
import {
  getOrcamentosReadOnlyData,
  type OrcamentosReadResult,
  type OrcamentosReadFilters
} from "@/features/orcamentos/services/orcamentos.service";


export function useOrcamentosReadOnlyData(
  periodo = "all",
  page = 1,
  pageSize = 200,
  filters?: OrcamentosReadFilters
) {
  const [state, setState] = useState<OrcamentosReadResult>({
    source: "supabase",
    propostas: [],
    warnings: [],
    detectedColumns: [],
    totalCount: 0,
    page: 1,
    pageSize: 200,
    totalPages: 1,
    diagnostics: {
      source: "supabase",
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      clientImportPath: "@/lib/supabase/client",
      clientShape: "inicializando",
      queryExecuted: false,
      registrosRetornados: 0,
      firstRowColumns: [],
      supabaseError: null,
      fallbackReason: null,
      smoke: {
        resultExists: false,
        resultKeys: [],
        dataIsArray: false,
        dataCount: 0,
        firstIdInts: [],
        errorMessage: null,
        status: null,
        statusText: null
      }
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [loadedCount, setLoadedCount] = useState(0);
  const [refreshCount, setRefreshCount] = useState(0);

  const requestIdRef = useRef(0);

  const triggerRefresh = () => setRefreshCount(c => c + 1);

  const filterKey = JSON.stringify(filters || {});

  useEffect(() => {
    let active = true;
    const currentRequestId = ++requestIdRef.current;

    void (async () => {
      setIsLoading(true);
      const result = await getOrcamentosReadOnlyData(periodo, page, pageSize, filters);

      if (!active || currentRequestId !== requestIdRef.current) {
        return;
      }

      setState(result);
      setLoadedCount(result.propostas.length);
      setIsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [periodo, page, pageSize, filterKey, refreshCount]);

  return {
    ...state,
    isLoading,
    loadedCount,
    triggerRefresh
  } as OrcamentosReadResult & { loadedCount: number; isLoading: boolean; triggerRefresh: () => void };
}


