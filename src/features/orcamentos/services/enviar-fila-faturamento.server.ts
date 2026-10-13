import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ORIGEM_LOG_ENVIO_FILA_FATURAMENTO,
  STATUS_PARA_ENVIAR_A_FILA,
  decidirEnvioParaFila
} from "@/features/orcamentos/lib/enviar-fila-faturamento";

/**
 * Grava "Enviar para Fila de Faturamento" (13/10/2026). Roda no SERVIDOR, com a
 * sessão do usuário; quem chama (a rota) já conferiu que ele é ADM. A regra e o
 * porquê estão em `lib/enviar-fila-faturamento.ts`.
 *
 * COMO GRAVA
 *   Um UPDATE só, `libera_nf = true` e NADA mais, GUARDADO pelo estado que acabou de
 *   ser lido (status, `libera_nf` e `is_prd_aprovado`): se alguém mexeu no meio, nada
 *   é gravado. Depois, uma linha em `os_status_log` com o autor (o status não muda:
 *   anterior e novo são REVISAO ATENDENTE). Falhar o log não desfaz o envio, mas a
 *   resposta AVISA.
 *
 * O que NÃO é tocado: `is_prd_aprovado`, `status_interno`, `liberado_producao_em`,
 * cobranças, boletim, OS.
 */

export type ResultadoDoEnvioParaFila =
  | { success: true; idempotente: true; message: string }
  | { success: true; idempotente: false; message: string; logGravado: boolean; aviso: string | null }
  | { success: false; httpStatus: number; code: string; message: string };

type Cliente = SupabaseClient;
type PropostaLida = { id_int: number; status_interno: string | null; libera_nf: boolean | null; is_prd_aprovado: boolean | null };

async function lerProposta(supabase: Cliente, idInt: number) {
  return supabase
    .from("propostas")
    .select("id_int, status_interno, libera_nf, is_prd_aprovado")
    .eq("id_int", idInt)
    .maybeSingle<PropostaLida>();
}

const decidir = (p: PropostaLida) =>
  decidirEnvioParaFila({ statusInterno: p.status_interno, liberaNf: p.libera_nf, isPrdAprovado: p.is_prd_aprovado });

export async function enviarPedidoParaFilaDeFaturamento(
  supabase: Cliente,
  entrada: { idInt: number; autor: { uid: string; nome: string } }
): Promise<ResultadoDoEnvioParaFila> {
  const { idInt, autor } = entrada;
  const jaEsta: ResultadoDoEnvioParaFila = { success: true, idempotente: true, message: `A proposta #${idInt} já está na Fila de Faturamento. Nada foi gravado.` };

  const { data: proposta, error: erroProposta } = await lerProposta(supabase, idInt);
  if (erroProposta) {
    return { success: false, httpStatus: 500, code: "LEITURA_FALHOU", message: erroProposta.message || "Erro ao ler a proposta." };
  }
  if (!proposta) {
    return { success: false, httpStatus: 404, code: "NAO_ENCONTRADA", message: "Proposta não encontrada." };
  }

  const decisao = decidir(proposta);
  if (decisao.acao === "recusar") {
    return { success: false, httpStatus: 409, code: decisao.code, message: decisao.message };
  }
  if (decisao.acao === "idempotente") return jaEsta;

  const statusLido = String(proposta.status_interno ?? "");
  const liberaNfLida = proposta.libera_nf;
  const flagProducaoLida = proposta.is_prd_aprovado;

  // UPDATE guardado pelo estado lido: so vale se ninguem mexeu no meio. Grava SO libera_nf.
  let consulta = supabase.from("propostas").update({ libera_nf: true }).eq("id_int", idInt).eq("status_interno", statusLido);
  consulta = liberaNfLida === null ? consulta.is("libera_nf", null) : consulta.eq("libera_nf", liberaNfLida);
  consulta = flagProducaoLida === null ? consulta.is("is_prd_aprovado", null) : consulta.eq("is_prd_aprovado", flagProducaoLida);
  const { data: gravadas, error: erroUpdate } = await consulta.select("id_int");

  if (erroUpdate) {
    return { success: false, httpStatus: 500, code: "ENVIO_NAO_GRAVADO", message: `Não foi possível enviar à Fila de Faturamento (${erroUpdate.message}). Nada foi alterado.` };
  }

  if (!gravadas || gravadas.length === 0) {
    // Mudou entre a leitura e a gravacao: decide de novo sobre o que o banco diz agora.
    const { data: agora } = await lerProposta(supabase, idInt);
    const nova = agora ? decidir(agora) : null;
    if (nova?.acao === "idempotente") return jaEsta;
    return {
      success: false,
      httpStatus: 409,
      code: "ESTADO_MUDOU",
      message:
        nova?.acao === "recusar"
          ? `O pedido mudou durante a ação. ${nova.message} Nada foi alterado.`
          : "O pedido mudou durante a ação. Nada foi alterado; confira e tente de novo."
    };
  }

  const { error: erroLog } = await supabase.from("os_status_log").insert({
    id_int: idInt,
    status_anterior: STATUS_PARA_ENVIAR_A_FILA,
    status_novo: STATUS_PARA_ENVIAR_A_FILA,
    resultado: "sucesso",
    motivo: "Enviado à Fila de Faturamento sem passar pela Produção nem pela Expedição (só libera_nf ligada; status e is_prd_aprovado inalterados).",
    origem: ORIGEM_LOG_ENVIO_FILA_FATURAMENTO,
    ator_tipo: "USUARIO",
    ator_uid: autor.uid,
    ator_nome: autor.nome,
    tipo_transicao: "NATURAL"
  });
  if (erroLog) console.error(`[enviar-fila-faturamento] Falha ao gravar os_status_log da proposta #${idInt}:`, erroLog.message);

  return {
    success: true,
    idempotente: false,
    message: `Proposta #${idInt} enviada à Fila de Faturamento.`,
    logGravado: !erroLog,
    aviso: erroLog ? `O pedido foi enviado à Fila de Faturamento, mas o registro de autoria no log falhou (${erroLog.message}).` : null
  };
}
