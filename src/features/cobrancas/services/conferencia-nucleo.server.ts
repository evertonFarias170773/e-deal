/**
 * Núcleo da conferência de uma cobrança (16/10/2026).
 *
 * Os passos que vêm DEPOIS da validação, comuns ao clique "Confirmar
 * Conferência" (`POST /api/cobrancas/confirmar`, com usuário) e à conferência
 * automática (`lib/conferencia-automatica`, chave de serviço, sem usuário):
 *
 *   - o payload da confirmação (confirmado, confirmado_por, data_confirmacao e,
 *     quando cabe, a quitação);
 *   - o que acontece depois da gravação: abatimento da Conta Corrente,
 *     reconciliação do status pela engine e liberação automática de prateleira.
 *
 * Saíram da rota sem mudança de lógica. A rota continua dona da permissão, das
 * recusas e do UPDATE; quem chama aqui já gravou a confirmação.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { quitaNaLiberacao } from "@/features/cobrancas/cobrancas-utils";
import { aplicarStatusRecomendadoProposta } from "@/features/orcamentos/services/status-writer.service";
import { validarStatusProposta } from "@/features/orcamentos/services/status-shadow.service";
import { liberarPropostaParaProducao, sendPropostaChatMessage } from "@/features/orcamentos/services/orcamentos.service";
import { linhaDaDivergencia } from "@/features/orcamentos/lib/divergencia-lotes";

/** O aviso que a tela grava no chat ao confirmar (ConfirmarLiberacaoModal). */
export const MENSAGEM_CHAT_COBRANCA_CONFERIDA =
  "Cobrança conferida e liberada para os próximos fluxos operacionais: expedição, fiscal, boletos e produção.";

/** Autoria do carimbo automático — mesmo formato de `APROVADOR_AUTOMATICO`. */
const LIBERADOR_AUTOMATICO = "Sistema - produto de prateleira";

type CobrancaParaConferir = {
  id_int?: number | null;
  id_cliente?: number | null;
  status?: string | null;
  tipo_cobranca?: string | null;
  paid_at?: string | null;
  reserva_estado?: string | null;
  id_pendencia?: number | string | null;
  chave_reserva?: string | null;
  obs_v2?: string | null;
};

/**
 * Payload do "Confirmar Conferência" (a ação normal, não a autorização de
 * faturamento nem o "autorizar e conferir").
 */
export function montarPayloadConfirmacao(
  cobranca: CobrancaParaConferir,
  confirmadoPor: string,
  agoraIso: string
): Record<string, unknown> {
  const payloadUpdate: Record<string, unknown> = {};
  payloadUpdate.confirmado = true;
  payloadUpdate.confirmado_por = confirmadoPor;
  payloadUpdate.data_confirmacao = agoraIso;
  if (cobranca.status === "A_RECEBER") {
    payloadUpdate.status = "PAID";
  } else if (cobranca.status === "A_VENCER" && quitaNaLiberacao(cobranca.tipo_cobranca ?? "")) {
    // E-Permuta, E-Amostra e E-Retrabalho não geram título: a confirmação
    // do financeiro É a quitação. Sem isto ficavam em A_VENCER para
    // sempre, esperando um recebimento que não existe — e a proposta
    // nunca fechava a cobertura integral.
    //
    // O E-FATURADO NÃO entra aqui de propósito: ele continua A_VENCER
    // depois de conferido, porque quem liquida é o título do Registro de
    // Recebíveis. `valor` não é tocado em nenhum dos casos.
    payloadUpdate.status = "PAID";
    payloadUpdate.paid_at = cobranca.paid_at ?? agoraIso;
  }
  return payloadUpdate;
}

/**
 * Tudo o que vem depois de a confirmação estar gravada. Best-effort: nada aqui
 * derruba a confirmação.
 */
