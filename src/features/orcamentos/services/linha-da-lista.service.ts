"use client";

import { getSupabaseClient } from "@/lib/supabase/client";
import { mapSupabasePropostaRowsToListItems, type OrcamentoListItem } from "@/features/orcamentos/mappers";
import type { SupabasePagamentoTipoCobrancaRow, SupabasePropostaRow } from "@/features/orcamentos/types.supabase";
import { COLUNAS_DA_LISTA_DE_PEDIDOS } from "@/features/orcamentos/services/orcamentos.service";
import { cobrancasNaFilaPorPedido } from "@/features/orcamentos/lib/cobrancas-na-fila";
import { COLUNAS_NOTA_DO_PEDIDO, escolherNotaAutorizadaDoPedido, type NotaCandidata } from "@/lib/fiscal/nota-do-pedido";

/**
 * A linha de UMA proposta como a lista de Pedidos a monta (05/11/2026).
 *
 * O menu Ações de dentro da proposta mostra as ações da lista com as MESMAS
 * condições, e as condições leem campos da linha da lista: cobranças na Fila de
 * Conferência, nota emitida, teste encerrado, nota no sistema antigo. Aqui sai a
 * mesma linha — mesma view, mesmas colunas, mesmas regras de cobrança na fila e
 * de nota escolhida, mesmo mapper —, só que para um pedido.
 *
 * Devolve `null` quando não consegue ler; o menu então fica só com as ações de
 * sempre da proposta.
 */
export async function lerLinhaDaListaDaProposta(idInt: number): Promise<OrcamentoListItem | null> {
  const client = getSupabaseClient();
  if (!client || !Number.isFinite(idInt) || idInt <= 0) return null;

  const [linha, cobrancas, notas] = await Promise.all([
    client.from("vw_propostas_lista").select(COLUNAS_DA_LISTA_DE_PEDIDOS).eq("id_int", idInt).maybeSingle<SupabasePropostaRow>(),
    client
      .from("pagamentos_v2")
      .select("id,id_int,tipo_cobranca,status,confirmado,confirmado_por,paid_at,valor,created_at")
      .eq("id_int", idInt)
      .returns<SupabasePagamentoTipoCobrancaRow[]>(),
    client
      .from("notas_fiscais")
      .select(`id_int, ref, url_danfe, url_xml, ${COLUNAS_NOTA_DO_PEDIDO}`)
      .eq("id_int", idInt)
      .returns<(NotaCandidata & { ref: string | null; url_danfe: string | null; url_xml: string | null })[]>()
  ]);

  if (linha.error || !linha.data) return null;

  // Leitura que falhou não vira "sem cobrança na fila" nem "sem nota" em silêncio:
  // sem saber, as ações que dependem disso ficam fora, como numa lista que não carregou.
  const naFila = cobrancas.error ? [] : cobrancasNaFilaPorPedido(cobrancas.data ?? []).get(String(idInt)) ?? [];
  const nota = notas.error ? null : escolherNotaAutorizadaDoPedido(notas.data ?? []);

  const [item] = mapSupabasePropostaRowsToListItems([
    {
      ...linha.data,
      cobrancas_na_fila: naFila,
      nota_emitida: nota
        ? {
            numero: String(nota.numero_nf ?? "").trim(),
            ref: String(nota.ref ?? "").trim(),
            urlDanfe: nota.url_danfe,
            urlXml: nota.url_xml
          }
        : null
    } as SupabasePropostaRow
  ]);
  return item ?? null;
}
