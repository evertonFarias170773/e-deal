"use client";

import { useEffect, useState } from "react";
import { getOrcamentosReadOnlyData, type OrcamentosReadResult } from "@/features/orcamentos/services/orcamentos.service";
import { mapMockPropostaToListItem } from "@/features/orcamentos/mappers";
import { propostasMock } from "@/lib/mocks/propostas.mock";

function buildInitialMockResult(): OrcamentosReadResult {
  return {
    source: "mock",
    propostas: propostasMock.map((proposta) => mapMockPropostaToListItem(proposta)),
    warnings: [],
    detectedColumns: [],
    diagnostics: {
      source: "mock",
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      clientImportPath: "@/lib/supabase/client",
      clientShape: "estado inicial",
      queryExecuted: false,
      registrosRetornados: 0,
      firstRowColumns: [],
      supabaseError: null,
      fallbackReason: "estado inicial mockado",
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
  };
}

export function useOrcamentosReadOnlyData(periodo = "all") {
  const initial = buildInitialMockResult();
  const [state, setState] = useState<OrcamentosReadResult>(initial);
  const [loadedCount, setLoadedCount] = useState(0);

  useEffect(() => {
    let active = true;

    void (async () => {
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
    })();

    return () => {
      active = false;
    };
  }, [periodo]);

  return {
    ...state,
    loadedCount
  } as OrcamentosReadResult & { loadedCount: number };
}

