import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { correiosConfigurado, lerConfigCorreios } from "@/lib/correios/cws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Bearer (fetch programático) OU cookie (mesma origem) — mesmo padrão das
  // rotas irmãs de Correios. Só sessão: esta rota apenas informa se o
  // servidor está configurado, sem exigir permissão específica.
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

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const cfg = lerConfigCorreios();
  return NextResponse.json({ configurado: correiosConfigurado(), ambiente: cfg?.ambiente ?? null });
}
