"use client";

/**
 * Os pedidos que apontam para cada endereco (`propostas.id_endereco_ent`), para
 * o cartao agrupado dizer "usado em N pedidos" (25/11/2026). Somente leitura.
 *
 * Paginado de 1.000 em 1.000: o PostgREST corta a resposta nesse teto sem
 * avisar, e um endereco principal pode estar em centenas de pedidos.
 */
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";

const PAGINA = 1000;

export async function buscarPedidosPorEndereco(ids: string[]): Promise<Record<string, number[]>> {
  const resultado: Record<string, number[]> = {};
  const client = getSupabaseClient();
  if (!client || ids.length === 0) return resultado;

  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await client
      .from("propostas")
      .select("id_int, id_endereco_ent")
      .in("id_endereco_ent", ids)
      .order("id_int", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(error.message || "Erro ao ler os pedidos dos enderecos.");
    for (const linha of (data ?? []) as { id_int: number | string | null; id_endereco_ent: string | null }[]) {
      const id = linha.id_endereco_ent;
      const pedido = Number(linha.id_int);
      if (!id || !Number.isFinite(pedido)) continue;
      (resultado[id] ??= []).push(pedido);
    }
    if (!data || data.length < PAGINA) break;
  }
  return resultado;
}

/** `ids` vazio nao consulta nada. Erro de leitura deixa o mapa vazio (o cartao diz "sem pedido"). */
export function usePedidosDosEnderecos(ids: string[]): { pedidosPorEndereco: Record<string, number[]>; carregando: boolean } {
  const chave = [...ids].sort().join(",");
  const [estado, setEstado] = useState<{ chave: string; mapa: Record<string, number[]> }>({ chave: "", mapa: {} });

  useEffect(() => {
    if (!chave) return;
    let cancelado = false;
    buscarPedidosPorEndereco(chave.split(","))
      .then((mapa) => { if (!cancelado) setEstado({ chave, mapa }); })
      .catch((erro) => {
        console.error("[usePedidosDosEnderecos]", erro);
        if (!cancelado) setEstado({ chave, mapa: {} });
      });
    return () => { cancelado = true; };
  }, [chave]);

  return {
    pedidosPorEndereco: estado.chave === chave ? estado.mapa : {},
    carregando: Boolean(chave) && estado.chave !== chave
  };
}
