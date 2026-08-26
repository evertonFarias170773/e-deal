/**
 * Cancelamento de cobranca JA PAGA — caso excepcional, restrito a super admin.
 *
 * Por que uma rota separada: cancelar-externo existe para orquestrar o
 * provedor e recusa cobranca paga, protegendo milhares de registros. (Havia
 * tambem cancelar-boleto, apagada em 26/08/2026 por ser orfa e divergente.) Cobranca paga nao tem titulo em aberto para baixar no provedor
 * (o PIX ja caiu, o boleto ja liquidou) — a devolucao acontece por fora do
 * ERP. Entao este fluxo e 100% local e nasce isolado, sem afrouxar aquela
 * trava.
 *
 * Spec: docs/superpowers/specs/2026-08-11-cancelamento-cobranca-paga-design.md
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { avaliarCancelamentoNoServidor } from "@/features/cobrancas/services/cancelamento-elegibilidade.server";
import { RECUSAS_COBRANCA_PAGA } from "@/features/cobrancas/cancelamento-elegibilidade";
import {
  DESTINOS_VALOR_CANCELADO,
  isConfirmacaoDeMesAnterior,
  isDestinoValorCancelado,
  isMotivoCancelamentoPago,
  isStatusPagoParaCancelamento,
  mensagemTipoCobrancaBloqueado,
  montarMotivoCancela,
  referenciaConfirmacaoParaMesFechado,
  rotuloMotivo,
  tipoCobrancaBloqueiaCancelamentoPago
} from "@/features/cobrancas/cancelamento-pago";

const STATUS_INATIVOS = ["CANCELADO", "EXTORNADO", "RECUSADO"];

function erro(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const id = body?.id ? String(body.id) : "";
    const motivo = body?.motivo;
    const motivoTexto = body?.motivo_texto ? String(body.motivo_texto).trim() : "";
    const destino = body?.destino_valor;
    const confirmaMesFechado = body?.confirma_mes_fechado === true;

    if (!id) return erro("NAO_ENCONTRADA", "Cobranca nao informada.", 400);
    if (!isMotivoCancelamentoPago(motivo)) return erro("MOTIVO_INVALIDO", "Selecione um motivo de cancelamento.", 400);
    if (!isDestinoValorCancelado(destino)) return erro("MOTIVO_INVALIDO", "Selecione o destino do valor.", 400);
    if (motivo === "OUTRO" && !motivoTexto) {
      return erro("MOTIVO_INVALIDO", "Descreva o motivo do cancelamento.", 400);
    }

    // 1. Sessao — mesmo padrao de cancelar-externo.
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return erro("NEGADO", "Sessao invalida.", 401);

    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      }
    );

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return erro("NEGADO", "Sessao invalida.", 401);

    // 2. SO super admin. verificarPermissaoServerSide nao serve aqui: ela
    //    tambem aprova perfil que tenha a permissao, e a decisao do dono foi
    //    restringir a super admin. nome_usuario tambem e lido aqui (alem de
    //    is_super_adm) para identificar o autor real no historico da proposta
    //    no passo 11 — mesmo padrao de autor real usado em cancelar-externo.
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("is_super_adm, nome_usuario")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (!usuario?.is_super_adm) {
      return erro("NEGADO", "Somente um super administrador pode cancelar uma cobranca ja paga.", 403);
    }

    // 3. Reconsulta a cobranca: o id e a unica informacao de confianca.
    const { data: pagamento, error: pagamentoError } = await supabase
      .from("pagamentos_v2")
      .select("id, id_int, id_cliente, valor, status, confirmado, paid_at, data_confirmacao, created_at, tipo_cobranca")
      .eq("id", id)
      .maybeSingle();

    if (pagamentoError || !pagamento) {
      return erro("NAO_ENCONTRADA", "Cobranca nao encontrada.", 409);
    }

    const statusAtual = String(pagamento.status || "").trim().toUpperCase();

    // 4. Idempotencia: ja inativa e no-op.
    if (STATUS_INATIVOS.includes(statusAtual)) {
      return NextResponse.json({ success: true, alreadyCancelled: true });
    }

    // 5. Esta rota e SO para o caso excepcional da cobranca EFETIVAMENTE
    //    paga: so status PAID conta. A_VENCER e confirmado=true NAO
    //    qualificam mais — ver isStatusPagoParaCancelamento.
    if (!isStatusPagoParaCancelamento(statusAtual)) {
      return erro("NAO_PAGA", "Esta cobranca nao esta paga. Use o cancelamento normal.", 409);
    }

    // 6. Nota fiscal autorizada e producao ativa, pelo VEREDITO compartilhado
    //    (cancelamento-elegibilidade). A regra de producao morava so aqui;
    //    agora e a mesma que as outras rotas e a tela aplicam, e junto vem a
    //    checagem de NOTA FISCAL, que nenhuma rota de cancelamento fazia.
    //
    //    O subconjunto e proposital — ver RECUSAS_COBRANCA_PAGA. Nesta rota o
    //    dinheiro recebido e a PREMISSA, nao o impedimento: aplicar
    //    COBRANCA_RECEBIDA ou TITULO_LIQUIDADO aqui recusaria o proprio caso
    //    de uso (150 dos 182 boletos pagos tem titulo liquidado).
    //
    //    O coletor rele a cobranca por conta propria. E uma leitura a mais
    //    sobre a linha ja lida no passo 3, e vale o preco: o criterio fica em
    //    UM lugar so.
    const elegibilidade = await avaliarCancelamentoNoServidor(supabase, pagamento.id, RECUSAS_COBRANCA_PAGA);

    if (!elegibilidade.ok) {
      return erro(
        elegibilidade.erro === "NAO_ENCONTRADA" ? "NAO_ENCONTRADA" : "FALHA_LEITURA",
        elegibilidade.mensagem,
        elegibilidade.erro === "NAO_ENCONTRADA" ? 409 : 503
      );
    }

    if (!elegibilidade.veredito.pode) {
      const { code, message } = elegibilidade.veredito;
      // `code` do veredito ja e um codigo valido do contrato desta rota
      // (PRODUCAO_ATIVA existia; NOTA_AUTORIZADA foi acrescentado ao union em
      // CobrancasProvider). Nenhuma escrita aconteceu ate aqui.
      return erro(code, message, 409);
    }

    // 7. Faturamento ja fechado exige confirmacao explicita. Mesmo fallback
    //    de data que o dashboard financeiro usa (paid_at -> data_confirmacao
    //    -> created_at), para as cobrancas confirmadas sem os dois primeiros
    //    campos preenchidos ainda assim caiam no mes certo.
    const referencia = referenciaConfirmacaoParaMesFechado(pagamento);
    if (isConfirmacaoDeMesAnterior(referencia) && !confirmaMesFechado) {
      return erro("MES_FECHADO", "Esta cobranca foi confirmada em mes anterior. Confirme que o faturamento fechado sera alterado.", 409);
    }

    // 8. Tipo de cobranca que nunca representa dinheiro efetivamente
    //    recebido, mesmo com status PAID (E-CREDITO nasce PAID). Usa o
    //    tipo_cobranca ja trazido no SELECT do passo 3.
    const tipoBloqueado = tipoCobrancaBloqueiaCancelamentoPago(pagamento.tipo_cobranca);
    if (tipoBloqueado) {
      return erro("NAO_PAGA", mensagemTipoCobrancaBloqueado(tipoBloqueado), 409);
    }

    // 9. Credito ANTES do cancelamento: se a conta corrente falhar, nada e
    //    gravado e a cobranca continua paga. Nunca pode existir cobranca
    //    cancelada sem o credito prometido.
    let idMovimentoCredito: number | null = null;
    if (destino === "CREDITO") {
      if (pagamento.id_cliente == null) {
        return erro("FALHA_CREDITO", "Cobranca sem cliente vinculado: nao e possivel lancar credito.", 409);
      }
      const { data: movimento, error: creditoError } = await supabase.rpc("mc_ajuste_avulso_criar", {
        p_id_cliente: pagamento.id_cliente,
        p_tipo: "CREDITO",
        p_valor: Number(pagamento.valor),
        p_observacao: `Cancelamento da cobranca ${pagamento.id} (proposta ${pagamento.id_int}) - ${rotuloMotivo(motivo)}`,
        // A chave e o proprio id da cobranca: repetir a operacao nao gera
        // credito em dobro.
        p_chave_idempotencia: pagamento.id
      });

      if (creditoError) {
        return erro("FALHA_CREDITO", `Nao foi possivel lancar o credito na conta corrente: ${creditoError.message}`, 409);
      }
      idMovimentoCredito = typeof movimento === "number" ? movimento : null;
    }

    // 10. Cancelamento local.
    const motivoCancela = montarMotivoCancela(motivo, motivoTexto || null, destino);
    const { error: updateError } = await supabase
      .from("pagamentos_v2")
      .update({ status: "CANCELADO", motivo_cancela: motivoCancela })
      .eq("id", pagamento.id);

    if (updateError) {
      // Se o credito (passo 9) ja foi criado, ele fica orfao: a cobranca
      // continua paga, mas o movimento de credito existe e precisa de
      // conferencia manual — o cliente da API precisa saber disso. O texto
      // bruto do erro do banco NUNCA vai para o cliente (pode vazar detalhe
      // de schema/RLS); fica so no log do servidor.
      console.error("[cancelar-pago] Falha ao atualizar pagamentos_v2 apos os passos anteriores:", updateError.message);
      const mensagem = idMovimentoCredito != null
        ? `Falha ao cancelar a cobranca: o movimento de credito #${idMovimentoCredito} foi criado e precisa de conferencia manual.`
        : "Falha ao cancelar a cobranca. Tente novamente.";
      return erro("NAO_ENCONTRADA", mensagem, 409);
    }

    // 11. Historico da proposta com AUTOR REAL (mesmo padrao de cancelar-externo:
    //     so o servidor conhece o usuario autenticado de forma confiavel). O
    //     destino do valor entra no texto porque aqui nao ha devolucao pelo
    //     provedor — precisa ficar registrado o que aconteceu com o dinheiro.
    //     Best-effort: uma falha aqui NAO reverte o cancelamento ja efetivado,
    //     que continua de pe com o motivo gravado em motivo_cancela.
    if (pagamento.id_int != null) {
      const autorNome = usuario.nome_usuario || authData.user.email || "Sistema";
      const destinoRotulo = DESTINOS_VALOR_CANCELADO.find((d) => d.codigo === destino)?.rotulo ?? destino;
      // Id do movimento de credito entra no texto quando houver (destino
      // CREDITO) — spec de design §8 item 3: a timeline precisa mostrar autor,
      // data, motivo, destino do valor E o id do movimento de credito.
      const creditoTrecho = idMovimentoCredito != null
        ? ` Movimento de credito: #${idMovimentoCredito}.`
        : "";
      const { error: errorChat } = await supabase.from("propostas_chat").insert([
        {
          id_int: pagamento.id_int,
          id_cliente: pagamento.id_cliente,
          mensagem: `Cobranca ${pagamento.id} (ja paga) cancelada por ${autorNome} (super admin). Motivo: ${rotuloMotivo(motivo)}. Destino do valor: ${destinoRotulo}.${creditoTrecho}`,
          tipo: "SISTEMA",
          autor_nome: autorNome,
          setor: "Financeiro",
          visivel_externo: false
        }
      ]);
      if (errorChat) {
        console.error("[cancelar-pago] Falha ao registrar historico do cancelamento:", errorChat.message);
      }
    }

    return NextResponse.json({
      success: true,
      ...(idMovimentoCredito != null ? { id_movimento_credito: idMovimentoCredito } : {})
    });
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : "erro desconhecido";
    console.error("[cancelar-pago] falha inesperada:", detalhe);
    return erro("NAO_ENCONTRADA", "Falha inesperada ao cancelar a cobranca.", 500);
  }
}
