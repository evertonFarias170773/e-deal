import type { SupabaseClient } from "@supabase/supabase-js";
import { PAYLOAD_DEVOLUCAO_AO_ATENDENTE, STATUS_APOS_RETIRAR } from "@/features/orcamentos/lib/retirar-producao";
import { ORIGEM_LOG_DEVOLVER_ATENDENTE } from "@/features/orcamentos/lib/devolver-atendente";
import { recusaPorNotaEmitida } from "@/features/orcamentos/services/nota-impede-devolucao.server";

/**
 * A devolução do pedido ao atendente, no SERVIDOR (13/10/2026).
 *
 * `gravarDevolucaoAoAtendente` é a gravação ÚNICA das duas portas de volta — "Retirar
 * da Produção" e "Voltar para Revisão Atendente": um UPDATE só com
 * `PAYLOAD_DEVOLUCAO_AO_ATENDENTE`, GUARDADO pelo status e pela flag que acabaram de
 * ser lidos (se mudaram no meio, nada é gravado), e depois uma linha de autoria em
 * `os_status_log`. Falhar o log não desfaz a devolução; quem chama avisa.
 *
 * `devolverPedidoAoAtendente` é o "Voltar para Revisão Atendente" da tela Produção,
 * que até aqui gravava direto do navegador, sem conferência de permissão no servidor
 * e sem trilha. O que ele grava NÃO mudou; entraram a trava de nota emitida, a
 * idempotência e o registro de quem devolveu. Vale em qualquer status, como antes.
 *
 * O que NÃO é tocado: `liberado_producao_em`, cobranças, financeiro, `libera_nf`,
 * `em_arte`, OS e setores.
 */

type Cliente = SupabaseClient;

export type PropostaLida = { id_int: number; status_interno: string | null; is_prd_aprovado: boolean | null };

export async function lerPropostaParaDevolucao(supabase: Cliente, idInt: number) {
  return supabase
    .from("propostas")
    .select("id_int, status_interno, is_prd_aprovado")
    .eq("id_int", idInt)
    .maybeSingle<PropostaLida>();
}

/** O pedido já está com o atendente e fora da fila? */
export function jaEstaComOAtendente(proposta: { status_interno: string | null; is_prd_aprovado: boolean | null } | null | undefined): boolean {
  return String(proposta?.status_interno ?? "").trim().toUpperCase() === STATUS_APOS_RETIRAR && proposta?.is_prd_aprovado !== true;
}

export type DesfechoDaGravacao =
  | { tipo: "gravou"; erroDoLog: string | null }
  | { tipo: "erro"; message: string }
  /** O UPDATE não casou: alguém mexeu entre a leitura e a gravação. */
  | { tipo: "mudou"; agora: PropostaLida | null };

export async function gravarDevolucaoAoAtendente(
  supabase: Cliente,
  entrada: {
    idInt: number;
    statusLido: string | null;
    flagLida: boolean | null;
    autor: { uid: string; nome: string };
    origem: string;
    motivo: string;
  }
): Promise<DesfechoDaGravacao> {
  const { idInt, statusLido, flagLida, autor } = entrada;

  // UPDATE guardado pelo status e pela flag lidos: so vale se ninguem mexeu no meio.
  let consulta = supabase.from("propostas").update({ ...PAYLOAD_DEVOLUCAO_AO_ATENDENTE }).eq("id_int", idInt);
  consulta = statusLido === null ? consulta.is("status_interno", null) : consulta.eq("status_interno", statusLido);
  consulta = flagLida === null ? consulta.is("is_prd_aprovado", null) : consulta.eq("is_prd_aprovado", flagLida);
  const { data: gravadas, error: erroUpdate } = await consulta.select("id_int");

  if (erroUpdate) return { tipo: "erro", message: erroUpdate.message };

  if (!gravadas || gravadas.length === 0) {
    const { data: agora } = await lerPropostaParaDevolucao(supabase, idInt);
    return { tipo: "mudou", agora: agora ?? null };
  }

  const { error: erroLog } = await supabase.from("os_status_log").insert({
    id_int: idInt,
    status_anterior: statusLido,
    status_novo: STATUS_APOS_RETIRAR,
    resultado: "sucesso",
    motivo: entrada.motivo,
    origem: entrada.origem,
    ator_tipo: "USUARIO",
    ator_uid: autor.uid,
    ator_nome: autor.nome,
    tipo_transicao: "RETORNO"
  });
  if (erroLog) console.error(`[${entrada.origem}] Falha ao gravar os_status_log da proposta #${idInt}:`, erroLog.message);

  return { tipo: "gravou", erroDoLog: erroLog ? erroLog.message : null };
}

export type ResultadoDaDevolucao =
  | { success: true; idempotente: true; message: string }
  | { success: true; idempotente: false; message: string; statusAnterior: string | null; logGravado: boolean; aviso: string | null }
  | { success: false; httpStatus: number; code: string; message: string };

export async function devolverPedidoAoAtendente(
  supabase: Cliente,
  entrada: { idInt: number; autor: { uid: string; nome: string } }
): Promise<ResultadoDaDevolucao> {
  const { idInt, autor } = entrada;
  const jaEsta: ResultadoDaDevolucao = { success: true, idempotente: true, message: `A proposta #${idInt} já está em ${STATUS_APOS_RETIRAR}. Nada foi gravado.` };

  const { data: proposta, error: erroProposta } = await lerPropostaParaDevolucao(supabase, idInt);
  if (erroProposta) {
    return { success: false, httpStatus: 500, code: "LEITURA_FALHOU", message: erroProposta.message || "Erro ao ler a proposta." };
  }
  if (!proposta) {
    return { success: false, httpStatus: 404, code: "NAO_ENCONTRADA", message: "Proposta não encontrada." };
  }

  // Repetir a acao nao grava nada (nem um segundo registro de autoria).
  if (jaEstaComOAtendente(proposta)) return jaEsta;

  // Nota emitida trava a volta. E a mesma checagem da rota retirar-producao.
  const recusa = await recusaPorNotaEmitida(supabase, idInt);
  if (recusa) return recusa;

  const statusLido = proposta.status_interno;

  const desfecho = await gravarDevolucaoAoAtendente(supabase, {
    idInt,
    statusLido,
    flagLida: proposta.is_prd_aprovado,
    autor,
    origem: ORIGEM_LOG_DEVOLVER_ATENDENTE,
    motivo: "Devolvido ao atendente pela tela Produção (is_prd_aprovado desligada e status em REVISAO ATENDENTE, na mesma gravação)."
  });

  if (desfecho.tipo === "erro") {
    return { success: false, httpStatus: 500, code: "DEVOLUCAO_NAO_GRAVADA", message: `Não foi possível devolver o pedido ao atendente (${desfecho.message}). Nada foi alterado.` };
  }
  if (desfecho.tipo === "mudou") {
    if (jaEstaComOAtendente(desfecho.agora)) return jaEsta;
    return {
      success: false,
      httpStatus: 409,
      code: "STATUS_MUDOU",
      message: `O pedido mudou de status durante a ação (agora: ${desfecho.agora?.status_interno ?? "sem status"}). Nada foi alterado; confira e tente de novo.`
    };
  }

  return {
    success: true,
    idempotente: false,
    message: `Proposta #${idInt} devolvida ao atendente.`,
    statusAnterior: statusLido,
    logGravado: desfecho.erroDoLog === null,
    aviso: desfecho.erroDoLog
      ? `O pedido voltou ao atendente, mas o registro de autoria no log falhou (${desfecho.erroDoLog}).`
      : null
  };
}
