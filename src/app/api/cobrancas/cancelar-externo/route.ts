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
    if (statusNormalized === "PAID" || pagamento.confirmado === true) {
      return NextResponse.json(
        { success: false, message: "Não é permitido cancelar/excluir cobrança paga ou confirmada." },
        { status: 403 }
      );
    }

    const tipoNormalized = String(pagamento.tipo_cobranca || "").trim().toUpperCase().replace(/_/g, "-");

    // 3. Roteamento por tipo de cobrança
    if (tipoNormalized === "BOLETO") {
      if (!cod_c6 || !id_empresa) {
        return NextResponse.json(
          { success: false, message: "Para boletos, cod_c6 e id_empresa são obrigatórios no payload." },
          { status: 400 }
        );
      }

      if (pagamento.cod_solicitacao_inter !== cod_c6) {
        return NextResponse.json(
          { success: false, message: "Código bancário divergente do registro local." },
          { status: 403 }
        );
      }

      if (Number(pagamento.id_empresa) !== Number(id_empresa)) {
        return NextResponse.json(
          { success: false, message: "Empresa emissora divergente." },
          { status: 403 }
        );
      }

      // Chamada n8n
      const webhookUrl = "https://10074.hostoo.net.br/webhook/del-boleto-av-vibe";
      console.log("[cancelar-externo][BOLETO] chamando n8n", { cod_c6, id_empresa });
      
      const webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cod_C6: cod_c6, id_empresa })
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

      let n8nSuccess = false;
      try {
        const parsed = JSON.parse(responseBody);
        const data = Array.isArray(parsed) ? parsed[0] : parsed;
        if (data && data.success === true) {
          n8nSuccess = true;
        }
      } catch {
        // Falha no parse
      }

      if (!n8nSuccess) {
        console.error("[API][CancelarExterno] n8n não retornou success: true. Body:", responseBody);
        return NextResponse.json(
          { success: false, message: "A API bancária não confirmou o cancelamento com sucesso." },
          { status: 400 }
        );
      }

    } else if (tipoNormalized === "PIX" || tipoNormalized === "CREDIT-CARD" || tipoNormalized === "CARD-PARCELADO") {
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
        let orQuery = `id_boleto_c6.eq.${cod_c6}`;
        if (pagamento.id_int) {
          orQuery += `,id_int.eq.${pagamento.id_int}`;
        }
        
        const { error: errorBoletos } = await supabase
          .from("boletos")
          .delete()
          .or(orQuery);

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
      if (tipoNormalized === "BOLETO") {
        query.eq("cod_solicitacao_inter", cod_c6);
      } else {
        query.eq("id", id);
      }

      const { error: errorPagamentos } = await query;
      
      if (errorPagamentos) {
        console.error("[API][CancelarExterno] Falha ao deletar de public.pagamentos_v2:", errorPagamentos);
        return NextResponse.json(
          { success: false, message: "Sucesso no parceiro, mas erro ao apagar pagamento local." },
          { status: 500 }
        );
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
