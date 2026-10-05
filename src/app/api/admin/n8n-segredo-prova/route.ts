import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cabecalhosWebhookN8n, segredoWebhookN8nConfigurado } from "@/lib/n8n/webhook-segredo";

/**
 * POST /api/admin/n8n-segredo-prova — diagnóstico do segredo dos webhooks do n8n.
 *
 * Faz o SERVIDOR chamar os webhooks que exigem o segredo, com os mesmos
 * cabeçalhos da chamada real (`cabecalhosWebhookN8n`) e um corpo que não faz
 * nada. Onde o fluxo escolhe a empresa, `id_empresa: 0` não casa com nenhum
 * ramo e a chamada para no seletor. Onde ele parte da `ref` da nota, vai uma
 * ref que não existe: a função do banco responde "não encontrada" sem gravar,
 * e o que vem depois filtra por essa mesma ref e não alcança linha nenhuma.
 * Nenhuma das chamadas chega à Focus nem ao banco emissor.
 *
 * Serve para conferir, sem registrar boleto nem nota de verdade, que a variável
 * `N8N_WEBHOOK_SECRET` está no servidor e que o n8n aceita o que ele envia.
 * Só Super Admin. Nunca devolve o valor do segredo.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVA = "segredo do webhook - chamada do servidor, nao registra nada";
const REF_INEXISTENTE = "PROVA-SEGREDO-WEBHOOK-REF-INEXISTENTE";

const WEBHOOKS: Array<{ caminho: string; corpo: Record<string, unknown> }> = [
  { caminho: "boletos-vibe", corpo: { id_empresa: 0, prova: PROVA } },
  { caminho: "carta-correcao", corpo: { id_empresa: 0, prova: PROVA } },
  { caminho: "cancelamento", corpo: { id_empresa: 0, prova: PROVA } },
  { caminho: "cancelamento-nfse", corpo: { id_empresa: 0, prova: PROVA } },
  { caminho: "emitir-nfe-focus", corpo: { ref: REF_INEXISTENTE, prova: PROVA } },
  { caminho: "emitir-nfse-focus", corpo: { ref: REF_INEXISTENTE, prova: PROVA } },
  { caminho: "consultar-nfse-focus", corpo: { ref: REF_INEXISTENTE, prova: PROVA } }
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

  const resultados = [];
  for (const { caminho, corpo } of WEBHOOKS) {
    try {
      const resposta = await fetch(`https://10074.hostoo.net.br/webhook/${caminho}`, {
        method: "POST",
        headers: cabecalhosWebhookN8n(),
        body: JSON.stringify(corpo)
      });
      resultados.push({ webhook: caminho, status: resposta.status, aceito: resposta.status !== 401 && resposta.status !== 403 });
    } catch (erro) {
      resultados.push({ webhook: caminho, status: 0, aceito: false, erro: erro instanceof Error ? erro.message : "falha de rede" });
    }
  }

  return NextResponse.json({ success: true, segredoConfigurado: segredoWebhookN8nConfigurado(), resultados });
}
