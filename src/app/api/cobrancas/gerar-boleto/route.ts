import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/client";

function keepDigitsOnly(value: string | undefined | null): string {
  if (!value) {
    return "";
  }
  return value.replace(/\D/g, "");
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type EnderecoBoleto = {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
};

type GerarBoletoRequest = {
  boleto_id: string;
  ext_reference: string;
  id_empresa: number;
  id_cliente: number;
  id_int: number;
  n_nf: string;
  parcela: number;
  total_parcelas: number;
  valor: number;
  vencimento: string;
  nome_cliente: string;
  documento: string;
  email: string;
  endereco: EnderecoBoleto;
  multa_percentual: number;
  juros_dia_percentual: number;
};

export async function POST(request: Request) {
  let body: GerarBoletoRequest;

  try {
    body = (await request.json()) as GerarBoletoRequest;
  } catch {
    return NextResponse.json(
      { success: false, message: "Corpo da requisicao invalido." },
      { status: 400 }
    );
  }

  const {
    boleto_id,
    ext_reference,
    id_empresa,
    id_cliente,
    id_int,
    n_nf,
    parcela,
    total_parcelas,
    valor,
    vencimento,
    nome_cliente,
    documento,
    email,
    endereco,
    multa_percentual,
    juros_dia_percentual
  } = body;

  // Validacoes basicas
  if (!boleto_id || !id_empresa || !valor || !documento || !nome_cliente || !email) {
    return NextResponse.json(
      { success: false, message: "Campos obrigatorios ausentes no body." },
      { status: 400 }
    );
  }

  const webhookUrl = "https://10074.hostoo.net.br/webhook/boletos-vibe";

  const documentoDigits = keepDigitsOnly(documento);
  
  const webhookBody = {
    boleto_id,
    ext_reference,
    id_empresa,
    id_cliente,
    id_int,
    n_nf: n_nf || "",
    parcela,
    total_parcelas,
    valor: roundMoney(valor),
    vencimento,
    nome_cliente,
    documento: documentoDigits,
    email,
    endereco: {
      logradouro: endereco.logradouro || "",
      numero: endereco.numero || "S/N",
      complemento: endereco.complemento || "",
      bairro: endereco.bairro || "Centro",
      cidade: endereco.cidade || "",
      uf: endereco.uf || "",
      cep: keepDigitsOnly(endereco.cep) || ""
    },
    multa_percentual,
    juros_dia_percentual
  };

  console.info(`[API][GerarBoleto] Chamando webhook Boleto C6...`, {
    boleto_id,
    ext_reference,
    valor,
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
        { success: false, message: `Erro no processamento do Boleto C6: ${errorText}` },
        { status: webhookResponse.status }
      );
    }

    const responseData = await webhookResponse.json();
    const webhookResult = Array.isArray(responseData) ? responseData[0] : responseData;

    if (!webhookResult || !webhookResult.digitable_line) {
      console.error("[API][GerarBoleto] Resposta do webhook invalida:", responseData);
      return NextResponse.json(
        { success: false, message: "Resposta do n8n nao contem linha digitavel." },
        { status: 502 }
      );
    }

    // Inicializa o Supabase Client
    const supabase = getSupabaseClient();
    if (!supabase) {
      console.error("[API][GerarBoleto] Nao foi possivel inicializar cliente Supabase no servidor.");
      return NextResponse.json(
        { success: false, message: "Erro interno ao conectar ao banco de dados no servidor." },
        { status: 500 }
      );
    }

    console.info("[API][GerarBoleto] Gravando dados do boleto no Supabase...", {
      boleto_id
    });

    // Atualiza o registro no Supabase com os dados de retorno do n8n
    const { data: updatedData, error: updateError } = await supabase
      .from("pagamentos_v2")
      .update({
        linha_digitavel: webhookResult.digitable_line,
        id_pagamento: webhookResult.id || null,
        vencimento: webhookResult.due_date || vencimento,
        boleto_enviadoo: true
      })
      .eq("id", boleto_id)
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
      integration: {
        linha_digitavel: webhookResult.digitable_line,
        id_boleto_c6: webhookResult.id || null,
        due_date: webhookResult.due_date || null
      }
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
