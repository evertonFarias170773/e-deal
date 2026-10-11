import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ORIGEM_LOG_ATALHO_ENTREGUE,
  STATUS_DESTINO_ATALHO_ENTREGUE,
  STATUS_ORIGEM_ATALHO_ENTREGUE,
  diaDaMarcacaoSaoPaulo
} from "@/features/orcamentos/lib/marcar-entregue";

/**
 * Grava o atalho "Marcar como entregue" (11/10/2026). Roda no SERVIDOR, com a
 * sessao do usuario; quem chama (a rota) ja conferiu que ele e ADM. Ver o
 * cabecalho de `lib/marcar-entregue.ts` para o que e e por que existe.
 *
 * A ORDEM DAS ESCRITAS
 *   1. `expedicoes.data_entrega` — a linha NAO existe para pedido LIBERADO
 *      (nenhum tem), entao e um INSERT simples; se a linha ja existe sem data, so
 *      a data e gravada, e uma data existente nunca e sobrescrita. Vem ANTES do
 *      status de proposito: se falhar, nada mais mudou e o pedido segue LIBERADO.
 *   2. `propostas.status_interno` LIBERADO -> ENTREGUE, UPDATE guardado pelo
 *      proprio status. E a trava de idempotencia e de corrida: so um clique vence.
 *      Se o status ja nao e LIBERADO, a data gravada no passo 1 e DESFEITA (so se
 *      foi este atalho que a gravou) — o pedido nunca fica com data de entrega e
 *      status de antes.
 *   3. `os_status_log` — a autoria. Falhar aqui nao desfaz as outras duas (a
 *      trilha e observabilidade), mas a resposta AVISA, nao fica silencioso.
 *
 * O que NAO e tocado: `data_despacho` (os tres gatilhos de `expedicoes` so agem
 * quando ela muda), frete, financeiro, cobrancas, boletos, `encerrado_teste_em`.
 */

export type ResultadoMarcarEntregue =
  | { success: true; idempotente: true; message: string }
  | {
      success: true;
      idempotente: false;
      message: string;
      /** `expedicoes.data_entrega` do pedido depois da acao (a nova, ou a que ja existia). */
      dataEntrega: string;
      dataEntregaGravadaAgora: boolean;
      linhaDeExpedicaoCriada: boolean;
      logGravado: boolean;
      /** Preenchido quando algo ficou pela metade e a pessoa precisa saber. */
      aviso: string | null;
    }
  | { success: false; httpStatus: number; code: string; message: string };

type Cliente = SupabaseClient;

const CODIGO_VIOLACAO_UNICA = "23505";

async function lerStatus(supabase: Cliente, idInt: number) {
  return supabase.from("propostas").select("id_int, status_interno").eq("id_int", idInt).maybeSingle();
}

