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
): Promise<{
  success: boolean;
  error?: string;
  data?: unknown;
  /**
   * `true` quando a cobrança JÁ EXISTE no banco emissor apesar da falha. Quem
   * chama NÃO pode oferecer nova tentativa: reemitir cria outra cobrança real.
   */
  cobrancaEmitida?: boolean;
}> {
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

    // Lê sempre como texto primeiro — nunca chamar .json() direto numa
    // resposta que pode vir vazia (n8n/webhook sem corpo) ou com texto
    // inválido (ex.: página de erro HTML de um proxy/timeout): nesses casos
    // .json() lança SyntaxError ("Unexpected end of JSON input") sem
    // contexto nenhum para diagnóstico, e sem esse try/catch o erro cru
    // vazava até o cliente.
    const rawText = await webhookResponse.text();
    // Preview truncado só para log/erro — o payload de resposta do PIX
    // (txid, pix_copia_e_cola) não é credencial, mas o corte evita log
    // gigante e qualquer excesso de exposição em caso de resposta anômala.
    const bodyPreview = rawText.slice(0, 300);

    if (!webhookResponse.ok) {
      console.error(`[BancoInter] Webhook retornou erro HTTP. url=${webhookUrl} status=${webhookResponse.status} bodyPreview=${JSON.stringify(bodyPreview)}`);
      return { success: false, error: `Erro no processamento do Banco Inter (HTTP ${webhookResponse.status}): ${bodyPreview || "sem corpo"}` };
    }

    if (!rawText.trim()) {
      console.error(`[BancoInter] Webhook retornou corpo vazio. url=${webhookUrl} status=${webhookResponse.status}`);
      return { success: false, error: "Resposta do Banco Inter vazia (sem corpo na confirmação). A cobrança permanece pendente para nova tentativa." };
    }

    let responseData: Record<string, unknown> | Record<string, unknown>[];
    try {
      responseData = JSON.parse(rawText);
    } catch {
      console.error(`[BancoInter] Webhook retornou corpo não-JSON. url=${webhookUrl} status=${webhookResponse.status} bodyPreview=${JSON.stringify(bodyPreview)}`);
      return { success: false, error: "Resposta do Banco Inter em formato inválido (não é JSON). A cobrança permanece pendente para nova tentativa." };
    }

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

      if (!codSolicitacao) {
        return { success: false, error: "Resposta do Banco Inter sem código de solicitação." };
      }

      // A partir do `codigoSolicitacao` a cobrança JÁ EXISTE no Inter, mesmo sem
      // o QR: o webhook lê a cobrança de volta poucos segundos após criá-la e o
      // `pixCopiaECola` às vezes ainda não ficou pronto.
      //
      // O código antigo devolvia falha e DESCARTAVA o `codigoSolicitacao`. A
      // cobrança ficava órfã no banco (sem rastro no ERP, sem como cancelar) e
      // cada nova tentativa emitia outra cobrança real — foi o que produziu 4
      // cobranças de R$ 188,98 para a proposta 19768 em 05/08/2026.
      //
      // Agora o código é gravado antes de reportar a falha, e quem chama recebe
      // `cobrancaEmitida` para NÃO oferecer nova tentativa.
      if (!pCopiaCola) {
        const { error: updateCodErr } = await supabase
          .from("pagamentos_v2")
          .update({ cod_solicitacao_inter: codSolicitacao })
          .eq("id", cobrancaId);

        if (updateCodErr) {
          console.error(
            `[BancoInter] Cobrança ${codSolicitacao} emitida no Inter mas o código NÃO foi gravado em ${cobrancaId}: ${updateCodErr.message}`
          );
        }

        return {
          success: false,
          cobrancaEmitida: true,
          error:
            "A cobrança foi emitida no Banco Inter, mas o QR do PIX ainda não estava disponível. O código da cobrança foi registrado — não gere outra para esta mesma cobrança."
        };
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
