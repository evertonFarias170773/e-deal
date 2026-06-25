import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/client";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, cod_C6, id_empresa } = body;

    if (!id || !cod_C6 || !id_empresa) {
      return NextResponse.json(
        { success: false, message: "Parâmetros inválidos. Necessário id, cod_C6 e id_empresa." },
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

    // 1. Validar registro em pagamentos_v2
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

    // 2. Bloqueios de regras de negócios
    const statusNormalized = String(pagamento.status || "").trim().toUpperCase();
    if (statusNormalized === "PAID" || pagamento.confirmado === true) {
      return NextResponse.json(
        { success: false, message: "Não é permitido cancelar cobrança paga ou confirmada." },
        { status: 403 }
      );
    }

    const tipoNormalized = String(pagamento.tipo_cobranca || "").trim().toUpperCase();
    if (!tipoNormalized.includes("BOLETO")) {
      return NextResponse.json(
        { success: false, message: "Esta operação é exclusiva para Boletos." },
        { status: 403 }
      );
    }

    if (pagamento.cod_solicitacao_inter !== cod_C6) {
      return NextResponse.json(
        { success: false, message: "Código bancário divergente do registro." },
        { status: 403 }
      );
    }

    if (Number(pagamento.id_empresa) !== Number(id_empresa)) {
      return NextResponse.json(
        { success: false, message: "Empresa emissora divergente." },
        { status: 403 }
      );
    }

    // 3. Chamada ao Webhook n8n para cancelar o boleto no banco
    const webhookUrl = "https://10074.hostoo.net.br/webhook/del-boleto-av-vibe";
    
    // 4. Antes do fetch, registrar log temporário
    console.log("[cancelar-boleto] chamando n8n", { cod_C6, id_empresa });
    
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cod_C6, id_empresa })
    });

    const responseStatus = webhookResponse.status;
    const responseBody = await webhookResponse.text();

    // 5. Depois do fetch, registrar log
    console.log("[cancelar-boleto] status n8n", responseStatus);
    console.log("[cancelar-boleto] body n8n", responseBody);

    if (!webhookResponse.ok) {
      console.error("[API][CancelarBoleto] Erro HTTP no n8n:", responseStatus, responseBody);
      return NextResponse.json(
        { success: false, message: "A API bancária recusou o cancelamento." },
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
        { success: false, message: "A API bancária não confirmou o cancelamento com sucesso." },
        { status: 400 }
      );
    }

    // 9. Deleções Sequenciais Validadas
    // Deleta do public.boletos por id_boleto_c6 = cod_C6 OU id_int = pagamento.id_int
    let orQuery = `id_boleto_c6.eq.${cod_C6}`;
    if (pagamento.id_int) {
      orQuery += `,id_int.eq.${pagamento.id_int}`;
    }

    const { error: errorBoletos } = await supabase
      .from("boletos")
      .delete()
      .or(orQuery);

    if (errorBoletos) {
      console.error("[API][CancelarBoleto] Falha ao deletar de public.boletos:", errorBoletos);
      return NextResponse.json(
        { success: false, message: "O boleto foi cancelado no banco, mas houve falha ao limpar os dados locais. Atualize a tela." },
        { status: 500 }
      );
    }

    // Deleta do public.pagamentos_v2 por cod_solicitacao_inter = cod_C6
    const { error: errorPagamentos } = await supabase
      .from("pagamentos_v2")
      .delete()
      .eq("cod_solicitacao_inter", cod_C6);

    if (errorPagamentos) {
      console.error("[API][CancelarBoleto] Falha ao deletar de public.pagamentos_v2:", errorPagamentos);
      return NextResponse.json(
        { success: false, message: "Boleto cancelado no banco, mas erro ao apagar pagamento local. Atualize a tela." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: "Boleto cancelado e registros limpos." });

  } catch (error: unknown) {
    console.error("[API][CancelarBoleto] Exceção na API route:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Erro interno ao processar o cancelamento: ${errorMessage}` },
      { status: 500 }
    );
  }
}