export async function marcarPedidoComoEntregue(
  supabase: Cliente,
  entrada: { idInt: number; autor: { uid: string; nome: string }; agora?: Date }
): Promise<ResultadoMarcarEntregue> {
  const { idInt, autor } = entrada;
  const agora = entrada.agora ?? new Date();
  const instante = agora.toISOString();

  // ── Leitura: o pedido tem de existir e estar LIBERADO ──────────────────────
  const { data: proposta, error: erroProposta } = await lerStatus(supabase, idInt);
  if (erroProposta) {
    return { success: false, httpStatus: 500, code: "LEITURA_FALHOU", message: erroProposta.message || "Erro ao ler a proposta." };
  }
  if (!proposta) {
    return { success: false, httpStatus: 404, code: "NAO_ENCONTRADA", message: `Proposta #${idInt} não encontrada.` };
  }

  const statusAtual = String(proposta.status_interno ?? "").trim().toUpperCase();
  if (statusAtual === STATUS_DESTINO_ATALHO_ENTREGUE) {
    // Repetir o clique (ou outra pessoa ter chegado primeiro): nada a gravar.
    return { success: true, idempotente: true, message: `A proposta #${idInt} já está ENTREGUE. Nada foi gravado.` };
  }
  if (statusAtual !== STATUS_ORIGEM_ATALHO_ENTREGUE) {
    return {
      success: false,
      httpStatus: 409,
      code: "STATUS_NAO_LIBERADO",
      message: `Só dá para marcar como entregue o pedido LIBERADO. A proposta #${idInt} está em ${statusAtual || "sem status"}.`
    };
  }

  // ── 1. expedicoes.data_entrega ─────────────────────────────────────────────
  const { data: expedicao, error: erroExpedicao } = await supabase
    .from("expedicoes")
    .select("id_int, data_entrega")
    .eq("id_int", idInt)
    .maybeSingle();
  if (erroExpedicao) {
    return { success: false, httpStatus: 500, code: "LEITURA_EXPEDICAO_FALHOU", message: erroExpedicao.message || "Erro ao ler a expedição." };
  }

  let dataEntrega: string | null = expedicao?.data_entrega ?? null;
  let gravouData = false;
  let criouLinha = false;

  if (!expedicao) {
    const { error: erroInsert } = await supabase.from("expedicoes").insert({ id_int: idInt, data_entrega: instante });
    if (!erroInsert) {
      dataEntrega = instante;
      gravouData = true;
      criouLinha = true;
    } else if (erroInsert.code === CODIGO_VIOLACAO_UNICA) {
      // Outra escrita criou a linha entre a leitura e o INSERT: segue pelo caminho da linha existente.
      const { data: criada } = await supabase.from("expedicoes").select("id_int, data_entrega").eq("id_int", idInt).maybeSingle();
      dataEntrega = criada?.data_entrega ?? null;
    } else {
      return {
        success: false,
        httpStatus: 500,
        code: "EXPEDICAO_NAO_GRAVADA",
        message: `Não foi possível gravar a data de entrega (${erroInsert.message}). Nada foi alterado; o pedido segue LIBERADO.`
      };
    }
  }

  if (!criouLinha && dataEntrega === null) {
    // A linha existe sem data: grava so a data, e so se ainda estiver vazia.
    const { data: gravadas, error: erroUpdate } = await supabase
      .from("expedicoes")
      .update({ data_entrega: instante, updated_at: instante })
      .eq("id_int", idInt)
      .is("data_entrega", null)
      .select("id_int");
    if (erroUpdate) {
      return {
        success: false,
        httpStatus: 500,
        code: "EXPEDICAO_NAO_GRAVADA",
        message: `Não foi possível gravar a data de entrega (${erroUpdate.message}). Nada foi alterado; o pedido segue LIBERADO.`
      };
    }
    if (gravadas && gravadas.length > 0) {
      dataEntrega = instante;
      gravouData = true;
    } else {
      // Alguém gravou a data nesse intervalo: vale a dele, sem sobrescrever.
      const { data: atual } = await supabase.from("expedicoes").select("id_int, data_entrega").eq("id_int", idInt).maybeSingle();
      dataEntrega = atual?.data_entrega ?? null;
    }
  }

  /** Desfaz a data SO se foi este atalho que a gravou, e so enquanto ela ainda e a nossa. */
  const desfazerData = async (): Promise<string | null> => {
    if (!gravouData) return null;
    const { error } = await supabase
      .from("expedicoes")
      .update({ data_entrega: null, updated_at: new Date().toISOString() })
      .eq("id_int", idInt)
      .eq("data_entrega", instante)
      .select("id_int");
    return error ? error.message : null;
  };

  // ── 2. propostas.status_interno, guardado por LIBERADO ─────────────────────
  const { data: gravado, error: erroStatus } = await supabase
    .from("propostas")
    .update({ status_interno: STATUS_DESTINO_ATALHO_ENTREGUE })
    .eq("id_int", idInt)
    .eq("status_interno", STATUS_ORIGEM_ATALHO_ENTREGUE)
    .select("id_int");

  if (erroStatus) {
    const falhaAoDesfazer = await desfazerData();
    return {
      success: false,
      httpStatus: 500,
      code: "STATUS_NAO_GRAVADO",
      message: falhaAoDesfazer
        ? `Não foi possível mudar o status (${erroStatus.message}) e a data de entrega gravada não pôde ser desfeita (${falhaAoDesfazer}). ` +
          `Estado inconsistente na proposta #${idInt}: confira expedicoes.data_entrega e corrija pelo "Editar dados de expedição".`
        : `Não foi possível mudar o status (${erroStatus.message}). Nada foi alterado; o pedido segue LIBERADO.`
    };
  }

  if (!gravado || gravado.length === 0) {
    // O status mudou entre a leitura e a gravacao.
    const { data: agoraNoBanco } = await lerStatus(supabase, idInt);
    const statusAgora = String(agoraNoBanco?.status_interno ?? "").trim().toUpperCase();
    if (statusAgora === STATUS_DESTINO_ATALHO_ENTREGUE) {
      // Outro clique (ou a Expedição) chegou primeiro: ficou ENTREGUE, e quem gravou a data foi um so.
      return { success: true, idempotente: true, message: `A proposta #${idInt} já está ENTREGUE. Nada foi gravado.` };
    }
    const falhaAoDesfazer = await desfazerData();
    return {
      success: false,
      httpStatus: 409,
      code: "STATUS_MUDOU",
      message: falhaAoDesfazer
        ? `O pedido mudou de status para ${statusAgora || "sem status"} durante a ação e a data de entrega gravada não pôde ser desfeita (${falhaAoDesfazer}). ` +
          `Estado inconsistente na proposta #${idInt}: confira expedicoes.data_entrega.`
        : `O pedido mudou de status para ${statusAgora || "sem status"} durante a ação. Nada foi alterado.`
    };
  }

  // ── 3. os_status_log: a autoria ────────────────────────────────────────────
  const dia = diaDaMarcacaoSaoPaulo(agora);
  const motivo =
    `Entrega marcada pelo atalho da lista de Pedidos (paliativo da migração: o pedido terminou no sistema antigo). ` +
    `Dia da marcação: ${dia}. ` +
    (gravouData ? "data_entrega gravada agora." : "data_entrega já existia e foi mantida.");

  const { error: erroLog } = await supabase.from("os_status_log").insert({
    id_int: idInt,
    status_anterior: STATUS_ORIGEM_ATALHO_ENTREGUE,
    status_novo: STATUS_DESTINO_ATALHO_ENTREGUE,
    resultado: "sucesso",
    motivo,
    origem: ORIGEM_LOG_ATALHO_ENTREGUE,
    ator_tipo: "USUARIO",
    ator_uid: autor.uid,
    ator_nome: autor.nome,
    tipo_transicao: "NATURAL"
  });

  const aviso = erroLog
    ? `O pedido foi marcado como ENTREGUE e a data foi gravada, mas o registro de autoria no log falhou (${erroLog.message}).`
    : null;
  if (erroLog) console.error(`[marcar-entregue] Falha ao gravar os_status_log da proposta #${idInt}:`, erroLog.message);

  return {
    success: true,
    idempotente: false,
    message: `Proposta #${idInt} marcada como ENTREGUE.`,
    dataEntrega: dataEntrega ?? instante,
    dataEntregaGravadaAgora: gravouData,
    linhaDeExpedicaoCriada: criouLinha,
    logGravado: !erroLog,
    aviso
  };
}
