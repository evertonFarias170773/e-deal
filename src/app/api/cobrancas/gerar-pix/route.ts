import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/client";

// Limpa caracteres nao numericos
function keepDigitsOnly(value: string | undefined | null): string {
  if (!value) {
    return "";
  }
  return value.replace(/\D/g, "");
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
    valorNominal: roundMoney(valorNominal),
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
  } else if (idEmpresa === 2) {
    webhookUrl = "https://10074.hostoo.net.br/webhook/vibe-biro";
  } else if (idEmpresa === 3) {
    webhookUrl = "https://10074.hostoo.net.br/webhook/vibe-e3";
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
    
    // Parser seguro por id_empresa
    let codSolicitacaoInter: string;
    let pixCopiaCola: string;
    let linhaDigitavel: string | undefined = undefined;

    try {
      const webhookResult = Array.isArray(responseData) ? responseData[0] : responseData;
      if (!webhookResult) {
        throw new Error("Resposta do Banco Inter vazia ou em formato inesperado.");
      }

      if (idEmpresa === 2) {
        const codSolicitacao = webhookResult.cobranca?.codigoSolicitacao;
        const pCopiaCola = webhookResult.pix?.pixCopiaECola;
        linhaDigitavel = webhookResult.boleto?.linhaDigitavel;

        if (!codSolicitacao) {
          throw new Error("Resposta nao contem codigoSolicitacao da cobranca.");
        }
        if (!pCopiaCola) {
          throw new Error("Resposta nao contem pixCopiaECola.");
        }

        codSolicitacaoInter = codSolicitacao;
        pixCopiaCola = pCopiaCola;
      } else {
        // Para empresas 1 e 3
        const txid = webhookResult.txid;
        const pCopiaCola = webhookResult.pix_copia_e_cola;

        if (!txid) {
          throw new Error("Resposta nao contem txid.");
        }
        if (!pCopiaCola) {
          throw new Error("Resposta nao contem pix_copia_e_cola.");
        }

        codSolicitacaoInter = txid;
        pixCopiaCola = pCopiaCola;
      }
    } catch (parseError: unknown) {
      const errMessage = parseError instanceof Error ? parseError.message : String(parseError);
      console.error("[API][GerarPix] Erro ao fazer parse da resposta do Banco Inter:", parseError, responseData);
      return NextResponse.json(
        { success: false, message: `Resposta do Banco Inter em formato invalido: ${errMessage}` },
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
      codSolicitacaoInter
    });

    const updatePayload: Record<string, unknown> = {
      cod_solicitacao_inter: codSolicitacaoInter,
      pix_copia_cola: pixCopiaCola
    };

    if (linhaDigitavel) {
      updatePayload.linha_digitavel = linhaDigitavel;
    }

    // Atualiza o registro no Supabase com os dados do PIX
    const { data: updatedData, error: updateError } = await supabase
      .from("pagamentos_v2")
      .update(updatePayload)
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
