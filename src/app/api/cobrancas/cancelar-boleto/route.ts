import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { verificarEscopoPropostaServerSide } from "@/lib/auth/verificar-escopo-proposta";
import { aplicarStatusRecomendadoProposta } from "@/features/orcamentos/services/status-writer.service";

const STATUS_INATIVOS = ["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"];

/** Libera a reserva de débito (Conta Corrente) de uma cobrança cancelada, se houver. */
async function liberarReservaSeHouver(
  supabase: SupabaseClient,
  userId: string,
  pagamento: { id?: string; reserva_estado?: string | null; id_pendencia?: number | null; chave_reserva?: string | null }
): Promise<void> {
  if (pagamento.reserva_estado !== "RESERVA_ATIVA" || !pagamento.id_pendencia || !pagamento.chave_reserva) return;
  const { error } = await supabase.rpc("cc_encerrar_pendencia", {
    p_id_pendencia: pagamento.id_pendencia,
    p_modo: "LIBERAR_RESERVA",
    p_valor: null,
    p_id_movimento_ref: null,
    p_chave_reserva: pagamento.chave_reserva,
    p_motivo: null,
    p_observacao: `Boleto cancelado. Operador: ${userId}.`,
  });
  if (error) {
    console.error("[cancelar-boleto] Falha ao liberar reserva de débito:", error.message);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, cod_C6, id_empresa, motivo } = body;

    if (!id || !cod_C6 || !id_empresa) {
      return NextResponse.json(
        { success: false, message: "Parâmetros inválidos. Necessário id, cod_C6 e id_empresa." },
        { status: 400 }
      );
    }

    const motivoFinal = String(motivo || "").trim();
    if (!motivoFinal) {
      return NextResponse.json(
        { success: false, message: "Motivo do cancelamento é obrigatório." },
        { status: 400 }
      );
    }

    // 1. Autenticação JWT (mesmo padrão de gerar-pix; sem service role)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      console.error("[API][CancelarBoleto] ENV AUSENTE");
      return NextResponse.json(
        { success: false, message: "Erro interno no servidor de banco de dados." },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
    }

    const supabase = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
    }

    // 2. Permissão granular
    const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "cobrancas.cancel");
    if (!temPermissao) {
      return NextResponse.json(
        { success: false, message: "Sem permissão para cancelar cobrança (cobrancas.cancel)." },
        { status: 403 }
      );
    }

    // 3. Reconsulta o estado financeiro atual
    const { data: pagamento, error: fetchError } = await supabase
      .from("pagamentos_v2")
      .select("id_int, status, confirmado, paid_at, data_confirmacao, tipo_cobranca, cod_solicitacao_inter, id_empresa, reserva_estado, id_pendencia, chave_reserva")
      .eq("id", id)
      .single();

    if (fetchError || !pagamento) {
      return NextResponse.json(
        { success: false, message: "Cobrança não encontrada no banco." },
        { status: 404 }
      );
    }

    // 4. Escopo de empresa do usuário ANTES de expor qualquer detalhe da cobrança.
    // Sem fallback: super admin passa; qualquer outro usuário precisa ter
    // usuarios.id_empresa igual ao da cobrança. Resposta genérica para não
    // revelar dados da cobrança a quem está fora do escopo.
    const { data: usuarioRow } = await supabase
      .from("usuarios")
      .select("id_empresa, is_super_adm")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (!usuarioRow) {
      return NextResponse.json(
        { success: false, message: "Acesso negado a esta cobrança." },
        { status: 403 }
      );
    }

    // Escopo pela PROPOSTA, não pela empresa recebedora — mesma correção e
    // mesmo motivo do /api/cobrancas/cancelar-externo: a empresa recebedora é
    // escolha do modal de criação, não fronteira de acesso, e pinar nela fazia
    // o vendedor criar uma cobrança que depois não conseguia cancelar.
    if (!usuarioRow.is_super_adm) {
      const { data: propostaDoPagamento } = await supabase
        .from("propostas")
        .select("empresa, vendedor")
        .eq("id_int", pagamento.id_int)
        .maybeSingle();

      const escopoOk = propostaDoPagamento
        ? await verificarEscopoPropostaServerSide(supabase, authData.user.id, {
            empresa: propostaDoPagamento.empresa,
            vendedor: propostaDoPagamento.vendedor
          })
        : false;

      if (!escopoOk) {
        console.warn("[API][CancelarBoleto] Escopo de proposta negado", {
          userId: authData.user.id, idInt: pagamento.id_int
        });
        return NextResponse.json(
          { success: false, message: "Acesso negado a esta cobrança." },
          { status: 403 }
        );
      }
    }

    // 5. Vínculo cobrança ↔ código bancário ↔ empresa
    const tipoNormalized = String(pagamento.tipo_cobranca || "").trim().toUpperCase();
    if (!tipoNormalized.includes("BOLETO")) {
      return NextResponse.json(
        { success: false, message: "Esta operação é exclusiva para Boletos." },
        { status: 400 }
      );
    }

    if (pagamento.cod_solicitacao_inter !== cod_C6) {
      return NextResponse.json(
        { success: false, code: "COD_BANCARIO_DIVERGENTE", message: "Código bancário divergente do registro." },
        { status: 409 }
      );
    }

    if (Number(pagamento.id_empresa) !== Number(id_empresa)) {
      return NextResponse.json(
        { success: false, code: "EMPRESA_DIVERGENTE", message: "Empresa emissora divergente." },
        { status: 409 }
      );
    }

    const statusNormalized = String(pagamento.status || "").trim().toUpperCase();

    // 6. Idempotência (duplo clique): já inativa é no-op.
    if (STATUS_INATIVOS.includes(statusNormalized)) {
      return NextResponse.json({
        success: true,
        alreadyCancelled: true,
        message: "Cobrança já estava cancelada/inativa. Nenhuma ação executada."
      });
    }

    // 7. Bloqueio financeiro: paga, confirmada ou com faturamento aprovado.
    if (statusNormalized === "PAID" || statusNormalized === "A_VENCER" || pagamento.confirmado === true) {
      return NextResponse.json(
        { success: false, code: "PAGAMENTO_QUITADO", message: "Não é permitido cancelar cobrança paga, confirmada ou a vencer." },
        { status: 409 }
      );
    }

    // Baixa ou conciliação registrada no próprio pagamento (paridade com
    // cancelar-externo): status não-pago não garante ausência de pagamento.
    if (pagamento.paid_at != null || pagamento.data_confirmacao != null) {
      return NextResponse.json(
        { success: false, code: "PAGAMENTO_QUITADO", message: "Cobrança com baixa ou confirmação registrada. Cancelamento não permitido." },
        { status: 409 }
      );
    }

    // Bloqueio adicional: boleto já liquidado (paid_at) não pode ser cancelado.
    const { data: boletosPagos } = await supabase
      .from("boletos")
      .select("id, paid_at")
      .eq("id_boleto_c6", cod_C6)
      .not("paid_at", "is", null);

    if (boletosPagos && boletosPagos.length > 0) {
      return NextResponse.json(
        { success: false, code: "PAGAMENTO_QUITADO", message: "Boleto já liquidado (paid_at preenchido). Cancelamento não permitido." },
        { status: 409 }
      );
    }

    // 8. Cancelamento no provedor ANTES de qualquer alteração local.
    const webhookUrl = "https://10074.hostoo.net.br/webhook/del-boleto-av-vibe";
    console.log("[cancelar-boleto] chamando n8n", { cod_C6, id_empresa });

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cod_C6, id_empresa })
    });

    const responseStatus = webhookResponse.status;
    const responseBody = await webhookResponse.text();
    console.log("[cancelar-boleto] status n8n", responseStatus);
    console.log("[cancelar-boleto] body n8n", responseBody);

    if (!webhookResponse.ok) {
      console.error("[API][CancelarBoleto] Erro HTTP no n8n:", responseStatus, responseBody);
      return NextResponse.json(
        { success: false, message: "A API bancária recusou o cancelamento. Nenhuma alteração local foi feita." },
        { status: responseStatus }
      );
    }

    let n8nSuccess = false;
    try {
      const parsed = JSON.parse(responseBody);
      const data = Array.isArray(parsed) ? parsed[0] : parsed;
      if (data && data.success === true) {
        n8nSuccess = true;
      }
    } catch {
      // Falha ao parsear
    }

    if (!n8nSuccess) {
      console.error("[API][CancelarBoleto] n8n não retornou success: true. Body:", responseBody);
      return NextResponse.json(
        { success: false, message: "A API bancária não confirmou o cancelamento com sucesso. Nenhuma alteração local foi feita." },
        { status: 400 }
      );
    }

    // 9. Ação local: SEMPRE cancelamento lógico, preservando os registros.
    const resultados: Record<string, string> = { provedor: "ok" };

    const { error: errorPagamentos } = await supabase
      .from("pagamentos_v2")
      .update({ status: "CANCELADO", motivo_cancela: motivoFinal })
      .eq("id", id);

    if (errorPagamentos) {
      console.error("[API][CancelarBoleto] Falha ao cancelar logicamente em pagamentos_v2:", errorPagamentos);
      return NextResponse.json(
        { success: false, message: "Boleto cancelado no banco, mas erro ao atualizar o pagamento local. Não tente novamente antes de conferir o registro." },
        { status: 500 }
      );
    }
    resultados.pagamentos_v2 = "CANCELADO (logico)";

    // Conta Corrente: se este boleto tinha uma reserva de débito ativa, libera-a.
    await liberarReservaSeHouver(supabase, authData.user.id, { id, ...pagamento });

    // Filtro composto (nunca id_int isolado, nem OR com id_int).
    let queryBoletos = supabase
      .from("boletos")
      .update({ status: "CANCELADO" })
      .eq("id_boleto_c6", cod_C6);
    if (pagamento.id_int != null) {
      queryBoletos = queryBoletos.eq("id_int", pagamento.id_int);
    }
    const { error: errorBoletos } = await queryBoletos;

    if (errorBoletos) {
      console.error("[API][CancelarBoleto] Falha ao cancelar logicamente em public.boletos:", errorBoletos);
      resultados.boletos = `falha: ${errorBoletos.message}`;
    } else {
      resultados.boletos = "CANCELADO (logico)";
    }

    // Reconciliar status_interno pelo fluxo oficial (evento: cancelamento de pagamento).
    // Best-effort: nunca falha o cancelamento do boleto em si.
    if (pagamento.id_int != null) {
      const reconciliacao = await aplicarStatusRecomendadoProposta(
        pagamento.id_int,
        { uid: authData.user.id, nome: authData.user.email || "Sistema", email: authData.user.email || "" },
        supabase,
        "AUTO_FINANCEIRO"
      );
      if (!reconciliacao.success) {
        console.warn(`[cancelar-boleto] Reconciliação de status sem efeito para proposta #${pagamento.id_int}: ${reconciliacao.errorMessage}`);
      }
    }

    const partial = resultados.boletos.startsWith("falha");
    return NextResponse.json({
      success: true,
      partial,
      resultados,
      message: partial
        ? "Boleto cancelado no banco e em pagamentos_v2, mas houve falha ao cancelar o registro em boletos. Verifique manualmente."
        : "Boleto cancelado no banco e registros locais cancelados logicamente."
    });

  } catch (error: unknown) {
    console.error("[API][CancelarBoleto] Exceção na API route:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Erro interno ao processar o cancelamento: ${errorMessage}` },
      { status: 500 }
    );
  }
}
