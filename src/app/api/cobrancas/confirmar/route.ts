import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { calcularSituacaoQuitacaoProposta } from "@/features/cobrancas/services/conferencia-financeira.service";
import { quitaNaLiberacao } from "@/features/cobrancas/cobrancas-utils";
import { aplicarStatusRecomendadoProposta } from "@/features/orcamentos/services/status-writer.service";
import { validarStatusProposta } from "@/features/orcamentos/services/status-shadow.service";
import { liberarPropostaParaProducao, sendPropostaChatMessage } from "@/features/orcamentos/services/orcamentos.service";
import { linhaDaDivergencia } from "@/features/orcamentos/lib/divergencia-lotes";
import {
  CODIGO_CANCELADA_E_PAGA,
  MENSAGEM_CANCELADA_E_PAGA,
  confirmacaoDeveSerRecusada
} from "@/features/cobrancas/lib/cancelada-que-consta-paga";
import {
  ACAO_AUTORIZAR_E_CONFERIR,
  montarPayloadAutorizarEConferir,
  podeAutorizarEConferir
} from "@/features/cobrancas/lib/autorizar-e-conferir";
import type { SupabaseClient } from "@supabase/supabase-js";

type UsuarioMinRow = {
  id_perfil: number | null;
  is_super_adm: boolean;
  is_admin: boolean;
};

