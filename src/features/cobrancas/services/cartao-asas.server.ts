import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cartão Asas — núcleo da geração do checkout, fora da rota.
 *
 * Este é o corpo que vivia inteiro em `POST /api/cobrancas/gerar-cartao-asas`.
 * Saiu de lá em 27/09/2026 para a área do cliente poder acionar o MESMO
 * caminho (mesmo webhook n8n, mesmo payload, mesma idempotência, mesma
 * espera pelo `url_cobranca`) com um client de service role, já que o cliente
 * final não tem sessão. A rota continua exatamente como era para o vendedor:
 * autentica, e delega aqui.
 *
 * O contrato de retorno reproduz o que a rota respondia — status HTTP e corpo —
 * para a rota devolver sem traduzir nada.
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
export const PREFIXO_URL_INTERNA = "https://pay.ai-ideal.com.br/";

const STATUS_TERMINAIS = new Set(["PAID", "CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"]);

const TENTATIVAS_LEITURA = 6;
const INTERVALO_LEITURA_MS = 1500;

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

export type ResultadoCartaoAsas = {
  status: number;
  body: Record<string, unknown>;
};

const soDigitos = (valor: unknown): string => String(valor ?? "").replace(/\D/g, "");

/** Considera concluída apenas a URL que já não é mais a interna do ERP. */
export const urlDoProvedor = (url: string | null | undefined): boolean =>
  Boolean(url && !url.startsWith(PREFIXO_URL_INTERNA));

function vencimentoISO(valor: string | null): string {
  const bruto = String(valor ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return bruto;
  // Mesmo fallback do boleto: 3 dias a partir de hoje.
  const data = new Date();
  data.setDate(data.getDate() + 3);
  return data.toISOString().split("T")[0];
}

/** Asaas exige e-mail valido para criar o cliente — e e por ele que envia o link. */
const EMAIL_PLACEHOLDER = "meu@email.com.br";

/**
 * Primeiro e-mail utilizavel do cadastro, ou string vazia.
 *
 * A precedencia antiga (`email_financeiro || email_contato || email`) pegava o
 * primeiro valor TRUTHY, e o cadastro guarda lixo como texto: o cliente 7011 tem
 * `email_financeiro = "NULL"` (a string, nao SQL NULL) e um e-mail real em
 * `email`. O "NULL" vencia, o Asaas recusava com "O email informado e invalido"
 * e o cartao da proposta 20803 nao gerava link — com o cliente tendo e-mail bom
 * o tempo todo.
 *
 * Validar antes de escolher resolve os dois casos: aproveita o e-mail real
 * quando existe, e so cai no placeholder quando nenhum campo serve.
 */
function primeiroEmailValido(...candidatos: Array<string | null | undefined>): string {
  for (const candidato of candidatos) {
    const texto = String(candidato ?? "").trim();
    if (!texto) continue;
    if (/^(null|undefined|n\/a|na|-|--|sem email|nao tem|não tem)$/i.test(texto)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(texto)) continue;
    return texto;
  }
  return "";
}

/**
 * Gera (ou devolve, se já existir) o checkout do Cartão Asas para uma cobrança
 * já gravada em `pagamentos_v2`. Fonte da verdade é o banco: nada do payload
 * de quem chama é usado como dado.
 */
export async function gerarCartaoAsasParaCobranca(
  supabase: SupabaseClient,
  cobrancaId: string
): Promise<ResultadoCartaoAsas> {
  const { data: cobranca, error: fetchErr } = await supabase
    .from("pagamentos_v2")
    .select("id, id_pagamento, id_cliente, cliente, documento, valor, vencimento, descricao, status, tipo_cobranca, url_cobranca, whats_contato")
    .eq("id", cobrancaId)
    .maybeSingle<CobrancaRow>();

  if (fetchErr || !cobranca) {
    return {
      status: 404,
      body: { success: false, message: "Cobrança não encontrada ou fora do escopo de acesso do usuário." }
    };
  }

  if (String(cobranca.tipo_cobranca ?? "").toUpperCase() !== "CARD_PARCELADO") {
    return { status: 400, body: { success: false, message: "Esta cobrança não é do tipo cartão." } };
  }

  if (STATUS_TERMINAIS.has(String(cobranca.status ?? "").toUpperCase())) {
    return { status: 400, body: { success: false, message: "Esta cobrança já está paga ou cancelada." } };
  }

  // Idempotência: checkout do provedor já gravado — devolve sem reacionar o n8n,
  // que criaria uma segunda cobrança no provedor para a mesma linha.
  if (urlDoProvedor(cobranca.url_cobranca)) {
    return {
      status: 200,
      body: {
        success: true,
        idempotente: true,
        data: { id: cobranca.id, url_cobranca: cobranca.url_cobranca }
      }
    };
  }

  if (!cobranca.id_pagamento) {
    return {
      status: 400,
      body: { success: false, message: "Cobrança sem id_pagamento — não é possível acionar a integração." }
    };
  }

  const valor = Number(cobranca.valor ?? 0);
  if (!(valor > 0)) {
    return { status: 400, body: { success: false, message: "Valor da cobrança inválido." } };
  }

  const documento = soDigitos(cobranca.documento);
  if (documento.length !== 11 && documento.length !== 14) {
    return {
      status: 400,
      body: { success: false, message: "CPF/CNPJ do cliente inválido ou ausente na cobrança." }
    };
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
      email = primeiroEmailValido(cad.email_financeiro, cad.email_contato, cad.email);
      if (!whats) whats = soDigitos(cad.whatsapp_1);
    }
  }

  const payload = {
    name: String(cobranca.cliente ?? "").trim(),
    cpfCnpj: documento,
    e_mail: email || EMAIL_PLACEHOLDER,
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
    return {
      status: 502,
      body: { success: false, message: "Não foi possível contatar a integração de cartão. Tente novamente." }
    };
  }

  if (!webhookResponse.ok) {
    const detalhe = await webhookResponse.text().catch(() => "");
    console.error(`[GerarCartaoAsas] Webhook retornou ${webhookResponse.status}: ${detalhe.slice(0, 300)}`);
    return {
      status: 502,
      body: { success: false, message: "A integração de cartão recusou a solicitação. A cobrança foi preservada para nova tentativa." }
    };
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
      return {
        status: 200,
        body: {
          success: true,
          idempotente: false,
          data: { id: cobrancaId, url_cobranca: atual?.url_cobranca }
        }
      };
    }
  }

  console.error("[GerarCartaoAsas] Webhook aceitou mas url_cobranca nao foi gravada para", cobrancaId);
  return {
    status: 502,
    body: {
      success: false,
      message:
        "A integração foi acionada, mas o link de pagamento não foi gravado na cobrança. A cobrança foi preservada — tente novamente sem criar outra."
    }
  };
}
