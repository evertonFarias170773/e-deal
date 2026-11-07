"use client";

import { useCallback, useEffect, useState } from "react";
import { listarAvisosPronto, type AvisoPronto, type ModeloAviso, type RecusaPorNumero } from "../services/aviso-pronto.client";

/**
 * Recusa por número da tentativa `seq`, guardada só nesta tela (o servidor não
 * grava o número). `corrigido`: o número já foi salvo pelo "Corrigir número".
 */
export type RecusaNumeroDoAviso = RecusaPorNumero & { seq: number; corrigido: boolean };

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
  const [recusas, setRecusas] = useState<Map<number, RecusaNumeroDoAviso>>(new Map());
  // Diálogo de cada pedido pela forma de envio (o servidor decide; a tela só mostra).
  const [modelos, setModelos] = useState<Map<number, ModeloAviso>>(new Map());
  // Último envio do "Testar modelo" de cada pedido (fora do aviso do pedido).
  const [testes, setTestes] = useState<Map<number, AvisoPronto>>(new Map());

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
      const doTeste = new Map<number, AvisoPronto>();
      for (const [id, t] of Object.entries(res.testes ?? {})) if (t) doTeste.set(Number(id), t);
      setTestes(doTeste);
      const doServidor = new Map<number, ModeloAviso>();
      for (const [id, m] of Object.entries(res.modelos ?? {})) doServidor.set(Number(id), m);
      setModelos(doServidor);
      setModoTeste(res.modo_teste !== false);
    })();
    return () => {
      vivo = false;
    };
  }, [pedidos, ativo]);

  const atualizar = useCallback(
    (idInt: number, aviso: AvisoPronto | null | undefined, teste?: boolean, recusa?: RecusaPorNumero | null) => {
    if (typeof teste === "boolean") setModoTeste(teste);
    if (!aviso) return;
    if (aviso.teste) {
      setTestes((atual) => new Map(atual).set(idInt, aviso));
      return;
    }
    // Tentativa nova: vale a recusa que veio com ela (ou nenhuma).
    setRecusas((atual) => {
      const anterior = atual.get(idInt);
      if (anterior && anterior.seq === aviso.seq && recusa === undefined) return atual;
      const novo = new Map(atual);
      if (recusa) novo.set(idInt, { ...recusa, seq: aviso.seq, corrigido: false });
      else novo.delete(idInt);
      return novo;
    });
    setAvisos((atual) => {
      const novo = new Map(atual);
      novo.set(idInt, aviso);
      return novo;
    });
    },
    []
  );

  const marcarCorrigido = useCallback((idInt: number) => {
    setRecusas((atual) => {
      const r = atual.get(idInt);
      if (!r) return atual;
      const novo = new Map(atual);
      novo.set(idInt, { ...r, corrigido: true });
      return novo;
    });
  }, []);

  return { avisos, modoTeste, atualizar, recusas, marcarCorrigido, modelos, testes };
}