type PerfilMinRow = {
  permissoes: string[];
};

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!token) {
    return NextResponse.json({ success: false, error: "Sessão não encontrada." }, { status: 401 });
  }
  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, error: "Sessão inválida." }, { status: 401 });
  }
  const userId = authData.user.id;

  // 1. Validar permissão (conferencia.confirm)
  let temPermissao = false;
  // cobrancas.aprovar (ou administrador): quem abre a Análise de Faturamento.
  // Só a ação "autorizar e conferir" exige, além de conferencia.confirm.
  let temAprovarCobranca = false;
  {
    const { data: usuarioData } = await supabase
      .from("usuarios")
      .select("id_perfil, is_super_adm, is_admin")
      .eq("user_id", userId)
      .maybeSingle();

    if (usuarioData) {
      const row = usuarioData as UsuarioMinRow;
      if (row.is_super_adm || row.is_admin) {
        temPermissao = true;
        temAprovarCobranca = true;
      } else if (row.id_perfil != null) {
        const { data: perfilData } = await supabase
          .from("perfis")
          .select("permissoes")
          .eq("id", row.id_perfil)
          .eq("ativo", true)
          .maybeSingle();
        if (perfilData) {
          const permissoes: string[] = Array.isArray(perfilData.permissoes) ? perfilData.permissoes : [];
          temPermissao = permissoes.includes("*") || permissoes.includes("conferencia.confirm");
          temAprovarCobranca = permissoes.includes("*") || permissoes.includes("cobrancas.aprovar");
        }
      }
    }
  }

  if (!temPermissao) {
    return NextResponse.json({ success: false, error: "Sem permissão para confirmar cobrança." }, { status: 403 });
  }

  // 2. Body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }

  const { idCobranca, confirmadoPor, acao } = body;
  if (!idCobranca) {
    return NextResponse.json({ success: false, error: "idCobranca obrigatório." }, { status: 400 });
  }

  // "Autorizar e conferir" (10/10/2026, ver lib/autorizar-e-conferir): a
  // permissão é checada AQUI, não só no botão. Quem confere (conferencia.confirm,
  // acima) tem de poder também autorizar (cobrancas.aprovar ou administrador),
  // e a autoria precisa de nome: confirmado_por é obrigatório no banco.
  const ehAutorizarEConferir = acao === ACAO_AUTORIZAR_E_CONFERIR;
  if (ehAutorizarEConferir) {
    if (!temAprovarCobranca) {
      return NextResponse.json(
        { success: false, error: "Sem permissão para autorizar faturamento." },
        { status: 403 }
      );
    }
    if (!String(confirmadoPor ?? "").trim()) {
      return NextResponse.json({ success: false, error: "Informe quem está autorizando." }, { status: 400 });
    }
  }

  try {
    // 3. Revalidação da cobrança
    const { data: cobranca, error: cobError } = await supabase
      .from("pagamentos_v2")
      .select("*")
      .eq("id", idCobranca)
      .single();

    if (cobError || !cobranca) {
      return NextResponse.json({ success: false, error: "Cobrança não encontrada." }, { status: 404 });
    }

    // Cobrança cancelada — ou que FOI cancelada e voltou a constar como paga —
    // não é confirmada (09/10/2026). O caso real: o vendedor cancela, o PIX
    // segue valendo no banco, o cliente paga e a integração grava PAID sem
    // olhar o status; a cobrança reaparece na fila como paga, e em quatro
    // pedidos o cliente tinha pago duas vezes. O rastro é `motivo_cancela`, que
    // só é gravado no cancelamento e que a reativação oficial limpa. Vem antes
    // de tudo, inclusive do retorno "já estava confirmada": confirmar uma
    // dessas não pode responder sucesso. A regra mora em
    // lib/cancelada-que-consta-paga.
    if (confirmacaoDeveSerRecusada(cobranca)) {
      return NextResponse.json(
        { success: false, code: CODIGO_CANCELADA_E_PAGA, error: MENSAGEM_CANCELADA_E_PAGA },
        { status: 409 }
      );
    }

    if (cobranca.status === "CANCELADO" || cobranca.status === "CANCELADA" || cobranca.status === "EXTORNADO" || cobranca.status === "RECUSADO") {
      return NextResponse.json({ success: false, error: "Não é possível confirmar uma cobrança com status inválido." }, { status: 400 });
    }

    const isAutorizacao = acao === "autorizar_faturamento";
    if (!isAutorizacao && cobranca.confirmado) {
      // Idempotente. `jaConfirmada` deixa quem chamou saber que NÃO foi esta
      // chamada que confirmou (a tela não repete a mensagem do chat).
      return NextResponse.json({ success: true, jaConfirmada: true, message: "Cobrança já estava confirmada." });
    }

    // "Autorizar e conferir" só vale para faturamento que espera a autorização
    // do financeiro e que, autorizado, iria para a Fila de Conferência. Fora
    // disso o fluxo é o de sempre (Confirmar Conferência).
    if (ehAutorizarEConferir && !podeAutorizarEConferir(cobranca)) {
      return NextResponse.json(
        {
          success: false,
          code: "NAO_PENDENTE_DE_AUTORIZACAO",
          error: "Esta cobrança não está aguardando a autorização do financeiro. Atualize a lista; se ela já foi autorizada, confirme pela Fila de Conferência."
        },
        { status: 409 }
      );
    }

    // 4. Executar helper (calcularSituacaoQuitacaoProposta) para bloquear se parcial
    const situacao = await calcularSituacaoQuitacaoProposta(supabase, cobranca.id_int, idCobranca);

    // Se é uma liberação normal (não autorização) e a regra bloqueou:
    if (!isAutorizacao && !situacao.podeConfirmar) {
      return NextResponse.json({
        success: false,
        isConferenciaBloqueada: true,
        error: "Confirmação bloqueada: o valor quitado é menor que o total da proposta.",
        situacao
      }, { status: 422 });
    }

    // 5. UPDATE
    const payloadUpdate: any = {};
    if (isAutorizacao) {
      payloadUpdate.status = "A_VENCER";
      payloadUpdate.aprovado_por = confirmadoPor;
    } else if (ehAutorizarEConferir) {
      // Os dois passos num UPDATE só: a mesma soma do que a autorização e a
      // confirmação gravam separadas (ver lib/autorizar-e-conferir).
      Object.assign(
        payloadUpdate,
        montarPayloadAutorizarEConferir(cobranca, {
          confirmadoPor: String(confirmadoPor).trim(),
          agoraIso: new Date().toISOString(),
          quitaNaLiberacao: quitaNaLiberacao(cobranca.tipo_cobranca)
        })
      );
    } else {
      const agora = new Date().toISOString();
      payloadUpdate.confirmado = true;
      payloadUpdate.confirmado_por = confirmadoPor;
      payloadUpdate.data_confirmacao = agora;
      if (cobranca.status === "A_RECEBER") {
        payloadUpdate.status = "PAID";
      } else if (cobranca.status === "A_VENCER" && quitaNaLiberacao(cobranca.tipo_cobranca)) {
        // E-Permuta, E-Amostra e E-Retrabalho não geram título: a confirmação
        // do financeiro É a quitação. Sem isto ficavam em A_VENCER para
        // sempre, esperando um recebimento que não existe — e a proposta
        // nunca fechava a cobertura integral.
        //
        // O E-FATURADO NÃO entra aqui de propósito: ele continua A_VENCER
        // depois de conferido, porque quem liquida é o título do Registro de
        // Recebíveis. `valor` não é tocado em nenhum dos casos.
        payloadUpdate.status = "PAID";
        payloadUpdate.paid_at = cobranca.paid_at ?? agora;
      }
    }

    if (ehAutorizarEConferir) {
      // Só grava se a linha AINDA é a que foi lida: mesmo status e ainda não
      // confirmada. É o que faz um segundo clique (ou um clique concorrente)
      // não gerar segunda confirmação, e não pisar numa troca de status feita
      // no meio, como um cancelamento.
      const { data: gravadas, error: erroGravacao } = await supabase
        .from("pagamentos_v2")
        .update(payloadUpdate)
        .eq("id", idCobranca)
        .eq("status", cobranca.status)
        .or("confirmado.is.null,confirmado.eq.false")
        .select("id");

      if (erroGravacao) {
        throw erroGravacao;
      }

      if (!gravadas || gravadas.length === 0) {
        const { data: atual } = await supabase
          .from("pagamentos_v2")
          .select("status, confirmado")
          .eq("id", idCobranca)
          .maybeSingle();

        // Outra chamada confirmou primeiro: o mesmo desfecho do segundo clique.
        // Nada é gravado aqui — nem abatimento, nem status, nem prateleira.
        if (atual?.confirmado === true) {
          return NextResponse.json({ success: true, jaConfirmada: true, message: "Cobrança já estava confirmada." });
        }
        return NextResponse.json(
          {
            success: false,
            code: "COBRANCA_MUDOU",
            error: "A cobrança mudou enquanto era processada. Atualize a lista e confira o estado antes de tentar de novo."
          },
          { status: 409 }
        );
      }
    } else {
      const { error: updateErr } = await supabase
        .from("pagamentos_v2")
        .update(payloadUpdate)
        .eq("id", idCobranca);

      if (updateErr) {
        throw updateErr;
      }
    }

    // ── 6. Abatimento de débito da conta corrente ──────────────────────────
    // Se esta cobrança foi criada incluindo abatimento de débito (marcador em
    // obs_v2, gravado por PropostaCobrancaPanel), o crédito na conta corrente
    // só é registrado agora — quando o pagamento é de fato confirmado, nunca
    // no momento da criação da cobrança (evita creditar dinheiro não recebido).
    // "autorizar_faturamento" não é confirmação de recebimento, é só pré-aprovação
    // de faturado — não dispara o abatimento.
    if (!isAutorizacao) {
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
    }

    // ── 7. Reconciliar status_interno pelo fluxo oficial ─────────────────────
    // Confirmação de pagamento é um dos eventos que exigem reavaliação (nunca
    // confiar em formState.status do cliente). Best-effort: nunca falha a
    // confirmação do pagamento em si; "autorizar_faturamento" não é recebimento
    // real, não reconcilia aqui.
    if (!isAutorizacao && cobranca.id_int) {
      const reconciliacao = await aplicarStatusRecomendadoProposta(
        cobranca.id_int,
        { uid: userId, nome: confirmadoPor || authData.user.email || "Sistema", email: authData.user.email || "" },
        supabase,
        "AUTO_FINANCEIRO"
      );
      if (!reconciliacao.success) {
        console.warn(`[confirmar] Reconciliação de status sem efeito para proposta #${cobranca.id_int}: ${reconciliacao.errorMessage}`);
      }

      // ── 8. Prateleira: liberação automática para Produção ─────────────────
      await liberarPrateleiraAutomaticamente(
        supabase,
        cobranca.id_int,
        { uid: userId, email: authData.user.email || "" }
      );
    }

    return NextResponse.json({ success: true });

  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

/** Autoria do carimbo automático — mesmo formato de `APROVADOR_AUTOMATICO`. */
const LIBERADOR_AUTOMATICO = "Sistema - produto de prateleira";

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
async function liberarPrateleiraAutomaticamente(
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
