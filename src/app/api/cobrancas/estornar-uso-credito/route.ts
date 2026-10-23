/**
 * POST /api/cobrancas/estornar-uso-credito — estorno do uso de crédito de uma
 * cobrança E-CREDITO paga, com o cancelamento da cobrança (23/10/2026).
 *
 * Por que existe: `cancelar-pago` recusa E-CREDITO de propósito (cancelar sem
 * estornar deixaria o crédito consumido) e `estorno-credito` só aceita ajuste
 * avulso sem proposta. Faltava a porta para o uso de crédito ligado a pedido.
 *
 * Toda a regra e toda a escrita estão na RPC `mc_estornar_uso_pedido`
 * (SECURITY DEFINER, numa transação só): CRÉDITO de compensação referenciando o
 * uso, cobrança CANCELADO com motivo e autor, mensagem na conversa do pedido.
 * Repetir devolve o mesmo estorno sem gravar. A rota só confere a sessão,
 * recusa cedo quem não é ADM (a RPC confere de novo) e traduz os erros.
 *
 * Corpo: { id: <uuid da cobrança em pagamentos_v2>, motivo: <texto> }.
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function erro(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

/** Prefixo da exceção da RPC -> status HTTP. Recusa de regra é 409, nunca 500. */
function statusDoErro(mensagem: string): { code: string; status: number } {
  if (mensagem.startsWith("AUTH:")) return { code: "NEGADO", status: 401 };
  if (mensagem.startsWith("PERM:")) return { code: "NEGADO", status: 403 };
  if (mensagem.startsWith("MC_NAOENCONTRADO")) return { code: "NAO_ENCONTRADA", status: 404 };
  if (mensagem.startsWith("MC_PARAMS")) return { code: "PARAMETRO_INVALIDO", status: 400 };
  const prefixo = mensagem.match(/^(MC_[A-Z_]+|CC_[A-Z_]+):/)?.[1];
  if (prefixo) return { code: prefixo, status: 409 };
  return { code: "FALHA", status: 500 };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : "";

  if (!/^[0-9a-f-]{36}$/i.test(id)) return erro("PARAMETRO_INVALIDO", "Cobrança não informada.", 400);
  if (motivo.length < 5) return erro("PARAMETRO_INVALIDO", "Descreva o motivo do estorno (mínimo 5 caracteres).", 400);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[estornar-uso-credito] ENV AUSENTE");
    return erro("FALHA", "Erro interno no servidor.", 500);
  }

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return erro("NEGADO", "Sessão inválida.", 401);

  // Cliente com o JWT de quem chamou: a RPC lê auth.uid() para permissão e autoria.
  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return erro("NEGADO", "Sessão inválida.", 401);

  // Só ADM — o mesmo critério de cc__assert_permissao('__ADMIN__') na RPC.
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("is_super_adm, is_admin")
    .eq("user_id", authData.user.id)
    .maybeSingle<{ is_super_adm: boolean | null; is_admin: boolean | null }>();
  if (!usuario?.is_super_adm && !usuario?.is_admin) {
    return erro("NEGADO", "Somente administrador pode estornar o uso de crédito.", 403);
  }

  const { data: idEstorno, error: rpcError } = await supabase.rpc("mc_estornar_uso_pedido", {
    p_id_pagamento: id,
    p_motivo: motivo
  });

  if (rpcError) {
    const mensagem = rpcError.message || "";
    const { code, status } = statusDoErro(mensagem);
    if (status >= 500) {
      console.error("[estornar-uso-credito] falha na RPC:", mensagem);
      return erro(code, "Falha ao estornar o uso de crédito. Nada foi gravado.", status);
    }
    // Mensagens da RPC são escritas para o usuário (sem dado de schema).
    return erro(code, mensagem.replace(/^[A-Z_]+:\s*/, ""), status);
  }

  return NextResponse.json({ success: true, id_movimento_estorno: idEstorno });
}
