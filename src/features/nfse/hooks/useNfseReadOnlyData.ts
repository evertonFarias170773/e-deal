"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getNfseReadOnlyList, type NfseReadResult } from "../services/nfse.service";

export function useNfseReadOnlyData() {
  const [state, setState] = useState<NfseReadResult>({
    source: "supabase",
    nfseList: []
  });
  const [isLoading, setIsLoading] = useState(true);
  /**
   * Numero da leitura mais recente. Leituras sobrepostas (abrir a pagina,
   * trocar de aba, nota concluida) podem voltar fora de ordem: so a ultima
   * pedida vale, para uma resposta antiga nao tapar a nova.
   */
  const ultimaLeitura = useRef(0);

  /**
   * Rele o Historico NFS-e. Sem isto a lista ficava a da abertura da pagina e
   * a nota emitida pela Fila so aparecia com F5 (NFS-23733-001, 14/10/2026).
   * `silencioso` mantem a lista na tela enquanto le, sem o estado de carga.
   */
  const refresh = useCallback(async (opcoes?: { silencioso?: boolean }) => {
    const minha = ++ultimaLeitura.current;
    if (!opcoes?.silencioso) setIsLoading(true);
    try {
      const result = await getNfseReadOnlyList();
      if (minha === ultimaLeitura.current) setState(result);
      return result;
    } finally {
      if (minha === ultimaLeitura.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const minha = ++ultimaLeitura.current;

    void (async () => {
      const result = await getNfseReadOnlyList();
      if (minha !== ultimaLeitura.current) {
        return;
      }

      console.log("[Nfse][Hook]", {
        source: result.source,
        count: result.nfseList.length
      });

      setState(result);
      setIsLoading(false);
    })();

    return () => {
      // Desmontou: nenhuma leitura em voo grava mais nada.
      ultimaLeitura.current += 1;
    };
  }, []);

  return {
    ...state,
    isLoading,
    loadedCount: state.nfseList.length,
    refresh
  };
}
