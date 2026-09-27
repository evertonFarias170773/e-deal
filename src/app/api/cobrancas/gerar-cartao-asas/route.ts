import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { gerarCartaoAsasParaCobranca } from "@/features/cobrancas/services/cartao-asas.server";

/**
 * Cartão Asas — segunda opção de cartão, acionada conscientemente pelo usuário.
 * Não há fallback automático a partir do cartão padrão.
 *
 * Esta rota só autentica o vendedor e delega ao núcleo em
 * `cartao-asas.server.ts` — o corpo que vivia aqui saiu inteiro para lá em
 * 27/09/2026, sem mudança de comportamento, para a área do cliente acionar o
 * mesmo caminho com service role. Tudo que a rota respondia (status e corpo)
 * continua vindo do núcleo, sem tradução.
 */

type GerarCartaoAsasRequest = { cobrancaId: string };

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

  const resultado = await gerarCartaoAsasParaCobranca(supabase, cobrancaId);
  return NextResponse.json(resultado.body, { status: resultado.status });
}
