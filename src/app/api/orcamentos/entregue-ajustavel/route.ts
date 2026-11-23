import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { statusEhEntregue } from "@/features/orcamentos/services/pedido-entregue";
import { avaliarAjusteEntregueNoBanco } from "@/features/orcamentos/services/entregue-ajustavel.server";

/**
 * POST /api/orcamentos/entregue-ajustavel { id_int } — SÓ LEITURA (23/11/2026).
 *
 * Diz à tela da proposta se o pedido ENTREGUE pode ter o valor ajustado pela
 * edição de pedido pago (sem nota, sem título, sem valor recebido; regra em
 * `lib/entregue-ajustavel.ts`). A tela usa para destravar o formulário; quem
 * decide de verdade é o `editar-paga`, que reconfere tudo antes de gravar.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id_int?: number } | null;
  const idInt = Number(body?.id_int);
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int é obrigatório." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ success: false, message: "Erro interno no servidor." }, { status: 500 });
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

  const { data: proposta, error: erroProposta } = await supabase
    .from("propostas")
    .select("status_interno")
    .eq("id_int", idInt)
    .maybeSingle();
  if (erroProposta || !proposta) {
    return NextResponse.json({ success: false, message: "Não foi possível ler o pedido." }, { status: 500 });
  }
  if (!statusEhEntregue(proposta.status_interno)) {
    return NextResponse.json({ success: true, entregue: false, ajustavel: false });
  }

  const lida = await avaliarAjusteEntregueNoBanco(supabase, idInt);
  if (!lida.ok) {
    return NextResponse.json({ success: false, message: `Não foi possível conferir o pedido (${lida.erro}).` }, { status: 500 });
  }
  return NextResponse.json({
    success: true,
    entregue: true,
    ajustavel: lida.avaliacao.ajustavel,
    mensagem: lida.avaliacao.ajustavel ? null : lida.avaliacao.mensagem
  });
}
