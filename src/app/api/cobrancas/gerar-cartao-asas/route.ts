import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cartão Asas — segunda opção de cartão, acionada conscientemente pelo usuário.
 * Não há fallback automático a partir do cartão padrão.
 *
 * O ERP não envia dado de cartão: manda apenas o cadastro do pagador e o
 * identificador oficial da cobrança. O checkout é hospedado pelo provedor.
 *
 * O workflow n8n (Criar Cobranca Asaas, path segunda-opcao-asaas) NÃO usa
 * responseNode: ele responde assim que recebe, ANTES de gravar em
 * pagamentos_v2. Por isso o 2xx do webhook não é prova de conclusão — o
 * sucesso só é declarado depois que `url_cobranca` deixa de ser a URL interna
 * e passa a apontar para o provedor.
 */

const WEBHOOK_URL = "https://10074.hostoo.net.br/webhook/segunda-opcao-asaas";

/** URL interna gravada na criação da cobrança, antes de qualquer integração. */
const PREFIXO_URL_INTERNA = "https://pay.ai-ideal.com.br/";

const STATUS_TERMINAIS = new Set(["PAID", "CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"]);

const TENTATIVAS_LEITURA = 6;
const INTERVALO_LEITURA_MS = 1500;

type GerarCartaoAsasRequest = { cobrancaId: string };

type CobrancaRow = {
  id: string;
  id_pagamento: string | null;
  id_cliente: number | null;
  cliente: string | null;
  documento: string | null;
  valor: number | null;
  vencimento: string | null;
  descricao: string | null;
  status: string | null;
  tipo_cobranca: string | null;
  url_cobranca: string | null;
  whats_contato: string | null;
};

const soDigitos = (valor: unknown): string => String(valor ?? "").replace(/\D/g, "");

/** Considera concluída apenas a URL que já não é mais a interna do ERP. */
const urlDoProvedor = (url: string | null | undefined): boolean =>
  Boolean(url && !url.startsWith(PREFIXO_URL_INTERNA));

