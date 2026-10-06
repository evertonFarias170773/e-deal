"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Formatos e cores de papel do cadastro de produção (`producao_formatos` e
 * `producao_cores`), só com as colunas que dizem se um produto tem cor para
 * escolher (`produtoTemCoresParaEscolher`, em lib/checklist-lote).
 *
 * Existe para a conferência da aba Artes, que roda no formulário da proposta e
 * não enxerga as listas que a aba Pedido carrega para os seletores. É a mesma
 * origem da aba Pedido; as duas tabelas são pequenas (dezenas de linhas).
 *
 * `null` enquanto não carregou (ou se a leitura falhou): quem usa mantém a
 * cobrança de sempre — nunca dispensa a cor por falta de informação.
 */
export type CoresDeProducao = {
  formatos: { id: unknown; id_formato_num: unknown }[];
  cores: { formato_id: unknown }[];
};

export function useCoresDeProducao(): CoresDeProducao | null {
  const [dados, setDados] = useState<CoresDeProducao | null>(null);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const [formatos, cores] = await Promise.all([
        supabase.from("producao_formatos").select("id, id_formato_num"),
        supabase.from("producao_cores").select("formato_id")
      ]);
      if (!ativo) return;
      if (formatos.error || cores.error) {
        console.warn(
          "[useCoresDeProducao] Não foi possível ler formatos e cores:",
          formatos.error?.message || cores.error?.message
        );
        return;
      }
      setDados({ formatos: formatos.data ?? [], cores: cores.data ?? [] });
    })();
    return () => {
      ativo = false;
    };
  }, []);

  return dados;
}
