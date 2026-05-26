"use client";

import { useEffect, useState } from "react";
import {
  getCadastrosReadOnlyList,
  type CadastrosListQuery,
  type CadastrosReadResult
} from "@/features/cadastros/services/cadastros-read.service";

const initialState: CadastrosReadResult = {
  source: "mock",
  cadastros: [],
  totalCount: 0,
  hasNextPage: false,
  pageIndex: 0,
  pageSize: 200,
  loadedCount: 0,
  warnings: [],
  pedidosResumoByCliente: {}
};

export function useCadastrosReadOnlyData(query: CadastrosListQuery) {
  const [state, setState] = useState<CadastrosReadResult>(initialState);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void (async () => {
      setIsLoading(true);
      const result = await getCadastrosReadOnlyList(query);

      if (!active) {
        return;
      }

      console.log("[Cadastros][Hook]", {
        source: result.source,
        registrosPagina: result.cadastros.length,
        totalCount: result.totalCount,
        pageIndex: result.pageIndex,
        pageSize: result.pageSize
      });

      setState(result);
      setIsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [query]);

  return {
    ...state,
    isLoading
  };
}
