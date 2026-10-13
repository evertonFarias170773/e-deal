"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { mensagemNotaImpedeDevolucao, type NotaDoPedido } from "@/features/orcamentos/lib/nota-impede-devolucao";

/**
 * Para a TELA desligar "Retirar da Produção" / "Voltar para Revisão Atendente" com o
 * motivo, quando o pedido tem nota fiscal emitida (13/10/2026). Lê em lote, só
 * leitura, as notas AUTORIZADAS dos pedidos informados e devolve, por pedido, a
 * mensagem de recusa — a mesma do servidor (`mensagemNotaImpedeDevolucao`).
 *
 * É só conforto: a trava de verdade é a das rotas. Enquanto a leitura não chega, ou
 * se falhar, o mapa fica vazio, o item fica ligado e o servidor recusa com a mesma
 * mensagem.
 */

const TAMANHO_DO_LOTE = 200;
const SEM_MOTIVOS: Map<number, string> = new Map();

type Linha = { id_int: number | null; status: string | null; ambiente: string | null; numero_nf?: string | number | null; numero_nfse?: string | number | null };

export function useNotasQueImpedemDevolucao(idsInt: readonly number[], ligado: boolean, versao = 0): Map<number, string> {
  const [lido, setLido] = useState<{ chave: string; motivos: Map<number, string> }>({ chave: "", motivos: SEM_MOTIVOS });
  // A lista de ids vira texto para o efeito não rodar a cada render.
  const chave = ligado ? Array.from(new Set(idsInt.filter((id) => Number.isInteger(id) && id > 0))).sort((a, b) => a - b).join(",") : "";

  useEffect(() => {
    let ativo = true;
    if (!chave) return;
    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const ids = chave.split(",").map(Number);
      const porPedido = new Map<number, NotaDoPedido[]>();
      const junta = (linhas: Linha[] | null, tipo: NotaDoPedido["tipo"]) => {
        (linhas ?? []).forEach((l) => {
          const idInt = Number(l.id_int);
          if (!Number.isFinite(idInt)) return;
          const numero = tipo === "NFE" ? l.numero_nf : l.numero_nfse;
          const lista = porPedido.get(idInt) ?? [];
          lista.push({ tipo, numero: numero === null || numero === undefined ? null : String(numero), status: l.status, ambiente: l.ambiente });
          porPedido.set(idInt, lista);
        });
      };
      for (let i = 0; i < ids.length; i += TAMANHO_DO_LOTE) {
        const fatia = ids.slice(i, i + TAMANHO_DO_LOTE);
        const [nfe, nfse] = await Promise.all([
          supabase.from("notas_fiscais").select("id_int, status, ambiente, numero_nf").in("id_int", fatia).eq("status", "AUTORIZADA"),
          supabase.from("notas_servico").select("id_int, status, ambiente, numero_nfse").in("id_int", fatia).eq("status", "AUTORIZADA")
        ]);
        if (nfe.error || nfse.error) {
          console.warn("[useNotasQueImpedemDevolucao] Não foi possível ler as notas dos pedidos:", (nfe.error ?? nfse.error)?.message);
          return;
        }
        junta(nfe.data as Linha[] | null, "NFE");
        junta(nfse.data as Linha[] | null, "NFSE");
      }
      const motivos = new Map<number, string>();
      porPedido.forEach((notas, idInt) => {
        const motivo = mensagemNotaImpedeDevolucao(notas);
        if (motivo) motivos.set(idInt, motivo);
      });
      if (ativo) setLido({ chave, motivos });
    })();
    return () => {
      ativo = false;
    };
  }, [chave, versao]);

  if (!chave || lido.chave !== chave) return SEM_MOTIVOS;
  return lido.motivos;
}
