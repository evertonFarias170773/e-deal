"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  modelosComFimDivergente,
  type FimDivergente,
  type ModeloComFaixaGravada,
  type NumeracaoOpcao
} from "@/features/orcamentos/numeracao-modelo-utils";

/**
 * Os modelos, por pedido, cujo Nº Final GRAVADO difere do calculado com o
 * numerador de hoje — para a pergunta antes de imprimir a OS e o boletim.
 *
 * POR QUE É LIDO ANTES DO CLIQUE
 *   O PDF da OS abre numa aba nova, de forma SÍNCRONA no clique (depois de um
 *   `await` o navegador bloqueia a aba). A pergunta "Imprimir mesmo assim?"
 *   precisa então já saber a resposta quando o clique acontece. Por isso a
 *   leitura é feita quando a tela carrega, em lote, e fica guardada.
 *
 * SÓ LEITURA: `pedidos_modelos` dos pedidos pedidos e `producao_numeracoes`.
 * A conta é a de `numeracao-modelo-utils`. Nada é gravado nem corrigido.
 *
 * Falha ou carga: `pronta` fica falso e ninguém é avisado — a impressão segue
 * como sempre.
 */
const TAMANHO_DO_LOTE = 200;
const NADA: Map<number, FimDivergente[]> = new Map();

export function useFimDivergente(idsInt: readonly number[]): { porPedido: Map<number, FimDivergente[]>; pronta: boolean } {
  const [lido, setLido] = useState<{ chave: string; porPedido: Map<number, FimDivergente[]> }>({ chave: "", porPedido: NADA });
  const chave = Array.from(new Set(idsInt.filter((id) => Number.isFinite(id) && id > 0))).sort((a, b) => a - b).join(",");

  useEffect(() => {
    let ativo = true;
    if (!chave) return;
    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const ids = chave.split(",").map(Number);

      const { data: numeracoes, error: erroNumeracoes } = await supabase
        .from("producao_numeracoes")
        .select("name, tipo, ticket_qtd");
      if (erroNumeracoes) {
        console.warn("[useFimDivergente] numeradores não lidos:", erroNumeracoes.message);
        return;
      }

      const modelos: ModeloComFaixaGravada[] = [];
      for (let i = 0; i < ids.length; i += TAMANHO_DO_LOTE) {
        const { data, error } = await supabase
          .from("pedidos_modelos")
          .select("id, id_int, nome_modelo, quantidade, tipo_numeracao, numeracao_inicio, numeracao_fim, gabarito_operacional, mapa_teatro_id")
          .in("id_int", ids.slice(i, i + TAMANHO_DO_LOTE))
          .not("numeracao_fim", "is", null);
        if (error) {
          console.warn("[useFimDivergente] modelos não lidos:", error.message);
          return;
        }
        modelos.push(...((data ?? []) as ModeloComFaixaGravada[]));
      }

      const porPedido = new Map<number, FimDivergente[]>();
      for (const divergente of modelosComFimDivergente(modelos, (numeracoes ?? []) as NumeracaoOpcao[])) {
        if (divergente.idInt === null) continue;
        porPedido.set(divergente.idInt, [...(porPedido.get(divergente.idInt) ?? []), divergente]);
      }
      if (ativo) setLido({ chave, porPedido });
    })();
    return () => {
      ativo = false;
    };
  }, [chave]);

  if (!chave) return { porPedido: NADA, pronta: true };
  if (lido.chave !== chave) return { porPedido: NADA, pronta: false };
  return { porPedido: lido.porPedido, pronta: true };
}
