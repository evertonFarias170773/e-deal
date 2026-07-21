import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { isPropostaStatusProtegido } from "@/features/orcamentos/services/status-protegidos";
import { aplicarStatusRecomendadoProposta } from "@/features/orcamentos/services/status-writer.service";

// Status de pagamentos_v2 considerados inativos: cancelamento vira no-op idempotente.
const STATUS_INATIVOS = ["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"];

type PagamentoRow = {
  id: string;
  id_int: number | null;
  id_cliente: number | null;
  status: string | null;
  confirmado: boolean | null;
  tipo_cobranca: string | null;
  cod_solicitacao_inter: string | null;
  id_empresa: number | null;
  reserva_estado: string | null;
  id_pendencia: number | null;
  chave_reserva: string | null;
};

/** Libera a reserva de débito (Conta Corrente) de uma cobrança cancelada, se houver. */
async function liberarReservaSeHouver(supabase: SupabaseClient, userId: string, pagamento: PagamentoRow): Promise<void> {
  if (pagamento.reserva_estado !== "RESERVA_ATIVA" || !pagamento.id_pendencia || !pagamento.chave_reserva) return;
  const { error } = await supabase.rpc("cc_encerrar_pendencia", {
    p_id_pendencia: pagamento.id_pendencia,
    p_modo: "LIBERAR_RESERVA",
    p_valor: null,
    p_id_movimento_ref: null,
    p_chave_reserva: pagamento.chave_reserva,
    p_motivo: null,
    p_observacao: `Cobrança ${pagamento.id} cancelada. Operador: ${userId}.`,
  });
  if (error) {
    console.error("[cancelar-externo] Falha ao liberar reserva de débito:", error.message);
  }
}

