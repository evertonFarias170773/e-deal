import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decidirDesfazerNotaAntecipada,
  decidirLiberarNotaAntecipada,
  type NfeDoPedido
} from "@/features/orcamentos/lib/nota-antecipada";

/**
 * Grava "Liberar nota antecipada" e o desfazer (29/10/2026). Roda no SERVIDOR, com a
 * sessão do usuário; a rota já conferiu a permissão. A regra está em
 * `lib/nota-antecipada.ts`.
 *
 * COMO GRAVA
 *   Um UPDATE só, de `libera_nf`, GUARDADO pelo estado lido (status, `libera_nf`,
 *   `is_prd_aprovado` e `faturado_fora_em` nulo): se alguém mexeu no meio, nada é
 *   gravado. Depois, uma linha na linha do tempo (`propostas_chat`) com o autor.
 *   Falhar a linha do tempo não desfaz a ação, mas a resposta AVISA.
 *
 * NÃO TOCA: `status_interno`, `is_prd_aprovado`, `liberado_producao_em`, cobranças,
 * notas.
 */

export type ResultadoNotaAntecipada =
  | { success: true; idempotente: true; message: string }
  | { success: true; idempotente: false; message: string; aviso: string | null }
  | { success: false; httpStatus: number; code: string; message: string };

type PropostaLida = {
  id_int: number;
  id_cliente: number | null;
  status_interno: string | null;
  libera_nf: boolean | null;
  is_prd_aprovado: boolean | null;
  faturado_fora_em: string | null;
};

async function lerProposta(supabase: SupabaseClient, idInt: number) {
  return supabase
    .from("propostas")
    .select("id_int, id_cliente, status_interno, libera_nf, is_prd_aprovado, faturado_fora_em")
    .eq("id_int", idInt)
    .maybeSingle<PropostaLida>();
}

const estadoDe = (p: PropostaLida) => ({
  statusInterno: p.status_interno,
  liberaNf: p.libera_nf,
  isPrdAprovado: p.is_prd_aprovado,
  faturadoForaEm: p.faturado_fora_em
});

export async function gravarNotaAntecipada(
  supabase: SupabaseClient,
  entrada: { idInt: number; liberar: boolean; autor: { uid: string; nome: string; email: string | null } }
): Promise<ResultadoNotaAntecipada> {
  const { idInt, liberar, autor } = entrada;
  const decidir = liberar ? decidirLiberarNotaAntecipada : decidirDesfazerNotaAntecipada;

  const { data: proposta, error: erroProposta } = await lerProposta(supabase, idInt);
  if (erroProposta) return { success: false, httpStatus: 500, code: "LEITURA_FALHOU", message: erroProposta.message || "Erro ao ler a proposta." };
  if (!proposta) return { success: false, httpStatus: 404, code: "NAO_ENCONTRADA", message: "Proposta não encontrada." };

  // As notas do pedido. Falha de leitura vira recusa, nunca "não há".
  const { data: notasRows, error: erroNotas } = await supabase
    .from("notas_fiscais")
    .select("ref, status, tipo_nota")
    .eq("id_int", idInt);
  if (erroNotas) {
    return { success: false, httpStatus: 500, code: "LEITURA_FALHOU", message: `Não foi possível conferir as notas do pedido (${erroNotas.message}). Nada foi alterado.` };
  }
  const notas: NfeDoPedido[] = ((notasRows ?? []) as Array<{ ref: string | null; status: string | null; tipo_nota: string | null }>).map(
    (n) => ({ ref: n.ref, status: n.status, tipoNota: n.tipo_nota })
  );

  const decisao = decidir(estadoDe(proposta), notas);
  if (decisao.acao === "recusar") return { success: false, httpStatus: 409, code: decisao.code, message: decisao.message };
  if (decisao.acao === "idempotente") {
    return {
      success: true,
      idempotente: true,
      message: liberar
        ? `A proposta #${idInt} já está liberada para a Fila de Faturamento. Nada foi gravado.`
        : `A proposta #${idInt} não está liberada para nota antecipada. Nada foi gravado.`
    };
  }

  // UPDATE guardado pelo estado lido. Grava SO libera_nf.
  let consulta = supabase
    .from("propostas")
    .update({ libera_nf: liberar })
    .eq("id_int", idInt)
    .eq("status_interno", String(proposta.status_interno ?? ""));
  if (liberar) consulta = consulta.is("faturado_fora_em", null);
  consulta = proposta.libera_nf === null ? consulta.is("libera_nf", null) : consulta.eq("libera_nf", proposta.libera_nf);
  consulta = proposta.is_prd_aprovado === null ? consulta.is("is_prd_aprovado", null) : consulta.eq("is_prd_aprovado", proposta.is_prd_aprovado);
  const { data: gravadas, error: erroUpdate } = await consulta.select("id_int");

  if (erroUpdate) {
    return { success: false, httpStatus: 500, code: "NAO_GRAVADO", message: `Não foi possível gravar (${erroUpdate.message}). Nada foi alterado.` };
  }
  if (!gravadas || gravadas.length === 0) {
    return { success: false, httpStatus: 409, code: "ESTADO_MUDOU", message: "O pedido mudou durante a ação. Nada foi alterado; confira e tente de novo." };
  }

  const mensagem = liberar
    ? `🧾 Pedido liberado para NOTA ANTECIPADA por ${autor.nome}: entra na Fila de Faturamento antes do pagamento (só libera_nf ligada; status, produção e cobranças não mudam).`
    : `↩️ Liberação de NOTA ANTECIPADA desfeita por ${autor.nome}: o pedido sai da Fila de Faturamento (só libera_nf desligada).`;
  const { error: erroChat } = await supabase.from("propostas_chat").insert([
    {
      id_int: idInt,
      id_cliente: proposta.id_cliente ?? null,
      tipo: "SISTEMA",
      setor: "Financeiro",
      visivel_externo: false,
      autor_uid: autor.uid,
      autor_nome: autor.nome,
      autor_email: autor.email,
      mensagem
    }
  ]);
  if (erroChat) console.error(`[nota-antecipada] Falha ao gravar a linha do tempo da proposta #${idInt}:`, erroChat.message);

  return {
    success: true,
    idempotente: false,
    message: liberar
      ? `Proposta #${idInt} liberada para a Fila de Faturamento (nota antecipada).`
      : `Liberação de nota antecipada da proposta #${idInt} desfeita.`,
    aviso: erroChat ? `A ação foi gravada, mas a linha do tempo falhou (${erroChat.message}): a autoria não ficou registrada.` : null
  };
}
