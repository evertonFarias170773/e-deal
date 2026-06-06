"use client";

import { useEffect, useState } from "react";
import { getNfseReadOnlyList, type NfseReadResult } from "../services/nfse.service";

export function useNfseReadOnlyData() {
  const [state, setState] = useState<NfseReadResult>({
    source: "supabase",
    nfseList: []
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void (async () => {
      setIsLoading(true);
      const result = await getNfseReadOnlyList();
      if (!active) {
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
      active = false;
    };
  }, []);

  return {
    ...state,
    isLoading,
    loadedCount: state.nfseList.length
  };
}
