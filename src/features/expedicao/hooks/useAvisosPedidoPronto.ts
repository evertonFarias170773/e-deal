"use client";

import { useCallback, useEffect, useState } from "react";
import { listarAvisosPronto, type AvisoPronto } from "../services/aviso-pronto.client";

/**
 * Último aviso "pedido pronto" de cada pedido do painel que está na bancada
 * (status EXPEDICAO). Leitura à parte, como `useInstrucoesDeEntrega`: a consulta
 * do painel não muda. Falhou a leitura, o mapa fica vazio e o botão aparece
 * como "Avisar cliente" — o servidor recusa o segundo envio de qualquer forma.
 */
const VAZIO: Map<number, AvisoPronto> = new Map();

export function useAvisosPedidoPronto(pedidos: readonly { idInt: number; statusInterno: string }[], ativo: boolean) {
  const [avisos, setAvisos] = useState<Map<number, AvisoPronto>>(VAZIO);
  const [modoTeste, setModoTeste] = useState<boolean>(true);

  useEffect(() => {
    let vivo = true;
    const ids = Array.from(
      new Set(
        pedidos
          .filter((p) => (p.statusInterno ?? "").toUpperCase() === "EXPEDICAO")
          .map((p) => p.idInt)
          .filter((id) => Number.isFinite(id) && id > 0)
      )
    );
    if (!ativo || ids.length === 0) return;
    void (async () => {
      const res = await listarAvisosPronto(ids);
      if (!vivo) return;
      if (!res.ok) {
        console.warn("[useAvisosPedidoPronto] Não foi possível ler os avisos:", res.mensagem);
        return;
      }
      const mapa = new Map<number, AvisoPronto>();
      for (const [id, aviso] of Object.entries(res.avisos ?? {})) {
        if (aviso) mapa.set(Number(id), aviso);
      }
      setAvisos(mapa);
      setModoTeste(res.modo_teste !== false);
    })();
    return () => {
      vivo = false;
    };
  }, [pedidos, ativo]);

  const atualizar = useCallback((idInt: number, aviso: AvisoPronto | null | undefined, teste?: boolean) => {
    if (typeof teste === "boolean") setModoTeste(teste);
    if (!aviso) return;
    setAvisos((atual) => {
      const novo = new Map(atual);
      novo.set(idInt, aviso);
      return novo;
    });
  }, []);

  return { avisos, modoTeste, atualizar };
}
