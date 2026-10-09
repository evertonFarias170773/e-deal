import "server-only";

import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";

/**
 * Autenticacao das rotas da AWB da Azul: Bearer (tela) ou cookie, e a MESMA
 * permissao de despachar a expedicao (`expedicao.processar`, como a prepostagem
 * dos Correios). A tela esconder o botao nao e trava; esta e.
 */
export type AtorAzul = { supabase: SupabaseClient; userId: string; nome: string };

export async function autenticarOperadorExpedicao(
  request: Request
): Promise<{ ator: AtorAzul } | { resposta: NextResponse }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supabase = token
    ? createSupabaseClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : await createServerSupabaseClient();

  const { data: authData, error } = await supabase.auth.getUser();
  if (error || !authData.user) {
    return { resposta: NextResponse.json({ success: false, message: "Sessão expirada." }, { status: 401 }) };
  }
  const permitido = await verificarPermissaoServerSide(supabase, authData.user.id, "expedicao.processar");
  if (!permitido) {
    return { resposta: NextResponse.json({ success: false, message: "Sem permissão (expedicao.processar)." }, { status: 403 }) };
  }
  const { data: u } = await supabase.from("usuarios").select("nome").eq("user_id", authData.user.id).maybeSingle();
  const nome = String(u?.nome ?? "").trim() || String(authData.user.email ?? "").trim() || "Usuário";
  return { ator: { supabase, userId: authData.user.id, nome } };
}
