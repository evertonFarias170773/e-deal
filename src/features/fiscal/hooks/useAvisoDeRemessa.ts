"use client";

import { useEffect, useState } from "react";
import { lerAvisosDeRemessa } from "@/features/fiscal/services/aviso-remessa.service";
import type { AvisoDeRemessa, LeituraDosAvisosDeRemessa } from "@/features/fiscal/lib/aviso-remessa";

/**
 * O aviso de nota de remessa dos pedidos carregados na Fila, lido em lote.
 *
 * Mesmo esqueleto de `usePrevisaoDaProducao`: a lista de ids vira uma chave de
 * texto (é ela que estabiliza o efeito), e a leitura guarda para quais pedidos
 * vale. `pronta` é `false` enquanto carrega e se a leitura falhar — aí nenhum
 * selo aparece, sem erro.
 */
const SEM_AVISOS: Map<number, AvisoDeRemessa> = new Map();

export function useAvisoDeRemessa(idsInt: readonly number[]): LeituraDosAvisosDeRemessa {
  const [lido, setLido] = useState<{ chave: string; porPedido: Map<number, AvisoDeRemessa> }>({ chave: "", porPedido: SEM_AVISOS });
  const chave = Array.from(new Set(idsInt.filter((id) => Number.isFinite(id) && id > 0))).sort((a, b) => a - b).join(",");

  useEffect(() => {
    let ativo = true;
    if (!chave) return;
    void (async () => {
      let porPedido: Map<number, AvisoDeRemessa> | null = null;
      try {
        porPedido = await lerAvisosDeRemessa(chave.split(",").map(Number));
      } catch (erro) {
        console.warn("[useAvisoDeRemessa] Falha ao ler o aviso de remessa:", erro);
      }
      // Leitura que falhou não vira estado: `pronta` segue falsa e o selo não aparece.
      if (ativo && porPedido) setLido({ chave, porPedido });
    })();
    return () => {
      ativo = false;
    };
  }, [chave]);

  if (!chave) return { porPedido: SEM_AVISOS, pronta: true };
  if (lido.chave !== chave) return { porPedido: SEM_AVISOS, pronta: false };
  return { porPedido: lido.porPedido, pronta: true };
}
