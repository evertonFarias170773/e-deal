import { SupabaseClient } from "@supabase/supabase-js";

export interface GerarPixParams {
  cobrancaId: string;
  idEmpresa: number;
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
}

function keepDigitsOnly(value: string | undefined | null): string {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Executa a chamada real ao Webhook do Banco Inter e salva as credenciais do PIX na cobrança.
 */
export async function gerarPixBancoInter(
  supabase: SupabaseClient,
  params: GerarPixParams
): Promise<{ success: boolean; error?: string; data?: unknown }> {
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
  } = params;

  const cpfCnpjDigits = keepDigitsOnly(cpfCnpj);
  const tipoPessoa = cpfCnpjDigits.length === 11 ? "CPF" : "CNPJ";
  const telefoneDigits = keepDigitsOnly(telefone);
  const cepDigits = keepDigitsOnly(cep);

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
    return { success: false, error: `Criacao de cobranca real nao suportada para empresa ID ${idEmpresa}.` };
  }

  try {
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhookBody)
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      return { success: false, error: `Erro no processamento do Banco Inter: ${errorText}` };
    }

    const responseData = await webhookResponse.json() as Record<string, unknown> | Record<string, unknown>[];
    let codSolicitacaoInter: string;
    let pixCopiaCola: string;
    let linhaDigitavel: string | undefined = undefined;

    const webhookResult = (Array.isArray(responseData) ? responseData[0] : responseData) as Record<string, unknown>;
    if (!webhookResult) {
      return { success: false, error: "Resposta do Banco Inter vazia." };
    }

    if (idEmpresa === 2) {
      const cobrancaObj = webhookResult.cobranca as Record<string, unknown> | undefined;
      const codSolicitacao = cobrancaObj?.codigoSolicitacao as string | undefined;
      const pixObj = webhookResult.pix as Record<string, unknown> | undefined;
      const pCopiaCola = pixObj?.pixCopiaECola as string | undefined;
      const boletoObj = webhookResult.boleto as Record<string, unknown> | undefined;
      linhaDigitavel = boletoObj?.linhaDigitavel as string | undefined;

      if (!codSolicitacao || !pCopiaCola) {
        return { success: false, error: "Resposta do Banco Inter incompleta para empresa 2." };
      }
      codSolicitacaoInter = codSolicitacao;
      pixCopiaCola = pCopiaCola;
    } else {
      const txid = webhookResult.txid as string | undefined;
      const pCopiaCola = webhookResult.pix_copia_e_cola as string | undefined;

      if (!txid || !pCopiaCola) {
        return { success: false, error: "Resposta do Banco Inter incompleta." };
      }
      codSolicitacaoInter = txid;
      pixCopiaCola = pCopiaCola;
    }

    const updatePayload: Record<string, unknown> = {
      cod_solicitacao_inter: codSolicitacaoInter,
      pix_copia_cola: pixCopiaCola
    };

    if (linhaDigitavel) {
      updatePayload.linha_digitavel = linhaDigitavel;
    }

    const { data: updatedData, error: updateError } = await supabase
      .from("pagamentos_v2")
      .update(updatePayload)
      .eq("id", cobrancaId)
      .select()
      .single();

    if (updateError) {
      return { success: false, error: `Erro ao salvar dados do PIX no banco: ${updateError.message}` };
    }

    return { success: true, data: updatedData };
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errMessage || "Erro de conexão com Banco Inter" };
  }
}
