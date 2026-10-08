"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { previsaoPorPedido, type LeituraDasPrevisoes } from "@/features/fiscal/lib/fila-producao-desde";

/**
 * A previsão de entrega da produção dos pedidos carregados na Fila, lida em
 * lote de `propostas_os_setores` — a segunda linha da coluna "Em produção desde".
 *
 * É uma leitura à parte, de propósito, no mesmo padrão das NFS-e
 * (`useNfseDosPedidos`): a consulta que monta a Fila (`getFaturaveisPropostas`)
 * é compartilhada com a NF-e e não muda. Uma consulta para até 200 pedidos.
 *
 * `pronta` é `false` enquanto carrega e se a leitura falhar: a coluna mostra só
 * data e hora, sem erro.
 */
const TAMANHO_DO_LOTE = 200;
const SEM_PREVISOES: Map<number, string> = new Map();

export function usePrevisaoDaProducao(idsInt: readonly number[]): LeituraDasPrevisoes {
  // A leitura guarda PARA QUAIS pedidos ela vale: trocou a lista, deixa de valer.
  const [lido, setLido] = useState<{ chave: string; porPedido: Map<number, string> }>({ chave: "", porPedido: SEM_PREVISOES });
  // A lista de ids vira texto para o efeito não rodar a cada render.
  const chave = Array.from(new Set(idsInt.filter((id) => Number.isFinite(id) && id > 0))).sort((a, b) => a - b).join(",");

  useEffect(() => {
    let ativo = true;
    if (!chave) return;
    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const ids = chave.split(",").map(Number);
      const linhas: { id_int: unknown; prazo: unknown }[] = [];
      for (let i = 0; i < ids.length; i += TAMANHO_DO_LOTE) {
        const { data, error } = await supabase
          .from("propostas_os_setores")
          .select("id_int, prazo")
          .in("id_int", ids.slice(i, i + TAMANHO_DO_LOTE))
          .not("prazo", "is", null)
          .order("created_at", { ascending: true });
        if (error) {
          // Sem a leitura, a coluna fica só com data e hora.
          console.warn("[usePrevisaoDaProducao] Não foi possível ler a previsão da produção:", error.message);
          return;
        }
        linhas.push(...((data ?? []) as { id_int: unknown; prazo: unknown }[]));
      }
      if (ativo) setLido({ chave, porPedido: previsaoPorPedido(linhas) });
    })();
    return () => {
      ativo = false;
    };
  }, [chave]);

  // Sem pedido para olhar não há o que esperar: pronta e vazia.
  if (!chave) return { porPedido: SEM_PREVISOES, pronta: true };
  if (lido.chave !== chave) return { porPedido: SEM_PREVISOES, pronta: false };
  return { porPedido: lido.porPedido, pronta: true };
}
