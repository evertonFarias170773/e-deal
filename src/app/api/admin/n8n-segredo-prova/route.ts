import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cabecalhosWebhookN8n, segredoWebhookN8nConfigurado } from "@/lib/n8n/webhook-segredo";

/**
 * POST /api/admin/n8n-segredo-prova — diagnóstico do segredo dos webhooks do n8n.
 *
 * Faz o SERVIDOR chamar `boletos-vibe` e `carta-correcao` com os mesmos
 * cabeçalhos do registro real (`cabecalhosWebhookN8n`) e um corpo que não faz
 * nada: `id_empresa: 0` não casa com nenhum ramo dos dois workflows, então a
 * chamada não chega a banco nem a SEFAZ.
 *
 * Serve para conferir, sem registrar boleto de verdade, que a variável
 * `N8N_WEBHOOK_SECRET` está no servidor e que o n8n aceita o que ele envia.
 * Só Super Admin. Nunca devolve o valor do segredo.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBHOOKS = [
  "https://10074.hostoo.net.br/webhook/boletos-vibe",
  "https://10074.hostoo.net.br/webhook/carta-correcao"
];

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ success: false, message: "Configuração de ambiente incompleta." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
  }

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("is_super_adm")
    .eq("user_id", authData.user.id)
    .maybeSingle<{ is_super_adm: boolean | null }>();
  if (!usuario?.is_super_adm) {
    return NextResponse.json({ success: false, message: "Somente Super Admin." }, { status: 403 });
  }

  const corpo = JSON.stringify({ id_empresa: 0, prova: "segredo do webhook - chamada do servidor, nao registra nada" });
  const resultados = [];
  for (const webhook of WEBHOOKS) {
    try {
      const resposta = await fetch(webhook, { method: "POST", headers: cabecalhosWebhookN8n(), body: corpo });
      resultados.push({ webhook: webhook.split("/").pop(), status: resposta.status, aceito: resposta.status !== 401 && resposta.status !== 403 });
    } catch (erro) {
      resultados.push({ webhook: webhook.split("/").pop(), status: 0, aceito: false, erro: erro instanceof Error ? erro.message : "falha de rede" });
    }
  }

  return NextResponse.json({ success: true, segredoConfigurado: segredoWebhookN8nConfigurado(), resultados });
}
