"use client";

import { useEffect, useState } from "react";
import { getProdutosReadOnlyList, type ProdutosReadResult } from "@/features/produtos/services/produtos.service";

export function useProdutosReadOnlyData() {
  const [state, setState] = useState<ProdutosReadResult>({
    source: "mock",
    produtos: [],
    warnings: []
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void (async () => {
      setIsLoading(true);
      const result = await getProdutosReadOnlyList();
      if (!active) {
        return;
      }

      console.log("[Produtos][Hook]", {
        source: result.source,
        registros: result.produtos.length,
        warnings: result.warnings
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
    isLoading,
    loadedCount: state.produtos.length
  };
}
