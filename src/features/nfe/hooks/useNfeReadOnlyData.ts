"use client";

import { useEffect, useState, useCallback } from "react";
import { getNfeReadOnlyList, type NfeReadResult } from "../services/nfe.service";

export function useNfeReadOnlyData() {
  const [state, setState] = useState<NfeReadResult>({
    source: "supabase",
    nfeList: []
  });
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getNfeReadOnlyList();
      setState(result);
      return result;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      setIsLoading(true);
      const result = await getNfeReadOnlyList();
      if (!active) return;
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
    loadedCount: state.nfeList.length,
    refresh,
    setState
  };
}
