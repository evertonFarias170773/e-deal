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

type GerarBoletoRequest = {
  cobrancaId: string;
  idEmpresa: number;
  external_reference_id: number;
  valor_total: number;
  name: string;
  id_pagamento: string;
  documento: string;
  email: string;
  logradouro: string;
  complemento?: string;
  cidade: string;
  UF: string;
  zip_code: string;
  qtd_parcelas: number;
  intervalo: number;
  inicia_em: number;
  multa: number;
  juros: number;
  descricao: string;
  id_cliente: number;
  nf: string;
  status: string;
  "e-faturado": boolean;
  contato: string;
  whats: string;
  enviar_whats: boolean;
  avulso: boolean;
  is_prorrogado: boolean;
  empresa: string;
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
    cobrancaId,
    idEmpresa,
    external_reference_id,
    valor_total,
    name,
    id_pagamento,
    documento,
    email,
    logradouro,
    complemento,
    cidade,
    UF,
    zip_code,
    qtd_parcelas,
    intervalo,
    inicia_em,
    multa,
    juros,
    descricao,
    id_cliente,
    nf,
    status,
    "e-faturado": eFaturado,
    contato,
    whats,
    enviar_whats,
    avulso,
    is_prorrogado,
    empresa
  } = body;

  // Validacoes basicas
  if (!cobrancaId || !idEmpresa || !valor_total || !documento || !name || !email) {
    return NextResponse.json(
      { success: false, message: "Campos obrigatorios (cobrancaId, idEmpresa, valor_total, documento, name, email) ausentes no body." },
      { status: 400 }
    );
  }

  // Determinar URL do webhook C6
  let webhookUrl = "";
  if (idEmpresa === 1) {
    webhookUrl = "https://10074.hostoo.net.br/webhook/boleto-c6-ideal-vibe";
  } else if (idEmpresa === 3) {
    webhookUrl = "https://10074.hostoo.net.br/webhook/boleto-c6-e3-vibe";
  } else {
    console.error("[API][GerarBoleto] Boleto nao suportado para id_empresa:", idEmpresa);
    return NextResponse.json(
      { success: false, message: `Boleto ainda não disponível para esta empresa ID ${idEmpresa}.` },
      { status: 400 }
    );
  }

  const extRefInt = Number(external_reference_id);
  if (isNaN(extRefInt) || !Number.isInteger(extRefInt)) {
    console.error("[API][GerarBoleto] external_reference_id invalido:", external_reference_id);
    return NextResponse.json(
      { success: false, message: "external_reference_id inválido. Deve ser o id_int da proposta em formato inteiro." },
      { status: 400 }
    );
  }

  const documentoDigits = keepDigitsOnly(documento);
  const zipDigits = keepDigitsOnly(zip_code);
  const whatsDigits = keepDigitsOnly(whats);

  // Formata o body para o webhook C6
  const webhookBody = {
    external_reference_id: extRefInt,
    valor_total: roundMoney(valor_total),
    name,
    id_pagamento,
    documento: documentoDigits,
    email,
    logradouro,
    complemento: complemento || "",
    cidade,
    UF,
    zip_code: zipDigits,
    qtd_parcelas: Number(qtd_parcelas) || 1,
    intervalo: Number(intervalo) || 0,
    inicia_em: Number(inicia_em) || 3,
    multa: Number(multa) || 0,
    juros: Number(juros) || 0,
    descricao,
    id_cliente,
    nf: nf || "",
    status,
    "e-faturado": Boolean(eFaturado),
    contato: contato || "",
    whats: whatsDigits,
    enviar_whats: Boolean(enviar_whats),
    avulso: Boolean(avulso),
    is_prorrogado: Boolean(is_prorrogado),
    empresa
  };

  console.info(`[API][GerarBoleto] Chamando webhook Boleto C6 da Empresa ${idEmpresa}...`, {
    cobrancaId,
    id_pagamento,
    valor_total,
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

    if (!webhookResult || webhookResult.success !== true || !webhookResult.url) {
      console.error("[API][GerarBoleto] Resposta do webhook invalida ou sem sucesso:", responseData);
      return NextResponse.json(
        { success: false, message: "Resposta do Banco Inter nao contem indicacao de sucesso ou URL do PDF do boleto." },
        { status: 502 }
      );
    }

    const pdfUrl = webhookResult.url;

    // Inicializa o Supabase Client
    const supabase = getSupabaseClient();
    if (!supabase) {
      console.error("[API][GerarBoleto] Nao foi possivel inicializar cliente Supabase no servidor.");
      return NextResponse.json(
        { success: false, message: "Erro interno ao conectar ao banco de dados no servidor." },
        { status: 500 }
      );
    }

    console.info("[API][GerarBoleto] Gravando URL do boleto no Supabase...", {
      cobrancaId,
      pdfUrl
    });

    const linhaDigitavel = webhookResult.linha_digitavel || webhookResult.linhaDigitavel || webhookResult.barcode || webhookResult.linhaDigitavelFormatada || null;

    // Atualiza o registro no Supabase com pdfUrl (na coluna pix_copia_cola e url_pdf), boleto_enviadoo e linha_digitavel se houver
    const { data: updatedData, error: updateError } = await supabase
      .from("pagamentos_v2")
      .update({
        pix_copia_cola: pdfUrl,
        url_pdf: pdfUrl,
        boleto_enviadoo: true,
        ...(linhaDigitavel ? { linha_digitavel: linhaDigitavel } : {})
      })
      .eq("id", cobrancaId)
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
        url_pdf: pdfUrl,
        linha_digitavel: linhaDigitavel,
        nosso_numero: webhookResult.nosso_numero || webhookResult.nossoNumero || null,
        id_boleto_c6: webhookResult.id_boleto_c6 || webhookResult.idBoletoC6 || webhookResult.boleto_id || null
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
