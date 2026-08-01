import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { logAmbienteAsaas } from "@/features/cobrancas/services/asaas-ambiente.server";

/**
 * Gera o checkout de cartão de crédito no Asaas, via workflow n8n.
 *
 * Contingência da empresa 1: acionada quando o checkout C6 falha no cliente e o
 * usuário escolhe conscientemente a opção Asaas no modal. Não existe fallback
 * automático — esta rota nunca é chamada sozinha.
 *
 * O ERP não envia dado financeiro nem dado de cartão: manda apenas o
 * token_publico e o n8n busca o resto em pagamentos_v2 + clientes, no mesmo
 * padrão do cartão C6 (workflow CARTAO C6 - IDEAL - E3 VIBE).
 */

type GerarCartaoAsaasRequest = {
  cobrancaId: string;
};

type WebhookCartaoAsaasResponse = {
  success?: boolean;
  message?: string;
  cartao_checkout_id?: string;
  cartao_checkout_url?: string;
  cartao_status?: string;
};

const STATUS_TERMINAIS = new Set(["PAID", "CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"]);

export async function POST(request: Request) {
  // Log de inicializacao: registra uma vez por processo qual ambiente Asaas
  // esta em uso. Nao altera o fluxo e nunca imprime a chave.
  logAmbienteAsaas("gerar-cartao-asaas");

  let body: GerarCartaoAsaasRequest;

  try {
    body = (await request.json()) as GerarCartaoAsaasRequest;
  } catch {
    return NextResponse.json(
      { success: false, message: "Corpo da requisicao invalido." },
      { status: 400 }
    );
  }

  const { cobrancaId } = body;

  if (!cobrancaId) {
    return NextResponse.json(
      { success: false, message: "Campo cobrancaId ausente no body." },
      { status: 400 }
    );
  }

  // 1. Obter ENV
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const webhookUrl = process.env.N8N_ASAAS_CARTAO_URL;
  const webhookSecret = process.env.N8N_ASAAS_CARTAO_SECRET;

  if (!url || !anonKey) {
    console.error("[GerarCartaoAsaas] ENV SUPABASE AUSENTE");
    return NextResponse.json(
      { success: false, message: "Erro interno no servidor de banco de dados." },
      { status: 500 }
    );
  }

  // Sem URL ou sem segredo a rota recusa: nunca há webhook hardcoded como
  // fallback, e nunca se chama a integração sem autenticar.
  if (!webhookUrl || !webhookSecret) {
    console.error("[GerarCartaoAsaas] ENV DE INTEGRACAO AUSENTE");
    return NextResponse.json(
      { success: false, message: "Integracao de cartao Asaas nao configurada neste ambiente." },
      { status: 503 }
    );
  }

  // 2. Autenticação JWT
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
  }

  const supabaseUser = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
  }

  const podeEmitir = await verificarPermissaoServerSide(supabaseUser, authData.user.id, "cobrancas.emit");
  if (!podeEmitir) {
    return NextResponse.json(
      { success: false, message: "Você não tem permissão para emitir cobranças." },
      { status: 403 }
    );
  }

  // 3. Reler a cobrança do banco pelo id. Nada do payload é usado como verdade:
  //    empresa, tipo e provedor vêm da linha real (regra de confiança de
  //    docs/business/CANCELAMENTO-COBRANCAS.md).
  const { data: cobranca, error: fetchErr } = await supabaseUser
    .from("pagamentos_v2")
    .select(
      "id, id_empresa, tipo_cobranca, status, token_publico, cartao_provedor, cartao_checkout_id, cartao_checkout_url, cartao_status"
    )
    .eq("id", cobrancaId)
    .maybeSingle();

  if (fetchErr || !cobranca) {
    return NextResponse.json(
      { success: false, message: "Cobrança não encontrada ou fora do escopo de acesso do usuário." },
      { status: 404 }
    );
  }

  const tipo = String(cobranca.tipo_cobranca ?? "").toUpperCase();
  if (tipo !== "CARD_PARCELADO") {
    return NextResponse.json(
      { success: false, message: "Esta cobrança não é do tipo cartão de crédito." },
      { status: 400 }
    );
  }

  const provedor = String(cobranca.cartao_provedor ?? "").toUpperCase();
  if (provedor !== "ASAAS") {
    return NextResponse.json(
      { success: false, message: "Esta cobrança não foi criada para o provedor Asaas." },
      { status: 400 }
    );
  }

  // Restrição de empresa: a modalidade é exclusiva da empresa 1. A validação é
  // repetida aqui porque o gate da UI não é garantia — e id_empresa nunca é
  // alterado por esta rota.
  if (Number(cobranca.id_empresa) !== 1) {
    return NextResponse.json(
      { success: false, message: "Cartão Asaas disponível apenas para a empresa Ideal Gráfica." },
      { status: 400 }
    );
  }

  if (STATUS_TERMINAIS.has(String(cobranca.status ?? "").toUpperCase())) {
    return NextResponse.json(
      { success: false, message: "Esta cobrança já está paga ou cancelada." },
      { status: 400 }
    );
  }

  if (!cobranca.token_publico) {
    return NextResponse.json(
      { success: false, message: "Cobrança sem token público — não é possível acionar a integração." },
      { status: 400 }
    );
  }

  // Idempotência: se o checkout já existe para esta cobrança, devolve o que está
  // gravado sem rechamar a integração — cada chamada ao webhook cria uma
  // cobrança real no Asaas, então reprocessar duplicaria o título.
  if (cobranca.cartao_checkout_url) {
    return NextResponse.json({
      success: true,
      idempotente: true,
      data: {
        id: cobranca.id,
        cartao_checkout_id: cobranca.cartao_checkout_id,
        cartao_checkout_url: cobranca.cartao_checkout_url,
        cartao_status: cobranca.cartao_status
      }
    });
  }

  // 4. Acionar o workflow n8n. Só o token_publico trafega.
  let webhookResponse: Response;

  try {
    webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-erp-webhook-secret": webhookSecret
      },
      body: JSON.stringify({ token_publico: cobranca.token_publico })
    });
  } catch (erro) {
    console.error("[GerarCartaoAsaas] Falha de rede ao acionar o webhook:", erro);
    return NextResponse.json(
      { success: false, message: "Não foi possível contatar a integração de cartão." },
      { status: 502 }
    );
  }

  if (!webhookResponse.ok) {
    // Corpo do provedor não é repassado ao usuário (pode conter credencial ou
    // payload sensível) — fica só no log do servidor.
    const detalhe = await webhookResponse.text().catch(() => "");
    console.error(
      `[GerarCartaoAsaas] Webhook retornou ${webhookResponse.status}: ${detalhe.slice(0, 500)}`
    );
    return NextResponse.json(
      { success: false, message: "A integração de cartão recusou a solicitação." },
      { status: 502 }
    );
  }

  const webhookData = (await webhookResponse.json().catch(() => null)) as WebhookCartaoAsaasResponse | null;

  if (!webhookData || webhookData.success === false) {
    console.error("[GerarCartaoAsaas] Webhook respondeu sem sucesso:", webhookData?.message);
    return NextResponse.json(
      { success: false, message: webhookData?.message || "A integração de cartão não gerou o checkout." },
      { status: 502 }
    );
  }

  // 5. Confirmar a persistência relendo a linha. O workflow grava os campos de
  //    checkout antes de responder; se a leitura não os encontrar, a gravação
  //    falhou e não se reporta sucesso ao usuário (falha observada no fluxo C6,
  //    onde o Respond vinha antes do Update).
  const { data: cobrancaAtualizada } = await supabaseUser
    .from("pagamentos_v2")
    .select("id, cartao_checkout_id, cartao_checkout_url, cartao_status")
    .eq("id", cobrancaId)
    .maybeSingle();

  if (!cobrancaAtualizada?.cartao_checkout_url) {
    console.error("[GerarCartaoAsaas] Webhook respondeu OK mas o checkout não foi persistido.");
    return NextResponse.json(
      {
        success: false,
        message: "O checkout foi criado no provedor, mas não foi gravado na cobrança. Verifique antes de tentar de novo."
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      id: cobrancaAtualizada.id,
      cartao_checkout_id: cobrancaAtualizada.cartao_checkout_id,
      cartao_checkout_url: cobrancaAtualizada.cartao_checkout_url,
      cartao_status: cobrancaAtualizada.cartao_status
    }
  });
}
