import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ORIGEM_LOG_RETIRAR_PRODUCAO,
  PAYLOAD_DEVOLUCAO_AO_ATENDENTE,
  STATUS_APOS_RETIRAR,
  decidirRetirada
} from "@/features/orcamentos/lib/retirar-producao";

/**
 * Grava "Retirar da Produção" (13/10/2026). Roda no SERVIDOR, com a sessão do
 * usuário; quem chama (a rota) já conferiu a permissão. A regra e o porquê estão em
 * `lib/retirar-producao.ts`.
 *
 * COMO GRAVA
 *   Um UPDATE só, `is_prd_aprovado = false` E `status_interno = 'REVISAO ATENDENTE'`
 *   juntos (o mesmo payload do "Devolver para o atendente"), GUARDADO pelo status e
 *   pela flag que acabaram de ser lidos: se mudaram no meio, nada é gravado. Depois,
 *   uma linha em `os_status_log` com o autor — a mesma trilha das ações da Expedição.
 *   Falhar o log não desfaz a retirada, mas a resposta AVISA.
 *
 * O que NÃO é tocado: `liberado_producao_em` (o carimbo da passagem pela fila),
 * cobranças, financeiro, `libera_nf`, `em_arte`.
 */

export type ResultadoDaRetirada =
  | { success: true; idempotente: true; message: string }
  | {
      success: true;
      idempotente: false;
      message: string;
      statusAnterior: string;
      logGravado: boolean;
      aviso: string | null;
    }
  | { success: false; httpStatus: number; code: string; message: string };

type Cliente = SupabaseClient;

async function lerProposta(supabase: Cliente, idInt: number) {
  return supabase.from("propostas").select("id_int, status_interno, is_prd_aprovado").eq("id_int", idInt).maybeSingle();
}

/** O pedido tem linha na tabela? (`limit(1)`: so interessa se existe.) */
async function existeLinha(supabase: Cliente, tabela: "propostas_os" | "propostas_os_setores", idInt: number) {
  const { data, error } = await supabase.from(tabela).select("id_int").eq("id_int", idInt).limit(1);
  return { existe: Boolean(data && data.length > 0), erro: error };
}

export async function retirarPedidoDaProducao(
  supabase: Cliente,
  entrada: { idInt: number; autor: { uid: string; nome: string } }
): Promise<ResultadoDaRetirada> {
  const { idInt, autor } = entrada;

  const { data: proposta, error: erroProposta } = await lerProposta(supabase, idInt);
  if (erroProposta) {
    return { success: false, httpStatus: 500, code: "LEITURA_FALHOU", message: erroProposta.message || "Erro ao ler a proposta." };
  }
  if (!proposta) {
    return { success: false, httpStatus: 404, code: "NAO_ENCONTRADA", message: "Proposta não encontrada." };
  }

  // Sem conseguir conferir a OS, nao decide: errar para o lado de retirar um pedido que ja produz e o pior.
  const os = await existeLinha(supabase, "propostas_os", idInt);
  if (os.erro) {
    return { success: false, httpStatus: 500, code: "LEITURA_OS_FALHOU", message: `Não foi possível conferir a OS do pedido (${os.erro.message}). Nada foi alterado.` };
  }
  const setores = await existeLinha(supabase, "propostas_os_setores", idInt);
  if (setores.erro) {
    return { success: false, httpStatus: 500, code: "LEITURA_OS_FALHOU", message: `Não foi possível conferir os setores do pedido (${setores.erro.message}). Nada foi alterado.` };
  }

  const decisao = decidirRetirada({
    statusInterno: proposta.status_interno,
    isPrdAprovado: proposta.is_prd_aprovado,
    temOs: os.existe,
    temSetores: setores.existe
  });

  if (decisao.acao === "recusar") {
    return { success: false, httpStatus: 409, code: decisao.code, message: decisao.message };
  }
  if (decisao.acao === "idempotente") {
    return { success: true, idempotente: true, message: `A proposta #${idInt} já está em ${STATUS_APOS_RETIRAR}. Nada foi gravado.` };
  }

  const statusLido = String(proposta.status_interno ?? "");
  const flagLida = proposta.is_prd_aprovado as boolean | null;

  // UPDATE guardado pelo status e pela flag lidos: so vale se ninguem mexeu no meio.
  let consulta = supabase
    .from("propostas")
    .update({ ...PAYLOAD_DEVOLUCAO_AO_ATENDENTE })
    .eq("id_int", idInt)
    .eq("status_interno", statusLido);
  consulta = flagLida === null ? consulta.is("is_prd_aprovado", null) : consulta.eq("is_prd_aprovado", flagLida);
  const { data: gravadas, error: erroUpdate } = await consulta.select("id_int");

  if (erroUpdate) {
    return { success: false, httpStatus: 500, code: "RETIRADA_NAO_GRAVADA", message: `Não foi possível retirar da produção (${erroUpdate.message}). Nada foi alterado.` };
  }

  if (!gravadas || gravadas.length === 0) {
    // Mudou entre a leitura e a gravacao: se ja voltou ao atendente (outro clique), e idempotente.
    const { data: agora } = await lerProposta(supabase, idInt);
    if (String(agora?.status_interno ?? "").trim().toUpperCase() === STATUS_APOS_RETIRAR && agora?.is_prd_aprovado !== true) {
      return { success: true, idempotente: true, message: `A proposta #${idInt} já está em ${STATUS_APOS_RETIRAR}. Nada foi gravado.` };
    }
    return {
      success: false,
      httpStatus: 409,
      code: "STATUS_MUDOU",
      message: `O pedido mudou de status durante a ação (agora: ${agora?.status_interno ?? "sem status"}). Nada foi alterado; confira e tente de novo.`
    };
  }

  const { error: erroLog } = await supabase.from("os_status_log").insert({
    id_int: idInt,
    status_anterior: statusLido,
    status_novo: STATUS_APOS_RETIRAR,
    resultado: "sucesso",
    motivo: "Retirado da fila de Produção: o pedido voltou para o atendente (is_prd_aprovado desligada e status em REVISAO ATENDENTE, na mesma gravação).",
    origem: ORIGEM_LOG_RETIRAR_PRODUCAO,
    ator_tipo: "USUARIO",
    ator_uid: autor.uid,
    ator_nome: autor.nome,
    tipo_transicao: "RETORNO"
  });
  const aviso = erroLog
    ? `O pedido foi retirado da produção e voltou ao atendente, mas o registro de autoria no log falhou (${erroLog.message}).`
    : null;
  if (erroLog) console.error(`[retirar-producao] Falha ao gravar os_status_log da proposta #${idInt}:`, erroLog.message);

  return {
    success: true,
    idempotente: false,
    message: `Proposta #${idInt} retirada da produção e devolvida ao atendente.`,
    statusAnterior: statusLido,
    logGravado: !erroLog,
    aviso
  };
}
