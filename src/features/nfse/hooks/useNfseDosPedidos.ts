"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { NotaDeServicoDoPedido } from "@/features/nfse/lib/regras-emissao";

/**
 * As notas de serviço dos pedidos VISÍVEIS na Fila, lidas em lote de
 * `notas_servico`, para o botão "NFS-e" de cada linha mostrar o estado certo.
 *
 * É uma leitura à parte, de propósito: a consulta que monta a Fila
 * (`getFaturaveisPropostas`) não muda e não sabe de NFS-e.
 *
 * `versao` muda quando a janela "Gerar NFS-e" cria, envia ou conclui uma nota:
 * a leitura é refeita.
 *
 * `pronta` diz se a leitura dos pedidos consultados AGORA chegou inteira. Enquanto
 * carrega, ou se falhou, é `false` — e quem esconde linha da Fila por causa da
 * NFS-e não esconde nada (lib/fila-nfse).
 */
export type NotaDeServicoDaFila = NotaDeServicoDoPedido & { id_int: number };

const TAMANHO_DO_LOTE = 200;
const SEM_NOTAS: Map<number, NotaDeServicoDaFila[]> = new Map();

export function useNfseDosPedidos(
  idsInt: readonly number[],
  ligado: boolean,
  versao: number
): { porPedido: Map<number, NotaDeServicoDaFila[]>; pronta: boolean } {
  // A leitura guarda PARA QUAIS pedidos ela vale: trocou a lista, deixa de valer.
  const [lido, setLido] = useState<{ chave: string; porPedido: Map<number, NotaDeServicoDaFila[]> }>({ chave: "", porPedido: SEM_NOTAS });
  // A lista de ids vira texto para o efeito não rodar a cada render.
  const chave = ligado ? Array.from(new Set(idsInt)).sort((a, b) => a - b).join(",") : "";

  useEffect(() => {
    let ativo = true;
    if (!chave) return;
    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const ids = chave.split(",").map(Number);
      const mapa = new Map<number, NotaDeServicoDaFila[]>();
      for (let i = 0; i < ids.length; i += TAMANHO_DO_LOTE) {
        const { data, error } = await supabase
          .from("notas_servico")
          .select("id_int, ref, status, numero_nfse, created_at")
          .in("id_int", ids.slice(i, i + TAMANHO_DO_LOTE));
        if (error) {
          // Sem a leitura, o botão fica como "NFS-e": a janela e a rota decidem de novo.
          console.warn("[useNfseDosPedidos] Não foi possível ler as notas de serviço da Fila:", error.message);
          return;
        }
        (data ?? []).forEach((linha) => {
          const idInt = Number((linha as { id_int: number | null }).id_int);
          if (!Number.isFinite(idInt)) return;
          const lista = mapa.get(idInt) ?? [];
          lista.push({ ...(linha as unknown as NotaDeServicoDaFila), id_int: idInt });
          mapa.set(idInt, lista);
        });
      }
      if (ativo) setLido({ chave, porPedido: mapa });
    })();
    return () => {
      ativo = false;
    };
  }, [chave, versao]);

  // Sem pedido para olhar não há o que esperar: a leitura está pronta e vazia.
  if (!chave) return { porPedido: SEM_NOTAS, pronta: ligado };
  // Leitura de outra lista de pedidos (ou que ainda não chegou) não vale.
  if (lido.chave !== chave) return { porPedido: SEM_NOTAS, pronta: false };
  return { porPedido: lido.porPedido, pronta: true };
}
