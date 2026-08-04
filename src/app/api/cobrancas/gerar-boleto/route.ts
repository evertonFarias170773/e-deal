import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/client";

export async function POST(request: Request) {
  let webhookBody: Record<string, unknown>;

  try {
    webhookBody = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, message: "Corpo da requisicao invalido." },
      { status: 400 }
    );
  }

  // Roteamento por empresa recebedora. A empresa 2 (Ideal Birô) emite pelo
  // Banco Inter; as demais seguem no C6, com o webhook e o comportamento
  // exatamente como estavam.
  const empresaBoleto = String(webhookBody.empresa ?? "").trim();
  const isBiroInter = empresaBoleto === "2";

  const webhookUrl = isBiroInter
    ? "https://10074.hostoo.net.br/webhook/boleto-inter-biro"
    : "https://10074.hostoo.net.br/webhook/boleto-avista-vibe";

  const rotuloProvedor = isBiroInter ? "Inter (Biro)" : "C6";

  console.info(`[API][GerarBoleto] Chamando webhook Boleto ${rotuloProvedor}...`, {
    external_reference_id: webhookBody.external_reference_id,
    id_pagamento: webhookBody.id_pagamento,
    valor_total: webhookBody.valor_total,
    empresa: empresaBoleto,
    webhookUrl
  });

  try {
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(webhookBody)
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error("[API][GerarBoleto] Webhook retornou erro:", webhookResponse.status, errorText);
      return NextResponse.json(
        { success: false, message: `Erro no processamento do Boleto ${rotuloProvedor}: ${errorText}` },
        { status: webhookResponse.status }
      );
    }

    const responseData = await webhookResponse.text();
    let parsedData: Record<string, unknown> | Array<Record<string, unknown>> = {};
    try {
      parsedData = JSON.parse(responseData);
    } catch {
      // Ignora se nao for json
    }

    const webhookResult = Array.isArray(parsedData) ? parsedData[0] : parsedData;

    // Inicializa o Supabase Client
    const supabase = getSupabaseClient();
    if (!supabase) {
      console.error("[API][GerarBoleto] Nao foi possivel inicializar cliente Supabase no servidor.");
      return NextResponse.json(
        { success: false, message: "Erro interno ao conectar ao banco de dados no servidor." },
        { status: 500 }
      );
    }

    // Se o webhook retornou uma linha digitavel, atualizamos a tabela,
    // caso contrario, apenas atualizamos boleto_enviadoo = true
    const updatePayload: Record<string, unknown> = {
      boleto_enviadoo: true
    };

    if (webhookResult && typeof webhookResult.digitable_line === "string") {
      updatePayload.linha_digitavel = webhookResult.digitable_line;
    }
    
    // Nao sobreescrevemos o id_pagamento se nao retornar id, pois no novo padrao o front ja gerou "id_int-token".

    // Para encontrar qual atualizar, o novo payload usa webhookBody.id_pagamento
    // Opcionalmente podemos buscar por id_int ou assumir sucesso global
    // Como nao passamos boleto_id (o UUID do pagamentos_v2), precisamos atualizar via id_pagamento
    const { data: updatedData, error: updateError } = await supabase
      .from("pagamentos_v2")
      .update(updatePayload)
      .eq("id_pagamento", webhookBody.id_pagamento)
      .select();

    if (updateError) {
      console.error("[API][GerarBoleto] Erro ao salvar dados do Boleto no Supabase:", updateError);
      return NextResponse.json(
        { success: false, message: `Erro ao salvar dados do Boleto no banco: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updatedData && updatedData[0] ? updatedData[0] : null,
      integration: webhookResult || {}
    });
  } catch (error: unknown) {
    console.error("[API][GerarBoleto] Excecao na API route:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Excecao ao processar boleto: ${errorMessage}` },
      { status: 500 }
    );
  }
}
