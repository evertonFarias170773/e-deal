"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { mapaDeInstrucoesDeEntrega } from "@/features/pedidos/lib/instrucoes-entrega";

/**
 * Instrucoes de entrega (`propostas.obs_entrega`) dos pedidos carregados no
 * painel da Expedicao.
 *
 * Leitura a parte, de proposito (mesmo padrao de `useVinculosDoPainel`): a
 * consulta que monta o painel (`listarPainelExpedicao`) nao muda. Le so
 * `id_int, obs_entrega`, so dos pedidos carregados e so de quem tem texto —
 * uma chamada para ate 200 pedidos. E refeita quando a lista e recarregada.
 *
 * Se a leitura falhar, devolve mapa vazio: o card fica como sempre foi, sem
 * icone e sem erro na tela.
 */
const TAMANHO_DO_LOTE = 200;
const SEM_INSTRUCOES: Map<number, string> = new Map();

export function useInstrucoesDeEntrega(pedidos: readonly { idInt: number }[]): Map<number, string> {
  const [lido, setLido] = useState<Map<number, string>>(SEM_INSTRUCOES);

  useEffect(() => {
    let ativo = true;
    const ids = Array.from(new Set(pedidos.map((p) => p.idInt).filter((id) => Number.isFinite(id) && id > 0)));
    // Sem pedido carregado nao ha card para marcar: nada a ler.
    if (ids.length === 0) return;
    void (async () => {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const linhas: { id_int?: unknown; obs_entrega?: unknown }[] = [];
        for (let i = 0; i < ids.length; i += TAMANHO_DO_LOTE) {
          const { data, error } = await supabase
            .from("propostas")
            .select("id_int, obs_entrega")
            .in("id_int", ids.slice(i, i + TAMANHO_DO_LOTE))
            .not("obs_entrega", "is", null);
          if (error) {
            console.warn("[useInstrucoesDeEntrega] Nao foi possivel ler as instrucoes de entrega:", error.message);
            if (ativo) setLido(SEM_INSTRUCOES);
            return;
          }
          linhas.push(...((data ?? []) as { id_int?: unknown; obs_entrega?: unknown }[]));
        }
        if (ativo) setLido(mapaDeInstrucoesDeEntrega(linhas));
      } catch (e) {
        console.warn("[useInstrucoesDeEntrega] Falha na leitura das instrucoes de entrega:", e);
        if (ativo) setLido(SEM_INSTRUCOES);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [pedidos]);

  return lido;
}