async function reverterStatusPropostaSeSemCobranca(supabase: SupabaseClient, idInt: number): Promise<string> {
  const { count, error: countError } = await supabase
    .from("pagamentos_v2")
    .select("*", { count: "exact", head: true })
    .eq("id_int", idInt)
    .neq("status", "CANCELADO");

  if (countError) {
    console.error("[API][CancelarExterno] Falha ao contar pagamentos ativos:", countError);
    return "erro_ao_verificar";
  }
  if (count !== 0) return "mantida (ha cobrancas ativas)";

  const { data: propData } = await supabase
    .from("propostas")
    .select("status_interno")
    .eq("id_int", idInt)
    .maybeSingle();

  if (!propData) return "proposta_nao_encontrada";

  const currentStatus = String(propData.status_interno || "NOVO").trim().toUpperCase();
  if (isPropostaStatusProtegido(currentStatus)) {
    console.log(`[API][CancelarExterno] Reversão ignorada pois status ${currentStatus} é protegido.`);
    return `mantida (status protegido: ${currentStatus})`;
  }

  let nextStatus = "NOVO";
  if (currentStatus === "AGUARDANDO / EM ARTE" || currentStatus === "NOVO / EM ARTE") {
    nextStatus = "NOVO / EM ARTE";
  }
  const { error: updatePropError } = await supabase
    .from("propostas")
    .update({ status_interno: nextStatus, tipo_cobranca: null })
    .eq("id_int", idInt);

  if (updatePropError) {
    console.error("[API][CancelarExterno] Falha ao voltar status_interno:", updatePropError);
    return "erro_ao_reverter";
  }
  console.log(`[API][CancelarExterno] Proposta ${idInt} revertida para ${nextStatus} com sucesso.`);
  return `revertida para ${nextStatus}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, id_int, tipo_cobranca, acao_local, cod_c6, id_empresa, motivo } = body;

    if (!id || !tipo_cobranca || !acao_local) {
      return NextResponse.json(
        { success: false, message: "Parâmetros inválidos. Necessário id, tipo_cobranca e acao_local." },
        { status: 400 }
      );
    }

    // acao_local DELETE é aceito por compatibilidade de contrato, mas a ação
    // local é SEMPRE cancelamento lógico (Matriz de Segurança bloqueia DELETE
    // físico em pagamentos_v2 e boletos).
    if (acao_local !== "DELETE" && acao_local !== "CANCEL") {
      return NextResponse.json(
        { success: false, message: "Ação local inválida. Use DELETE ou CANCEL." },
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
      console.error("[API][CancelarExterno] ENV AUSENTE");
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

    // 3. Reconsulta o estado financeiro atual (fonte da verdade é o banco)
    const { data: pagamento, error: fetchError } = await supabase
      .from("pagamentos_v2")
      .select("id, id_int, id_cliente, status, confirmado, tipo_cobranca, cod_solicitacao_inter, id_empresa, reserva_estado, id_pendencia, chave_reserva")
      .eq("id", id)
      .single<PagamentoRow>();

    if (fetchError || !pagamento) {
      return NextResponse.json(
        { success: false, message: "Cobrança não encontrada no banco." },
        { status: 404 }
      );
    }

    // 4. Escopo de empresa do usuário ANTES de expor qualquer detalhe da cobrança.
    // Sem fallback: super admin passa; qualquer outro usuário precisa ter
    // usuarios.id_empresa igual ao id_empresa da cobrança. Resposta genérica
    // para não revelar dados da cobrança a quem está fora do escopo.
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

    // Cobranças locais sem integração externa podem não ter id_empresa;
    // nesse caso o escopo é validado apenas pelo vínculo com a proposta.
    const tipoNormalized = String(pagamento.tipo_cobranca || "").trim().toUpperCase().replace(/_/g, "-");
    const exigeEmpresa = ["BOLETO", "PIX", "CARD-PARCELADO"].includes(tipoNormalized) && !!pagamento.cod_solicitacao_inter;

    if (!usuarioRow.is_super_adm) {
      const empresaUsuario = usuarioRow.id_empresa != null ? Number(usuarioRow.id_empresa) : null;
      const empresaCobranca = pagamento.id_empresa != null ? Number(pagamento.id_empresa) : null;
      const empresaOk = empresaCobranca != null
        ? (empresaUsuario != null && empresaUsuario === empresaCobranca)
        : !exigeEmpresa; // cobrança emitida externamente sem empresa é inconsistente: nega
      if (!empresaOk) {
        console.warn("[API][CancelarExterno] Escopo de empresa negado", {
          userId: authData.user.id, empresaUsuario, empresaCobranca
        });
        return NextResponse.json(
          { success: false, message: "Acesso negado a esta cobrança." },
          { status: 403 }
        );
      }
    }

    // 5. Vínculo cobrança ↔ proposta (id_int) e cross-check do payload
    if (id_int != null && Number(pagamento.id_int) !== Number(id_int)) {
      return NextResponse.json(
        { success: false, message: "Cobrança não pertence à proposta informada." },
        { status: 400 }
      );
    }

    if (id_empresa != null && pagamento.id_empresa != null && Number(pagamento.id_empresa) !== Number(id_empresa)) {
      return NextResponse.json(
        { success: false, code: "EMPRESA_DIVERGENTE", message: "Empresa emissora divergente do registro local." },
        { status: 409 }
      );
    }

    const statusNormalized = String(pagamento.status || "").trim().toUpperCase();

    // 6. Idempotência (protege contra duplo clique): cobrança já inativa é no-op.
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
        { success: false, code: "PAGAMENTO_QUITADO", message: "Não é permitido cancelar/excluir cobrança paga, confirmada ou a vencer." },
        { status: 409 }
      );
    }

    // Código bancário: fonte da verdade é o registro local; payload apenas cross-check.
    const codC6Final = pagamento.cod_solicitacao_inter || cod_c6 || null;
    if (cod_c6 && pagamento.cod_solicitacao_inter && pagamento.cod_solicitacao_inter !== cod_c6) {
      return NextResponse.json(
        { success: false, code: "COD_BANCARIO_DIVERGENTE", message: "Código bancário divergente do registro local." },
        { status: 409 }
      );
    }

    // Empresa usada na integração: exclusivamente a do registro (sem fallback do payload).
    const idEmpresaCobranca = pagamento.id_empresa != null ? Number(pagamento.id_empresa) : null;

    let provedorResultado = "nao_aplicavel";

    // 8. Cancelamento no provedor ANTES de qualquer alteração local.
    // Falha externa (não-2xx/timeout) aborta sem tocar o banco.
    // Cobranças sem integração externa emitida (sem cod_solicitacao_inter,
    // ou tipos locais como E-FATURADO) seguem direto para o cancelamento lógico.
    if (tipoNormalized === "BOLETO" && codC6Final) {
      if (idEmpresaCobranca == null) {
        return NextResponse.json(
          { success: false, message: "Cobrança sem empresa associada. Cancelamento externo não é possível." },
          { status: 409 }
        );
      }

      // Bloqueio adicional: boleto já liquidado (paid_at) não pode ser cancelado.
      const { data: boletosPagos } = await supabase
        .from("boletos")
        .select("id, paid_at")
        .eq("id_boleto_c6", codC6Final)
        .eq("id_int", pagamento.id_int as number)
        .not("paid_at", "is", null);

      if (boletosPagos && boletosPagos.length > 0) {
        return NextResponse.json(
          { success: false, code: "PAGAMENTO_QUITADO", message: "Boleto já liquidado (paid_at preenchido). Cancelamento não permitido." },
          { status: 409 }
        );
      }

      const webhookUrl = "https://10074.hostoo.net.br/webhook/del-boleto-av-vibe";
      console.log("[cancelar-externo][BOLETO] chamando n8n", { cod_C6: codC6Final, id_empresa: idEmpresaCobranca });

      const webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cod_C6: codC6Final, id_empresa: idEmpresaCobranca })
      });

      const responseStatus = webhookResponse.status;
      const responseBody = await webhookResponse.text();
      console.log("[cancelar-externo][BOLETO] status n8n", responseStatus);
      console.log("[cancelar-externo][BOLETO] body n8n", responseBody);

      if (!webhookResponse.ok) {
        console.error("[API][CancelarExterno] Erro HTTP no n8n:", responseStatus, responseBody);
        return NextResponse.json(
          { success: false, message: "A API bancária recusou o cancelamento do Boleto. Nenhuma alteração local foi feita." },
          { status: responseStatus }
        );
      }
      provedorResultado = "ok";

    } else if (tipoNormalized === "CARD-PARCELADO") {
      if (codC6Final) {
        if (idEmpresaCobranca == null) {
          return NextResponse.json(
            { success: false, message: "Cobrança sem empresa associada. Cancelamento externo não é possível." },
            { status: 409 }
          );
        }

        const webhookUrl = "https://10074.hostoo.net.br/webhook/cancela-cartao-c6-vibe";
        console.log("[cancelar-externo][CARD-PARCELADO] chamando n8n", { cod_C6: codC6Final, id_empresa: idEmpresaCobranca });

        const webhookResponse = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cod_C6: codC6Final, id_empresa: String(idEmpresaCobranca) })
        });

        const responseStatus = webhookResponse.status;
        const responseBody = await webhookResponse.text();
        console.log("[cancelar-externo][CARD-PARCELADO] status n8n", responseStatus);
        console.log("[cancelar-externo][CARD-PARCELADO] body n8n", responseBody);

        if (!webhookResponse.ok) {
          console.error("[API][CancelarExterno] Erro HTTP no n8n:", responseStatus, responseBody);
          return NextResponse.json(
            { success: false, message: "A API externa recusou o cancelamento do Cartão. Nenhuma alteração local foi feita." },
            { status: responseStatus }
          );
        }
        provedorResultado = "ok";
      } else {
        console.log("[cancelar-externo][CARD-PARCELADO] Sem cod_solicitacao_inter. Cobrança apenas local; seguindo para cancelamento lógico.");
      }

    } else if (tipoNormalized === "PIX" && codC6Final) {
      if (idEmpresaCobranca == null) {
        return NextResponse.json(
          { success: false, message: "Cobrança sem empresa associada. Cancelamento externo não é possível." },
          { status: 409 }
        );
      }

      const webhookUrl = "https://10074.hostoo.net.br/webhook/del-pix-vibe";
      console.log("[cancelar-externo][PIX] chamando n8n", { cod_validador: codC6Final, id_empresa: idEmpresaCobranca });

      const webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cod_validador: codC6Final, id_empresa: String(idEmpresaCobranca) })
      });

      const responseStatus = webhookResponse.status;
      const responseBody = await webhookResponse.text();
      console.log("[cancelar-externo][PIX] status n8n", responseStatus);
      console.log("[cancelar-externo][PIX] body n8n", responseBody);

      if (!webhookResponse.ok) {
        console.error("[API][CancelarExterno] Erro HTTP no n8n:", responseStatus, responseBody);
        return NextResponse.json(
          { success: false, message: "A API externa recusou o cancelamento do PIX. Nenhuma alteração local foi feita." },
          { status: responseStatus }
        );
      }
      provedorResultado = "ok";

    } else {
      // Sem integração externa emitida: cancelamento local puro.
      console.log(`[cancelar-externo][${tipoNormalized}] Sem integração externa emitida. Seguindo para cancelamento lógico local.`);
    }

    // 9. Ação local: SEMPRE cancelamento lógico, preservando o registro original.
    const resultados: Record<string, string> = { provedor: provedorResultado };

    const { error: errorCancel } = await supabase
      .from("pagamentos_v2")
      .update({ status: "CANCELADO", motivo_cancela: motivoFinal })
      .eq("id", id);

    if (errorCancel) {
      console.error("[API][CancelarExterno] Falha ao atualizar pagamentos_v2 para CANCELADO:", errorCancel);
      return NextResponse.json(
        { success: false, message: "Cobrança cancelada no parceiro, mas erro ao atualizar status local para CANCELADO. Não tente novamente antes de conferir o registro." },
        { status: 500 }
      );
    }
    resultados.pagamentos_v2 = "CANCELADO (logico)";

    // Conta Corrente: se esta cobrança tinha uma reserva de débito ativa,
    // libera-a (o débito volta a ficar disponível na pendência de origem).
    await liberarReservaSeHouver(supabase, authData.user.id, pagamento);

    // Boletos vinculados: cancelamento lógico com filtro composto (nunca id_int isolado).
    if (tipoNormalized === "BOLETO" && codC6Final && pagamento.id_int != null) {
      const { error: errorBoletos } = await supabase
        .from("boletos")
        .update({ status: "CANCELADO" })
        .eq("id_boleto_c6", codC6Final)
        .eq("id_int", pagamento.id_int);

      if (errorBoletos) {
        console.error("[API][CancelarExterno] Falha ao cancelar logicamente em public.boletos:", errorBoletos);
        resultados.boletos = `falha: ${errorBoletos.message}`;
      } else {
        resultados.boletos = "CANCELADO (logico)";
      }
    } else {
      resultados.boletos = "nao_aplicavel";
    }

    // 10. Reversão do status da proposta quando não resta cobrança ativa.
    if (pagamento.id_int != null) {
      resultados.proposta = await reverterStatusPropostaSeSemCobranca(supabase, pagamento.id_int);

      // 11. Reconciliar pelo fluxo oficial (cobre o caso de cancelar UMA entre
      // várias cobranças ativas — a reversão acima só age quando zero restam).
      // Best-effort: nunca falha o cancelamento em si.
      const reconciliacao = await aplicarStatusRecomendadoProposta(
        pagamento.id_int,
        { uid: authData.user.id, nome: authData.user.email || "Sistema", email: authData.user.email || "" },
        supabase,
        "AUTO_FINANCEIRO"
      );
      if (!reconciliacao.success) {
        console.warn(`[cancelar-externo] Reconciliação de status sem efeito para proposta #${pagamento.id_int}: ${reconciliacao.errorMessage}`);
      }
    }

    const partial = resultados.boletos?.startsWith("falha") === true;
    return NextResponse.json({
      success: true,
      partial,
      resultados,
      message: partial
        ? "Cobrança cancelada no parceiro e em pagamentos_v2, mas houve falha ao cancelar o registro em boletos. Verifique manualmente."
        : "Cobrança cancelada externamente e registros locais cancelados logicamente."
    });

  } catch (error: unknown) {
    console.error("[API][CancelarExterno] Exceção na API route:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Erro interno ao processar o cancelamento externo: ${errorMessage}` },
      { status: 500 }
    );
  }
}
