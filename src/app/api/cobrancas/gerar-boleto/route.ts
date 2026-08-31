import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const soDigitos = (valor: unknown): string => String(valor ?? "").replace(/\D/g, "");

/**
 * Emissão do boleto à vista (C6 / Inter Birô).
 *
 * A identidade do sacado (`name`, `documento`, `id_cliente`) NÃO vem do corpo
 * da requisição: é lida de `pagamentos_v2` aqui dentro, antes de falar com o
 * provedor. O front montava esses campos a partir de `proposta.cliente`,
 * enquanto a linha da cobrança é gravada com o pagador
 * (`propostas.id_faturado`) — o boleto saía no nome de quem não paga. A rota do
 * Cartão Asaas já lia da linha; este é o mesmo contrato.
 *
 * O contrato com o n8n não muda: os mesmos campos seguem no payload, só que
 * preenchidos por quem tem a fonte da verdade.
 */
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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[API][GerarBoleto] ENV AUSENTE");
    return NextResponse.json(
      { success: false, message: "Erro interno ao conectar ao banco de dados no servidor." },
      { status: 500 }
    );
  }

  // Autenticação JWT — o MESMO bloco de gerar-pix e gerar-cartao-asas.
  //
  // Antes daqui esta rota usava `getSupabaseClient()`, o client de NAVEGADOR,
  // dentro do servidor: sem cookie e sem Bearer ele opera como `anon` puro.
  // Somado à policy `GERAL` de pagamentos_v2 (USING true) e aos grants de coluna
  // ainda concedidos ao anon, qualquer POST anônimo com um id de cobrança válido
  // lia nome e CPF/CNPJ do sacado, disparava o webhook que EMITE BOLETO REAL no
  // C6/Inter e gravava `boleto_enviadoo` e `linha_digitavel`. As rotas irmãs
  // exigem Bearer desde sempre; esta ficou para trás.
  //
  // Sem checagem de permissão, de propósito: gerar-pix e gerar-cartao-asas também
  // não fazem, e exigir `cobrancas.emitir_boleto` aqui BLOQUEARIA o perfil
  // vendedor, que tem `cobrancas.create` mas não aquela. O contrato do fluxo
  // autenticado fica byte a byte igual ao de antes.
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
  }

  // Client com o Bearer do usuário e a anon key: toda query passa por RLS com a
  // identidade certa, sem escalada acidental.
  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
  }

  // `cobrancaId` (UUID) é a chave preferida; `id_pagamento` fica como fallback
  // para qualquer chamador que ainda não mande o UUID.
  const cobrancaId = String(webhookBody.cobrancaId ?? "").trim();
  const idPagamento = String(webhookBody.id_pagamento ?? "").trim();

  if (!cobrancaId && !idPagamento) {
    return NextResponse.json(
      { success: false, message: "Requisicao sem cobrancaId nem id_pagamento — nao da para identificar o pagador." },
      { status: 400 }
    );
  }

  const consulta = supabase.from("pagamentos_v2").select("id, id_pagamento, id_cliente, cliente, documento");
  const { data: cobranca, error: cobrancaErr } = await (
    cobrancaId ? consulta.eq("id", cobrancaId) : consulta.eq("id_pagamento", idPagamento)
  ).maybeSingle<{ id: string; id_pagamento: string | null; id_cliente: number | null; cliente: string | null; documento: string | null }>();

  if (cobrancaErr || !cobranca) {
    console.error("[API][GerarBoleto] Cobranca nao localizada para emissao:", cobrancaId || idPagamento, cobrancaErr?.message);
    return NextResponse.json(
      { success: false, message: "Cobranca nao encontrada para emissao do boleto." },
      { status: 404 }
    );
  }

  const nomePagador = String(cobranca.cliente ?? "").trim();
  const documentoPagador = String(cobranca.documento ?? "").trim();

  if (!nomePagador) {
    return NextResponse.json(
      { success: false, message: "Cobranca sem nome do pagador gravado — nao e possivel emitir o boleto." },
      { status: 400 }
    );
  }

  const digitosDocumento = soDigitos(documentoPagador);
  if (digitosDocumento.length !== 11 && digitosDocumento.length !== 14) {
    return NextResponse.json(
      { success: false, message: "CPF/CNPJ do pagador invalido ou ausente na cobranca." },
      { status: 400 }
    );
  }

  // Sobrescreve a identidade com a da linha. Os três campos saem da MESMA
  // linha, então nome, documento e id_cliente nunca podem ser de pessoas
  // diferentes. O Inter recusa documento com máscara; o C6 segue recebendo a
  // forma gravada, exatamente como antes.
  webhookBody.name = nomePagador;
  webhookBody.documento = isBiroInter ? digitosDocumento : documentoPagador;
  if (cobranca.id_cliente != null) {
    webhookBody.id_cliente = cobranca.id_cliente;
  }
  // Campo de roteamento interno: não faz parte do contrato do n8n.
  delete webhookBody.cobrancaId;

  console.info(`[API][GerarBoleto] Chamando webhook Boleto ${rotuloProvedor}...`, {
    external_reference_id: webhookBody.external_reference_id,
    id_pagamento: webhookBody.id_pagamento,
    valor_total: webhookBody.valor_total,
    empresa: empresaBoleto,
    id_cliente_pagador: cobranca.id_cliente,
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

    // Se o webhook retornou uma linha digitavel, atualizamos a tabela,
    // caso contrario, apenas atualizamos boleto_enviadoo = true
    const updatePayload: Record<string, unknown> = {
      boleto_enviadoo: true
    };

    if (webhookResult && typeof webhookResult.digitable_line === "string") {
      updatePayload.linha_digitavel = webhookResult.digitable_line;
    }
    
    // Nao sobreescrevemos o id_pagamento se nao retornar id, pois no novo padrao o front ja gerou "id_int-token".

    // Atualiza pelo UUID da linha já resolvida acima. O filtro anterior era por
    // `id_pagamento` vindo do corpo, que tem fallback para `id_int` e podia não
    // casar com nenhuma linha (ou com a errada).
    const { data: updatedData, error: updateError } = await supabase
      .from("pagamentos_v2")
      .update(updatePayload)
      .eq("id", cobranca.id)
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
