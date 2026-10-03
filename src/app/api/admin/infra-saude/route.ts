/**
 * /api/admin/infra-saude/route.ts
 *
 * Números da seção "Saúde da infraestrutura" do Dashboard. Só administrador.
 *
 * SEGURANÇA:
 * - JWT via Authorization: Bearer <token>; somente is_admin / is_super_adm
 *   (public.usuarios), no padrão de /api/orcamentos/abonar-diferenca.
 * - A service role fica no servidor: lê o endpoint de métricas da Supabase
 *   (Basic `service_role:<chave>`) e chama `infra_saude_resumo()`, que só a
 *   service_role executa. O navegador recebe só os números.
 *
 * CACHE: a leitura vale 10 minutos por instância do servidor. O endpoint de
 * métricas e a função varrem o banco inteiro; não há por que repetir a cada
 * abertura do Dashboard.
 *
 * A leitura em si (métricas, cartões, cache) mora em
 * src/features/dashboard/infra-saude.server.ts, que o Maestro também usa
 * (ferramenta consultar_saude_infra, com a mesma regra de acesso: só
 * administrador). Esta rota só autentica e confere o administrador.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { lerSaudeDaInfra } from "@/features/dashboard/infra-saude.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    console.error("[infra-saude] ENV AUSENTE");
    return NextResponse.json({ success: false, error: "Configuração de ambiente incompleta." }, { status: 500 });
  }
  if (!token) {
    return NextResponse.json({ success: false, error: "Sessão não encontrada." }, { status: 401 });
  }

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  }

  // ── Permissão: somente administrador ─────────────────────────────────────
  const { data: usuarioRow, error: usuarioErr } = await supabase
    .from("usuarios")
    .select("is_admin, is_super_adm")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (usuarioErr || !usuarioRow) {
    return NextResponse.json({ success: false, error: "Usuário não encontrado em public.usuarios." }, { status: 403 });
  }
  if (!usuarioRow.is_admin && !usuarioRow.is_super_adm) {
    return NextResponse.json({ success: false, error: "Somente administradores veem a saúde da infraestrutura." }, { status: 403 });
  }

  const dados = await lerSaudeDaInfra(url, serviceKey);

  return NextResponse.json(
    { success: true, data: dados },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
