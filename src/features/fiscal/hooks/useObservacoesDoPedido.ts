"use client";

import { useEffect, useState } from "react";
import { lerObservacoesDosPedidos, type ObservacoesDoPedido } from "@/features/fiscal/services/observacoes-do-pedido.service";

/**
 * As observações dos pedidos carregados (Fila de faturamento, janelas das notas),
 * lidas em lote. Mesmo esqueleto de `useAvisoDeRemessa`: a lista de ids vira uma
 * chave de texto. Enquanto carrega, ou se a leitura falhar, nenhum selo aparece.
 */
const VAZIO: Map<number, ObservacoesDoPedido> = new Map();

export function useObservacoesDoPedido(idsInt: readonly number[]): Map<number, ObservacoesDoPedido> {
  const [lido, setLido] = useState<{ chave: string; porPedido: Map<number, ObservacoesDoPedido> }>({ chave: "", porPedido: VAZIO });
  const chave = Array.from(new Set(idsInt.filter((id) => Number.isFinite(id) && id > 0))).sort((a, b) => a - b).join(",");

  useEffect(() => {
    let ativo = true;
    if (!chave) return;
    void (async () => {
      let porPedido: Map<number, ObservacoesDoPedido> | null = null;
      try {
        porPedido = await lerObservacoesDosPedidos(chave.split(",").map(Number));
      } catch (erro) {
        console.warn("[useObservacoesDoPedido] Falha ao ler as observações:", erro);
      }
      if (ativo && porPedido) setLido({ chave, porPedido });
    })();
    return () => {
      ativo = false;
    };
  }, [chave]);

  if (!chave || lido.chave !== chave) return VAZIO;
  return lido.porPedido;
}