function vencimentoISO(valor: string | null): string {
  const bruto = String(valor ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return bruto;
  // Mesmo fallback do boleto: 3 dias a partir de hoje.
  const data = new Date();
  data.setDate(data.getDate() + 3);
  return data.toISOString().split("T")[0];
}

export async function POST(request: Request) {
  let body: GerarCartaoAsasRequest;

  try {
    body = (await request.json()) as GerarCartaoAsasRequest;
  } catch {
    return NextResponse.json({ success: false, message: "Corpo da requisicao invalido." }, { status: 400 });
  }

  const { cobrancaId } = body;
  if (!cobrancaId) {
    return NextResponse.json({ success: false, message: "Campo cobrancaId ausente no body." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[GerarCartaoAsas] ENV AUSENTE");
    return NextResponse.json({ success: false, message: "Erro interno no servidor de banco de dados." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
  }

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
  }

  // Fonte da verdade é o banco: nada do payload do front é usado como dado.
  const { data: cobranca, error: fetchErr } = await supabase
    .from("pagamentos_v2")
    .select("id, id_pagamento, id_cliente, cliente, documento, valor, vencimento, descricao, status, tipo_cobranca, url_cobranca, whats_contato")
    .eq("id", cobrancaId)
    .maybeSingle<CobrancaRow>();

  if (fetchErr || !cobranca) {
    return NextResponse.json(
      { success: false, message: "Cobrança não encontrada ou fora do escopo de acesso do usuário." },
      { status: 404 }
    );
  }

  if (String(cobranca.tipo_cobranca ?? "").toUpperCase() !== "CARD_PARCELADO") {
    return NextResponse.json({ success: false, message: "Esta cobrança não é do tipo cartão." }, { status: 400 });
  }

  if (STATUS_TERMINAIS.has(String(cobranca.status ?? "").toUpperCase())) {
    return NextResponse.json({ success: false, message: "Esta cobrança já está paga ou cancelada." }, { status: 400 });
  }

  // Idempotência: checkout do provedor já gravado — devolve sem reacionar o n8n,
  // que criaria uma segunda cobrança no provedor para a mesma linha.
  if (urlDoProvedor(cobranca.url_cobranca)) {
    return NextResponse.json({
      success: true,
      idempotente: true,
      data: { id: cobranca.id, url_cobranca: cobranca.url_cobranca }
    });
  }

  if (!cobranca.id_pagamento) {
    return NextResponse.json(
      { success: false, message: "Cobrança sem id_pagamento — não é possível acionar a integração." },
      { status: 400 }
    );
  }

  const valor = Number(cobranca.valor ?? 0);
  if (!(valor > 0)) {
    return NextResponse.json({ success: false, message: "Valor da cobrança inválido." }, { status: 400 });
  }

  const documento = soDigitos(cobranca.documento);
  if (documento.length !== 11 && documento.length !== 14) {
    return NextResponse.json(
      { success: false, message: "CPF/CNPJ do cliente inválido ou ausente na cobrança." },
      { status: 400 }
    );
  }

  // E-mail e WhatsApp não existem em pagamentos_v2: vêm do cadastro do cliente.
  let email = "";
  let whats = soDigitos(cobranca.whats_contato);

  if (cobranca.id_cliente) {
    const { data: cad } = await supabase
      .from("clientes")
      .select("email_financeiro, email_contato, email, whatsapp_1")
      .eq("id_cliente", cobranca.id_cliente)
      .maybeSingle<{ email_financeiro: string | null; email_contato: string | null; email: string | null; whatsapp_1: string | null }>();

    if (cad) {
      email = String(cad.email_financeiro || cad.email_contato || cad.email || "").trim();
      if (!whats) whats = soDigitos(cad.whatsapp_1);
    }
  }

  const payload = {
    name: String(cobranca.cliente ?? "").trim(),
    cpfCnpj: documento,
    e_mail: email,
    whats,
    tipo: "CREDIT_CARD",
    valor,
    proposta: cobranca.id_pagamento,
    vencimento: vencimentoISO(cobranca.vencimento),
    descricao: String(cobranca.descricao ?? "").trim()
  };

  let webhookResponse: Response;
  try {
    webhookResponse = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (erro) {
    console.error("[GerarCartaoAsas] Falha de rede ao acionar o webhook:", erro);
    return NextResponse.json(
      { success: false, message: "Não foi possível contatar a integração de cartão. Tente novamente." },
      { status: 502 }
    );
  }

  if (!webhookResponse.ok) {
    const detalhe = await webhookResponse.text().catch(() => "");
    console.error(`[GerarCartaoAsas] Webhook retornou ${webhookResponse.status}: ${detalhe.slice(0, 300)}`);
    return NextResponse.json(
      { success: false, message: "A integração de cartão recusou a solicitação. A cobrança foi preservada para nova tentativa." },
      { status: 502 }
    );
  }

  // O webhook responde antes de gravar. Só há sucesso quando url_cobranca
  // deixa de ser a interna.
  for (let tentativa = 0; tentativa < TENTATIVAS_LEITURA; tentativa += 1) {
    await new Promise((resolve) => setTimeout(resolve, INTERVALO_LEITURA_MS));

    const { data: atual } = await supabase
      .from("pagamentos_v2")
      .select("id, url_cobranca")
      .eq("id", cobrancaId)
      .maybeSingle<{ id: string; url_cobranca: string | null }>();

    if (urlDoProvedor(atual?.url_cobranca)) {
      return NextResponse.json({
        success: true,
        idempotente: false,
        data: { id: cobrancaId, url_cobranca: atual?.url_cobranca }
      });
    }
  }

  console.error("[GerarCartaoAsas] Webhook aceitou mas url_cobranca nao foi gravada para", cobrancaId);
  return NextResponse.json(
    {
      success: false,
      message:
        "A integração foi acionada, mas o link de pagamento não foi gravado na cobrança. A cobrança foi preservada — tente novamente sem criar outra."
    },
    { status: 502 }
  );
}