export async function executarPosConfirmacao(
  supabase: SupabaseClient,
  cobranca: CobrancaParaConferir,
  opcoes: {
    idCobranca: string;
    confirmadoPor: string | null | undefined;
    /** Autor da reconciliação de status (o nome vai para o chat da engine). */
    autorReconciliacao: { uid: string; nome: string; email: string };
    /** Autor da liberação de prateleira. */
    usuarioPrateleira: { uid: string; email: string };
  }
): Promise<void> {
  const { idCobranca, confirmadoPor } = opcoes;

  // ── 6. Abatimento de débito da conta corrente ──────────────────────────
  // Se esta cobrança foi criada incluindo abatimento de débito (marcador em
  // obs_v2, gravado por PropostaCobrancaPanel), o crédito na conta corrente
  // só é registrado agora — quando o pagamento é de fato confirmado, nunca
  // no momento da criação da cobrança (evita creditar dinheiro não recebido).
  if (cobranca.reserva_estado === "RESERVA_ATIVA" && cobranca.id_pendencia && cobranca.chave_reserva) {
    // Caminho novo (Conta Corrente — Pendências Financeiras): a reserva foi
    // feita na criação da cobrança via cc_usar_pendencia(RESERVA_DEBITO).
    // Confirmar aqui grava o USO_PEDIDO na razão via cc_encerrar_pendencia —
    // nunca antes do recebimento real.
    const { error: rpcError } = await supabase.rpc("cc_encerrar_pendencia", {
      p_id_pendencia: cobranca.id_pendencia,
      p_modo: "CONFIRMAR_RESERVA",
      p_valor: null,
      p_id_movimento_ref: null,
      p_chave_reserva: cobranca.chave_reserva,
      p_motivo: null,
      p_observacao: `Confirmado via cobrança ${idCobranca}. Operador: ${confirmadoPor || "Sistema"}.`,
    });
    if (rpcError) {
      console.error("[confirmar] Falha ao confirmar reserva de débito:", rpcError.message);
    }
  } else {
    // Fallback legado: cobranças criadas antes deste refactor, com o
    // marcador [ABATIMENTO_DEBITO:x] em obs_v2 e sem reserva formal.
    // Escrita via RPC `mc_confirmar_abatimento_legado` (SECURITY DEFINER)
    // — nunca por INSERT direto (revogado de `authenticated` no cutover).
    // Idempotência determinística: chave é o próprio id do pagamento
    // (único), via ux_mc_abatimento_legado_unico — a RPC é quem decide
    // se já foi registrado, não mais um ilike sobre a observação.
    const marcador = String(cobranca.obs_v2 || "").match(/\[ABATIMENTO_DEBITO:(\d+(?:\.\d{1,2})?)\]/);
    if (marcador && cobranca.id_cliente) {
      const valorAbatimento = Math.round(parseFloat(marcador[1]) * 100) / 100;
      if (valorAbatimento > 0) {
        const obsMovimento = `Abatimento de débito via cobrança confirmada (pagamento ${idCobranca}${cobranca.id_int ? `, proposta #${cobranca.id_int}` : ""}). Operador: ${confirmadoPor || "Sistema"}.`;
        const { error: rpcErrorLegado } = await supabase.rpc("mc_confirmar_abatimento_legado", {
          p_id_cliente: cobranca.id_cliente,
          p_id_int: cobranca.id_int ?? null,
          p_id_pagamento: idCobranca,
          p_valor: valorAbatimento,
          p_observacao: obsMovimento,
        });

        if (rpcErrorLegado) {
          console.error("[confirmar] Falha ao registrar abatimento de débito:", rpcErrorLegado.message);
        }
      }
    }
  }

  // ── 7. Reconciliar status_interno pelo fluxo oficial ─────────────────────
  // Confirmação de pagamento é um dos eventos que exigem reavaliação (nunca
  // confiar em formState.status do cliente). Best-effort: nunca falha a
  // confirmação do pagamento em si.
  if (cobranca.id_int) {
    const reconciliacao = await aplicarStatusRecomendadoProposta(
      cobranca.id_int,
      opcoes.autorReconciliacao,
      supabase,
      "AUTO_FINANCEIRO"
    );
    if (!reconciliacao.success) {
      console.warn(`[confirmar] Reconciliação de status sem efeito para proposta #${cobranca.id_int}: ${reconciliacao.errorMessage}`);
    }

    // ── 8. Prateleira: liberação automática para Produção ─────────────────
    await liberarPrateleiraAutomaticamente(supabase, cobranca.id_int, opcoes.usuarioPrateleira);
  }
}

