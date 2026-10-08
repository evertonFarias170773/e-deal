"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { agruparVinculos, type GrupoVinculado } from "../lib/vinculos-do-painel";

/**
 * Pedidos vinculados dos cards carregados no painel da Expedicao.
 *
 * Leitura a parte, de proposito (mesmo padrao de `usePrevisaoDaProducao`): a
 * consulta que monta o painel (`listarPainelExpedicao`) nao muda. Uma chamada
 * para ate 200 pedidos. A leitura e refeita quando a lista de pedidos e
 * recarregada (a referencia do array muda), para o "pronto" nao ficar velho.
 *
 * Se a leitura falhar, devolve mapa vazio: o card fica como sempre foi, sem erro.
 */
const TAMANHO_DO_LOTE = 200;
const SEM_VINCULOS: Map<number, GrupoVinculado[]> = new Map();

export function useVinculosDoPainel(pedidos: readonly { idInt: number }[]): Map<number, GrupoVinculado[]> {
  const [lido, setLido] = useState<Map<number, GrupoVinculado[]>>(SEM_VINCULOS);

  useEffect(() => {
    let ativo = true;
    const ids = Array.from(new Set(pedidos.map((p) => p.idInt).filter((id) => Number.isFinite(id) && id > 0)));
    // Sem pedido carregado nao ha card para marcar: nada a ler.
    if (ids.length === 0) return;
    void (async () => {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const linhas: unknown[] = [];
        for (let i = 0; i < ids.length; i += TAMANHO_DO_LOTE) {
          const { data, error } = await supabase.rpc("vinculos_dos_pedidos", { p_ids: ids.slice(i, i + TAMANHO_DO_LOTE) });
          if (error) {
            console.warn("[useVinculosDoPainel] Nao foi possivel ler os vinculos:", error.message);
            if (ativo) setLido(SEM_VINCULOS);
            return;
          }
          linhas.push(...((data ?? []) as unknown[]));
        }
        if (ativo) setLido(agruparVinculos(linhas));
      } catch (e) {
        console.warn("[useVinculosDoPainel] Falha na leitura dos vinculos:", e);
        if (ativo) setLido(SEM_VINCULOS);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [pedidos]);

  return lido;
}
