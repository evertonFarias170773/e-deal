"use client";

import { useCallback, useEffect, useState } from "react";
import { getProdutosReadOnlyList, type ProdutosReadResult } from "@/features/produtos/services/produtos.service";

export function useProdutosReadOnlyData() {
  const [state, setState] = useState<ProdutosReadResult>({
    source: "supabase",
    produtos: [],
    resumo: {
      ativos: 0,
      comVariacoes: 0,
      estoque: 0,
      comFotos: 0
    },
    categorias: [],
    warnings: []
  });
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Recarrega a lista do Supabase. Existe desde 21/08/2026, quando "Inativar
   * produto" deixou de ser mock: sem isto, o produto continuaria aparecendo
   * como ATIVO na tela ate alguem recarregar a pagina — o que faria a acao
   * real PARECER que nao funcionou, trocando um mock por uma mentira pior.
   */
  const reload = useCallback(async () => {
    const result = await getProdutosReadOnlyList();
    setState(result);
    return result;
  }, []);

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
    reload,
    loadedCount: state.produtos.length
  };
}
