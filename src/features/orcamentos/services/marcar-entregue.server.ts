import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ORIGEM_LOG_ATALHO_ENTREGUE,
  STATUS_DESTINO_ATALHO_ENTREGUE,
  STATUS_LEGADO_APROVADO,
  STATUS_ORIGEM_ATALHO_ENTREGUE,
  diaDaMarcacaoSaoPaulo,
  statusDePartidaDoAtalhoEntregue,
  travaDoAprovado
} from "@/features/orcamentos/lib/marcar-entregue";
import { notasQueImpedemDevolucao, rotuloDaNota } from "@/features/orcamentos/lib/nota-impede-devolucao";
import { lerNotasDoPedido } from "@/features/orcamentos/services/nota-impede-devolucao.server";

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
 * DOIS ESTADOS DE PARTIDA (13/10/2026): LIBERADO, como sempre, e REVISAO ATENDENTE
 * com `libera_nf` ligada e `is_prd_aprovado` desligada (pedido na Fila de Faturamento
 * sem producao). No segundo, o UPDATE do passo 2 e guardado tambem pelas duas flags.
 * Em LIBERADO a guarda e a de antes, so o status.
 *
 * APROVADO (15/10/2026): o legado de LIBERADO tambem parte daqui, mas antes de gravar
 * o servidor recusa com a flag de producao ligada, com OS ou setores de OS, ou com
 * NF-e/NFS-e autorizada de producao (409 JA_NA_PRODUCAO, TEM_OS, NOTA_EMITIDA). Sem
 * conseguir ler OS ou notas, recusa (500). O UPDATE do passo 2 e guardado tambem pela
 * flag de producao lida. LIBERADO e REVISAO ATENDENTE nao passam por essas travas.
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
  return supabase.from("propostas").select("id_int, status_interno, libera_nf, is_prd_aprovado").eq("id_int", idInt).maybeSingle();
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
  // De onde o atalho parte: LIBERADO, ou REVISAO ATENDENTE na Fila de Faturamento sem producao.
  const statusOrigem = statusDePartidaDoAtalhoEntregue({
    statusInterno: proposta.status_interno,
    liberaNf: proposta.libera_nf,
    isPrdAprovado: proposta.is_prd_aprovado
  });
  if (statusOrigem === null) {
    return {
      success: false,
      httpStatus: 409,
      code: "STATUS_NAO_LIBERADO",
      message:
        `Só dá para marcar como entregue o pedido LIBERADO (ou APROVADO, o mesmo "Liberado" da tela) ou o que está na Fila de ` +
        `Faturamento sem produção (REVISAO ATENDENTE, enviado à fila e não liberado para a produção). A proposta #${idInt} está em ${statusAtual || "sem status"}.`
    };
  }
  const partiuDoAprovado = statusOrigem === STATUS_LEGADO_APROVADO;
  const partiuDaFila = statusOrigem !== STATUS_ORIGEM_ATALHO_ENTREGUE && !partiuDoAprovado;
  const flagProducaoLida = proposta.is_prd_aprovado as boolean | null;

  // ── APROVADO: as travas a mais (producao, OS, nota), antes de qualquer escrita ──
  if (partiuDoAprovado) {
    const pelaFlag = travaDoAprovado({ isPrdAprovado: proposta.is_prd_aprovado });
    if (pelaFlag) return { success: false, httpStatus: 409, code: pelaFlag.code, message: pelaFlag.message };
    const [os, setores, notas] = await Promise.all([
      supabase.from("propostas_os").select("id_int").eq("id_int", idInt).limit(1),
      supabase.from("propostas_os_setores").select("id_int").eq("id_int", idInt).limit(1),
      lerNotasDoPedido(supabase, idInt)
    ]);
    const erroOs = os.error ?? setores.error;
    if (erroOs) {
      return { success: false, httpStatus: 500, code: "LEITURA_OS_FALHOU", message: `Não foi possível conferir a OS do pedido (${erroOs.message}). Nada foi alterado.` };
    }
    if (!notas.ok) {
      return { success: false, httpStatus: 500, code: "LEITURA_NOTAS_FALHOU", message: `Não foi possível conferir as notas fiscais do pedido (${notas.erro}). Nada foi alterado.` };
    }
    const trava = travaDoAprovado({
      isPrdAprovado: proposta.is_prd_aprovado,
      temOs: Boolean(os.data?.length) || Boolean(setores.data?.length),
      notasEmitidas: Array.from(new Set(notasQueImpedemDevolucao(notas.notas).map(rotuloDaNota)))
    });
    if (trava) return { success: false, httpStatus: 409, code: trava.code, message: trava.message };
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
        message: `Não foi possível gravar a data de entrega (${erroInsert.message}). Nada foi alterado; o pedido segue ${statusOrigem}.`
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
        message: `Não foi possível gravar a data de entrega (${erroUpdate.message}). Nada foi alterado; o pedido segue ${statusOrigem}.`
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
  let consultaStatus = supabase
    .from("propostas")
    .update({ status_interno: STATUS_DESTINO_ATALHO_ENTREGUE })
    .eq("id_int", idInt)
    .eq("status_interno", statusOrigem);
  if (partiuDaFila) {
    // Partindo da Fila sem producao, as duas flags tambem guardam: se o pedido foi liberado para a producao no meio, nao grava.
    consultaStatus = consultaStatus.eq("libera_nf", true);
    consultaStatus = flagProducaoLida === null ? consultaStatus.is("is_prd_aprovado", null) : consultaStatus.eq("is_prd_aprovado", flagProducaoLida);
  }
  if (partiuDoAprovado) {
    // APROVADO: a flag de producao lida tambem guarda.
    consultaStatus = flagProducaoLida === null ? consultaStatus.is("is_prd_aprovado", null) : consultaStatus.eq("is_prd_aprovado", flagProducaoLida);
  }
  const { data: gravado, error: erroStatus } = await consultaStatus.select("id_int");

  if (erroStatus) {
    const falhaAoDesfazer = await desfazerData();
    return {
      success: false,
      httpStatus: 500,
      code: "STATUS_NAO_GRAVADO",
      message: falhaAoDesfazer
        ? `Não foi possível mudar o status (${erroStatus.message}) e a data de entrega gravada não pôde ser desfeita (${falhaAoDesfazer}). ` +
          `Estado inconsistente na proposta #${idInt}: confira expedicoes.data_entrega e corrija pelo "Editar dados de expedição".`
        : `Não foi possível mudar o status (${erroStatus.message}). Nada foi alterado; o pedido segue ${statusOrigem}.`
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
    (partiuDaFila
      ? `Entrega marcada pelo atalho do ADM em pedido que foi só à Fila de Faturamento, sem Produção nem Expedição. `
      : partiuDoAprovado
        ? `Entrega marcada pelo atalho do ADM em pedido APROVADO (legado de LIBERADO), sem produção, OS nem nota emitida. `
        : `Entrega marcada pelo atalho da lista de Pedidos (paliativo da migração: o pedido terminou no sistema antigo). `) +
    `Dia da marcação: ${dia}. ` +
    (gravouData ? "data_entrega gravada agora." : "data_entrega já existia e foi mantida.");

  const { error: erroLog } = await supabase.from("os_status_log").insert({
    id_int: idInt,
    status_anterior: statusOrigem,
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
