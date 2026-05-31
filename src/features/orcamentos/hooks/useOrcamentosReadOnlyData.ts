"use client";

import { useEffect, useState } from "react";
import { getOrcamentosReadOnlyData, type OrcamentosReadResult } from "@/features/orcamentos/services/orcamentos.service";


export function useOrcamentosReadOnlyData(periodo = "all") {
  const [state, setState] = useState<OrcamentosReadResult>({
    source: "supabase",
    propostas: [],
    warnings: [],
    detectedColumns: [],
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

  useEffect(() => {
    let active = true;

    void (async () => {
      setIsLoading(true);
      const result = await getOrcamentosReadOnlyData(periodo);
      if (!active) {
        return;
      }

      console.log("[Orcamentos][Hook]", {
        source: result.source,
        registros: result.propostas.length,
        warnings: result.warnings,
        detectedColumns: result.detectedColumns
      });

      setState(result);
      setLoadedCount(result.propostas.length);
      setIsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [periodo]);

  return {
    ...state,
    isLoading,
    loadedCount
  } as OrcamentosReadResult & { loadedCount: number; isLoading: boolean };
}

