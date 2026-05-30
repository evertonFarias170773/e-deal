import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/client";

// Limpa caracteres nao numericos
function keepDigitsOnly(value: string | undefined | null): string {
  if (!value) {
    return "";
  }
  return value.replace(/\D/g, "");
}

type GerarPixRequest = {
  cobrancaId: string;
  idEmpresa?: number;
  seuNumero: string;
  valorNominal: number;
  dataVencimento: string;
  telefone?: string;
  cpfCnpj: string;
  nome: string;
  endereco: string;
  cidade: string;
  uf: string;
  cep: string;
};

export async function POST(request: Request) {
  let body: GerarPixRequest;

  try {
    body = (await request.json()) as GerarPixRequest;
  } catch {
    return NextResponse.json(
      { success: false, message: "Corpo da requisicao invalido." },
      { status: 400 }
    );
  }

  const {
    cobrancaId,
    idEmpresa,
    seuNumero,
    valorNominal,
    dataVencimento,
    telefone,
    cpfCnpj,
    nome,
    endereco,
    cidade,
    uf,
    cep
  } = body;

  // Validacoes basicas do payload
  if (!cobrancaId || !seuNumero || !valorNominal || !cpfCnpj || !nome) {
    return NextResponse.json(
      { success: false, message: "Campos obrigatorios ausentes no body." },
      { status: 400 }
    );
  }

  const cpfCnpjDigits = keepDigitsOnly(cpfCnpj);
  const tipoPessoa = cpfCnpjDigits.length === 11 ? "CPF" : "CNPJ";
  const telefoneDigits = keepDigitsOnly(telefone);
  const cepDigits = keepDigitsOnly(cep);

  // Formata o body esperado pelo webhook do Banco Inter
  const webhookBody = {
    seuNumero: seuNumero,
    valorNominal: valorNominal,
    dataVencimento: dataVencimento,
    numDiasAgenda: 1,
    telefone: telefoneDigits,
    cpfCnpj: cpfCnpjDigits,
    tipoPessoa: tipoPessoa,
    nome: nome,
    endereco: endereco,
    cidade: cidade,
    uf: uf,
    id_interno: seuNumero,
    cep: cepDigits
  };

  let webhookUrl = "";
  if (idEmpresa === 1) {
    webhookUrl = "https://10074.hostoo.net.br/webhook/vibe-ideal";
  } else if (idEmpresa === 3) {
    webhookUrl = "https://10074.hostoo.net.br/webhook-test/vibe-e3";
  } else {
    console.error("[API][GerarPix] id_empresa nao suportado para PIX real:", idEmpresa);
    return NextResponse.json(
      { success: false, message: `Criacao de cobranca real nao suportada/bloqueada para a empresa ID ${idEmpresa}.` },
      { status: 400 }
    );
  }

  console.info(`[API][GerarPix] Chamando webhook da Empresa ${idEmpresa}...`, {
    cobrancaId,
    seuNumero,
    valorNominal,
    tipoPessoa,
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
      console.error("[API][GerarPix] Webhook retornou erro:", webhookResponse.status, errorText);
      return NextResponse.json(
        { success: false, message: `Erro no processamento do Banco Inter: ${errorText}` },
        { status: webhookResponse.status }
      );
    }

    const responseData = await webhookResponse.json();
    
    // Tratamento de resposta no formato Array de objeto esperado
    const webhookResult = Array.isArray(responseData) ? responseData[0] : responseData;

    if (!webhookResult || !webhookResult.txid || !webhookResult.pix_copia_e_cola) {
      console.error("[API][GerarPix] Formato de resposta do webhook inesperado:", responseData);
      return NextResponse.json(
        { success: false, message: "Resposta do Banco Inter nao contem dados do PIX necessarios." },
        { status: 502 }
      );
    }

    // Inicializa o Supabase Client no servidor
    const supabase = getSupabaseClient();
    if (!supabase) {
      console.error("[API][GerarPix] Nao foi possivel inicializar cliente Supabase no servidor.");
      return NextResponse.json(
        { success: false, message: "Erro interno ao conectar ao banco de dados no servidor." },
        { status: 500 }
      );
    }

    console.info("[API][GerarPix] Gravando retorno do PIX no Supabase...", {
      cobrancaId,
      txid: webhookResult.txid
    });

    // Atualiza o registro no Supabase com cod_solicitacao_inter e pix_copia_cola
    const { data: updatedData, error: updateError } = await supabase
      .from("pagamentos_v2")
      .update({
        cod_solicitacao_inter: webhookResult.txid,
        pix_copia_cola: webhookResult.pix_copia_e_cola
      })
      .eq("id", cobrancaId)
      .select();

    if (updateError) {
      console.error("[API][GerarPix] Erro ao salvar dados do PIX no Supabase:", updateError);
      return NextResponse.json(
        { success: false, message: `Erro ao salvar dados do PIX no banco: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updatedData && updatedData[0] ? updatedData[0] : null
    });
  } catch (error: unknown) {
    console.error("[API][GerarPix] Excecao na API route:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Excecao ao processar cobranca: ${errorMessage}` },
      { status: 500 }
    );
  }
}
