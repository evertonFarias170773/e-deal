import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/client";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, tipo_cobranca, acao_local, cod_c6, id_empresa, motivo } = body;

    if (!id || !tipo_cobranca || !acao_local) {
      return NextResponse.json(
        { success: false, message: "Parâmetros inválidos. Necessário id, tipo_cobranca e acao_local." },
        { status: 400 }
      );
    }

    if (acao_local !== "DELETE" && acao_local !== "CANCEL") {
      return NextResponse.json(
        { success: false, message: "Ação local inválida. Use DELETE ou CANCEL." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, message: "Erro ao conectar ao banco de dados." },
        { status: 500 }
      );
    }

    // 1. Busca a cobrança
    const { data: pagamento, error: fetchError } = await supabase
      .from("pagamentos_v2")
      .select("id_int, status, confirmado, tipo_cobranca, cod_solicitacao_inter, id_empresa")
      .eq("id", id)
      .single();

    if (fetchError || !pagamento) {
      return NextResponse.json(
        { success: false, message: "Cobrança não encontrada no banco." },
        { status: 404 }
      );
    }

    // 2. Bloqueios universais de regra de negócio
    const statusNormalized = String(pagamento.status || "").trim().toUpperCase();
    if (statusNormalized === "PAID" || statusNormalized === "A_VENCER" || pagamento.confirmado === true) {
      return NextResponse.json(
        { success: false, message: "Não é permitido cancelar/excluir cobrança paga ou a vencer." },
        { status: 403 }
      );
    }

    const tipoNormalized = String(pagamento.tipo_cobranca || "").trim().toUpperCase().replace(/_/g, "-");

    // 3. Roteamento por tipo de cobrança
    if (tipoNormalized === "BOLETO") {
      const codC6Final = cod_c6 || pagamento.cod_solicitacao_inter;
      
      if (!codC6Final) {
        return NextResponse.json(
          { success: false, message: "Para boletos, código bancário não foi fornecido nem encontrado no banco." },
          { status: 400 }
        );
      }

      if (cod_c6 && pagamento.cod_solicitacao_inter && pagamento.cod_solicitacao_inter !== cod_c6) {
        return NextResponse.json(
          { success: false, message: "Código bancário divergente do registro local." },
          { status: 403 }
        );
      }

      if (id_empresa && pagamento.id_empresa && Number(pagamento.id_empresa) !== Number(id_empresa)) {
        return NextResponse.json(
          { success: false, message: "Empresa emissora divergente." },
          { status: 403 }
        );
      }
      
      const idEmpresaFinal = id_empresa || pagamento.id_empresa;

      // Chamada n8n
      const webhookUrl = "https://10074.hostoo.net.br/webhook/del-boleto-av-vibe";
      console.log("[cancelar-externo][BOLETO] chamando n8n", { cod_C6: codC6Final, id_empresa: idEmpresaFinal });
      
      const webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cod_C6: codC6Final, id_empresa: idEmpresaFinal })
      });

      const responseStatus = webhookResponse.status;
      const responseBody = await webhookResponse.text();

      console.log("[cancelar-externo][BOLETO] status n8n", responseStatus);
      console.log("[cancelar-externo][BOLETO] body n8n", responseBody);

      if (!webhookResponse.ok) {
        console.error("[API][CancelarExterno] Erro HTTP no n8n:", responseStatus, responseBody);
        return NextResponse.json(
          { success: false, message: "A API bancária recusou o cancelamento do Boleto." },
          { status: responseStatus }
        );
      }

      // Se webhookResponse.ok é true (HTTP 2xx), aceita como sucesso (n8n retorna [{}] no sucesso).
      // A falha seria tratada no if (!webhookResponse.ok) acima.

    } else if (tipoNormalized === "CARD-PARCELADO") {
      const codC6Final = cod_c6 || pagamento.cod_solicitacao_inter;
      
      if (codC6Final) {
        if (cod_c6 && pagamento.cod_solicitacao_inter && pagamento.cod_solicitacao_inter !== cod_c6) {
          return NextResponse.json(
            { success: false, message: "Código bancário divergente do registro local." },
            { status: 403 }
          );
        }

        if (id_empresa && pagamento.id_empresa && Number(pagamento.id_empresa) !== Number(id_empresa)) {
          return NextResponse.json(
            { success: false, message: "Empresa emissora divergente." },
            { status: 403 }
          );
        }
        
        const idEmpresaFinal = id_empresa || pagamento.id_empresa;

        const webhookUrl = "https://10074.hostoo.net.br/webhook/cancela-cartao-c6-vibe";
        console.log("[cancelar-externo][CARD-PARCELADO] chamando n8n", { cod_C6: codC6Final, id_empresa: idEmpresaFinal });
        
        const webhookResponse = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cod_C6: codC6Final, id_empresa: String(idEmpresaFinal) })
        });

        const responseStatus = webhookResponse.status;
        const responseBody = await webhookResponse.text();

        console.log("[cancelar-externo][CARD-PARCELADO] status n8n", responseStatus);
        console.log("[cancelar-externo][CARD-PARCELADO] body n8n", responseBody);

        if (!webhookResponse.ok) {
          console.error("[API][CancelarExterno] Erro HTTP no n8n:", responseStatus, responseBody);
          return NextResponse.json(
            { success: false, message: "A API externa recusou o cancelamento do Cartão." },
            { status: responseStatus }
          );
        }
      } else {
        console.log("[cancelar-externo][CARD-PARCELADO] Sem cod_solicitacao_inter. Ignorando webhook externo e prosseguindo para exclusao local (fluxo PIX).");
      }
    } else if (tipoNormalized === "PIX") {
      const codValidadorFinal = cod_c6 || pagamento.cod_solicitacao_inter;
      
      if (!codValidadorFinal) {
        return NextResponse.json(
          { success: false, message: "Para PIX, código de validação não foi encontrado." },
          { status: 400 }
        );
      }

      const idEmpresaFinal = id_empresa || pagamento.id_empresa;

      const webhookUrl = "https://10074.hostoo.net.br/webhook/del-pix-vibe";
      console.log("[cancelar-externo][PIX] chamando n8n", { cod_validador: codValidadorFinal, id_empresa: idEmpresaFinal });
      
      const webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cod_validador: codValidadorFinal, id_empresa: String(idEmpresaFinal) })
      });

      const responseStatus = webhookResponse.status;
      const responseBody = await webhookResponse.text();

      console.log("[cancelar-externo][PIX] status n8n", responseStatus);
      console.log("[cancelar-externo][PIX] body n8n", responseBody);

      if (!webhookResponse.ok) {
        console.error("[API][CancelarExterno] Erro HTTP no n8n:", responseStatus, responseBody);
        return NextResponse.json(
          { success: false, message: "A API externa recusou o cancelamento do PIX." },
          { status: responseStatus }
        );
      }
    } else if (tipoNormalized === "CREDIT-CARD") {
      return NextResponse.json(
        { success: false, message: "Cancelamento externo ainda não implementado para este tipo de cobrança." },
        { status: 501 }
      );
    } else {
      return NextResponse.json(
        { success: false, message: `Integração externa não suportada/necessária para o tipo: ${tipoNormalized}` },
        { status: 400 }
      );
    }

    // 4. Se a API bancária validou, aplica a ação local
    if (acao_local === "DELETE") {
      // Deleta do public.boletos
      if (tipoNormalized === "BOLETO") {
        const codC6Final = cod_c6 || pagamento.cod_solicitacao_inter;
        let queryBoletos = supabase.from("boletos").delete().eq("id_boleto_c6", codC6Final);
        if (pagamento.id_int) {
          queryBoletos = queryBoletos.eq("id_int", pagamento.id_int);
        }
        
        const { error: errorBoletos } = await queryBoletos;

        if (errorBoletos) {
          console.error("[API][CancelarExterno] Falha ao deletar de public.boletos:", errorBoletos);
          return NextResponse.json(
            { success: false, message: "Cobrança cancelada no parceiro, mas falha ao limpar dados locais auxiliares." },
            { status: 500 }
          );
        }
      }

      // Deleta do pagamentos_v2
      const query = supabase.from("pagamentos_v2").delete();
      query.eq("id", id);

      const { error: errorPagamentos } = await query;
      
      if (errorPagamentos) {
        console.error("[API][CancelarExterno] Falha ao deletar de public.pagamentos_v2:", errorPagamentos);
        return NextResponse.json(
          { success: false, message: "Sucesso no parceiro, mas erro ao apagar pagamento local." },
          { status: 500 }
        );
      }


      // Nova verificação de status
      if (pagamento?.id_int) {
        const { count, error: countError } = await supabase
          .from("pagamentos_v2")
          .select("*", { count: "exact", head: true })
          .eq("id_int", pagamento.id_int)
          .neq("status", "CANCELADO");

        if (!countError && count === 0) {
          const { data: propData } = await supabase
            .from("propostas")
            .select("status_interno")
            .eq("id_int", pagamento.id_int)
            .maybeSingle();

          if (propData) {
            const currentStatus = String(propData.status_interno || "NOVO").trim().toUpperCase();
            const PROTECTED_STATUSES = [
              "APROVADO", "APROVADO / EM ARTE",
              "REVISAO ATENDENTE", "REVISAO PRODUCAO",
              "EM PRODUCAO", "EM IMPRESSAO", "EM ACABAMENTO",
              "EXPEDICAO", "A RETIRAR", "EM TRANSITO", "ENTREGUE"
            ];

            if (!PROTECTED_STATUSES.includes(currentStatus)) {
              let nextStatus = "NOVO";
              if (currentStatus === "AGUARDANDO / EM ARTE" || currentStatus === "NOVO / EM ARTE") {
                nextStatus = "NOVO / EM ARTE";
              }
              const { error: updatePropError } = await supabase
                .from("propostas")
                .update({ status_interno: nextStatus, tipo_cobranca: null })
                .eq("id_int", pagamento.id_int);
              
              if (updatePropError) {
                console.error("[API][CancelarExterno] Falha ao voltar status_interno:", updatePropError);
              } else {
                console.log(`[API][CancelarExterno] Proposta ${pagamento.id_int} revertida para ${nextStatus} com sucesso.`);
              }
            } else {
              console.log(`[API][CancelarExterno] Reversão ignorada pois status ${currentStatus} é protegido.`);
            }
          }
        } else if (countError) {
          console.error("[API][CancelarExterno] Falha ao contar pagamentos ativos:", countError);
        }
      }

      return NextResponse.json({ success: true, message: "Cobrança cancelada externamente e registros excluídos localmente." });

    } else if (acao_local === "CANCEL") {
      const { error: errorCancel } = await supabase
        .from("pagamentos_v2")
        .update({ 
          status: "CANCELADO",
          motivo_cancela: motivo || "Cancelamento via integração" 
        })
        .eq("id", id);

      if (errorCancel) {
        console.error("[API][CancelarExterno] Falha ao atualizar pagamentos_v2 para CANCELADO:", errorCancel);
        return NextResponse.json(
          { success: false, message: "Sucesso no parceiro, mas erro ao atualizar status local para CANCELADO." },
          { status: 500 }
        );
      }


      // Nova verificação de status
      if (pagamento?.id_int) {
        const { count, error: countError } = await supabase
          .from("pagamentos_v2")
          .select("*", { count: "exact", head: true })
          .eq("id_int", pagamento.id_int)
          .neq("status", "CANCELADO");

        if (!countError && count === 0) {
          const { data: propData } = await supabase
            .from("propostas")
            .select("status_interno")
            .eq("id_int", pagamento.id_int)
            .maybeSingle();

          if (propData) {
            const currentStatus = String(propData.status_interno || "NOVO").trim().toUpperCase();
            const PROTECTED_STATUSES = [
              "APROVADO", "APROVADO / EM ARTE",
              "REVISAO ATENDENTE", "REVISAO PRODUCAO",
              "EM PRODUCAO", "EM IMPRESSAO", "EM ACABAMENTO",
              "EXPEDICAO", "A RETIRAR", "EM TRANSITO", "ENTREGUE"
            ];

            if (!PROTECTED_STATUSES.includes(currentStatus)) {
              let nextStatus = "NOVO";
              if (currentStatus === "AGUARDANDO / EM ARTE" || currentStatus === "NOVO / EM ARTE") {
                nextStatus = "NOVO / EM ARTE";
              }
              const { error: updatePropError } = await supabase
                .from("propostas")
                .update({ status_interno: nextStatus, tipo_cobranca: null })
                .eq("id_int", pagamento.id_int);
              
              if (updatePropError) {
                console.error("[API][CancelarExterno] Falha ao voltar status_interno:", updatePropError);
              } else {
                console.log(`[API][CancelarExterno] Proposta ${pagamento.id_int} revertida para ${nextStatus} com sucesso.`);
              }
            } else {
              console.log(`[API][CancelarExterno] Reversão ignorada pois status ${currentStatus} é protegido.`);
            }
          }
        } else if (countError) {
          console.error("[API][CancelarExterno] Falha ao contar pagamentos ativos:", countError);
        }
      }

      return NextResponse.json({ success: true, message: "Cobrança cancelada externamente e status atualizado localmente." });
    }

  } catch (error: unknown) {
    console.error("[API][CancelarExterno] Exceção na API route:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Erro interno ao processar o cancelamento externo: ${errorMessage}` },
      { status: 500 }
    );
  }
}