/**
 * Proposta 100% de prateleira segue direto para REVISAO PRODUCAO.
 *
 * POR QUE EXISTE
 *   REVISAO ATENDENTE é uma conferência: alguém olha antes de o pedido entrar
 *   na fábrica. Em proposta só de prateleira não há arte para conferir nem
 *   produção a preparar — a etapa vira um clique obrigatório sem decisão.
 *
 * POR QUE AQUI, E NÃO NA ENGINE DE STATUS
 *   O gatilho é a CONFIRMAÇÃO da cobrança, uma vez só, no instante em que a
 *   proposta acaba de ficar coberta. Pendurar na engine faria a avaliação
 *   acontecer em toda passagem dela, e aí uma proposta que o gerente devolveu
 *   da produção (`devolverPropostaParaRevisaoAtendente`) seria religada
 *   sozinha na confirmação seguinte, desfazendo a decisão dele.
 *
 *   Uma trava contra isso não é construível: nas 7 devoluções reais dos
 *   últimos 120 dias, `liberado_producao_em` está nulo em 6, `libera_nf` é
 *   false em 6, e `is_prd_aprovado` ficou true em 4 — ou seja, há caminho de
 *   volta que não passa pela função conhecida. E `audit.logs_v2` não tem grant
 *   para `authenticated`, então o histórico também não está ao alcance.
 *
 *   Aqui o problema simplesmente não existe: não há reavaliação. Devolveu,
 *   ficou devolvida.
 *
 * O CRITÉRIO NÃO É RECALCULADO
 *   `arteDispensada` e a cobertura integral saem de `validarStatusProposta`, a
 *   mesma engine que decide o status. `statusRecomendado === 'REVISAO
 *   ATENDENTE'` com `arteDispensada` já significa, junto, "100% prateleira E
 *   coberta por inteiro" — escrever de novo qualquer uma das duas regras aqui
 *   seria a terceira cópia, e a terceira chance de divergir.
 *
 * NUNCA DERRUBA A CONFIRMAÇÃO
 *   Tudo dentro de try/catch que só registra. A cobrança já está confirmada e
 *   gravada quando chegamos aqui; qualquer falha desta função deixa a proposta
 *   em REVISAO ATENDENTE, exatamente onde ela estaria sem automação nenhuma, e
 *   o atendente libera pelo botão de sempre.
 */
export async function liberarPrateleiraAutomaticamente(
  supabase: SupabaseClient,
  idInt: number,
  usuario: { uid: string; email: string }
): Promise<void> {
  try {
    const { data: proposta } = await supabase
      .from("propostas")
      .select("status_interno, is_avulso")
      .eq("id_int", idInt)
      .maybeSingle<{ status_interno: string | null; is_avulso: boolean | null }>();

    if (!proposta) return;
    if (proposta.is_avulso === true) return;

    // Só age na janela exata. REVISAO PRODUCAO ou adiante: nada a fazer — e a
    // própria `liberarPropostaParaProducao` recusaria de qualquer forma.
    if (String(proposta.status_interno || "").trim().toUpperCase() !== "REVISAO ATENDENTE") return;

    // `false` literal: proposta avulsa já saiu no guard acima.
    const diagnostico = await validarStatusProposta(
      idInt,
      false,
      proposta.status_interno || "",
      supabase
    );

    if (!diagnostico) return;
    if (diagnostico.statusRecomendado !== "REVISAO ATENDENTE") return;
    if (diagnostico.evidenciasUsadas?.arteDispensada !== true) return;

    const liberacao = await liberarPropostaParaProducao(idInt, supabase);

    if (!liberacao.success) {
      console.warn(
        `[confirmar] Liberação automática recusada para #${idInt}: ${liberacao.errorMessage}. ` +
        `A proposta segue em REVISAO ATENDENTE para liberação manual.`
      );

      // Trava de quantidade (Etapa 7): a recusa não pode ficar só no log do
      // servidor, senão o atendente vê a proposta parada sem saber por quê. O
      // status NÃO muda — a proposta fica em REVISAO ATENDENTE, como sempre que
      // a automação não libera — e o chat diz o que acertar.
      if (liberacao.code === "LOTES_DIVERGENTES") {
        await sendPropostaChatMessage({
          id_int: idInt,
          mensagem:
            "Liberação automática para Produção RECUSADA: a quantidade vendida não bate com a soma dos lotes.\n" +
            (liberacao.divergencias || []).map(linhaDaDivergencia).join("\n") +
            "\nA proposta segue em [REVISAO ATENDENTE]. Acerte os lotes na aba Pedido e libere pelo botão de sempre.",
          tipo: "SISTEMA",
          autor_uid: usuario.uid || null,
          autor_nome: LIBERADOR_AUTOMATICO,
          autor_email: usuario.email || null,
          setor: "AUTO_FINANCEIRO",
          avatar: null,
          visivel_externo: false,
          anexos: null,
          id_cliente: null
        });
      }
      return;
    }

    await sendPropostaChatMessage({
      id_int: idInt,
      mensagem:
        "Liberado automaticamente para Produção: todos os itens são produtos de prateleira, " +
        "então não há arte a aprovar nem conferência de atendente a fazer. " +
        "Status alterado de [REVISAO ATENDENTE] para [REVISAO PRODUCAO].",
      tipo: "SISTEMA",
      autor_uid: usuario.uid || null,
      autor_nome: LIBERADOR_AUTOMATICO,
      autor_email: usuario.email || null,
      setor: "AUTO_FINANCEIRO",
      avatar: null,
      visivel_externo: false,
      anexos: null,
      id_cliente: null
    });
  } catch (erro) {
    console.warn(`[confirmar] Falha na liberação automática de prateleira em #${idInt}:`, erro);
  }
}
