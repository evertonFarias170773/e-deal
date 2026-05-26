"use client";

import { useEffect, useState } from "react";
import {
  getCadastrosDashboardResumo,
  type CadastrosDashboardResumo
} from "@/features/cadastros/services/cadastros-read.service";

const initialState: CadastrosDashboardResumo = {
  source: "mock",
  activeCount: 0,
  topClientes: [],
  topCidades: [],
  aniversariantesMock: [],
  warnings: []
};

export function useCadastrosDashboardResumo() {
  const [state, setState] = useState<CadastrosDashboardResumo>(initialState);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void (async () => {
      setIsLoading(true);
      const result = await getCadastrosDashboardResumo();

      if (!active) {
        return;
      }

      console.log("[Cadastros][Resumo]", {
        source: result.source,
        activeCount: result.activeCount,
        topClientes: result.topClientes.length,
        topCidades: result.topCidades.length
      });

      setState(result);
      setIsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  return {
    ...state,
    isLoading
  };
}
