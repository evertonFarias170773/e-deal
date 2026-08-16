import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { baixarRotuloPdf, correiosConfigurado } from "@/lib/correios/cws";
import { resolverEmpresaRemetente } from "@/lib/correios/empresa-remetente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function respostaErro(request: Request, message: string, status: number) {
  const aceitaHtml = (request.headers.get("accept") || "").includes("text/html");
  if (!aceitaHtml) return NextResponse.json({ success: false, message }, { status });
  // Escapa antes de interpolar: `message` pode vir direto do corpo de erro da
  // API dos Correios (baixarRotuloPdf), texto não controlado por nós.
  const escapado = message.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Etiqueta Correios</title><body style="font-family:sans-serif;padding:2rem"><h1>Não foi possível gerar o rótulo</h1><p>${escapado}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request: Request) {
  if (!correiosConfigurado()) return respostaErro(request, "Correios não configurados no servidor.", 503);
  const { searchParams } = new URL(request.url);
  const idInt = Number(searchParams.get("id_int"));
  if (!Number.isInteger(idInt) || idInt <= 0) return respostaErro(request, "Parâmetro id_int inválido.", 400);

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
  if (authError || !authData.user) return respostaErro(request, "Sessão expirada. Faça login novamente.", 401);
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "expedicao.view");
  if (!temPermissao) return respostaErro(request, "Sem permissão (expedicao.view).", 403);

  const [{ data: exp }, { data: proposta }] = await Promise.all([
    supabase.from("expedicoes").select("correios_id_prepostagem").eq("id_int", idInt).maybeSingle(),
    supabase.from("propostas").select("empresa").eq("id_int", idInt).maybeSingle()
  ]);
  if (!exp?.correios_id_prepostagem) {
    return respostaErro(request, "Este pedido ainda não tem prepostagem dos Correios — gere no modal Despachar.", 422);
  }

  // Mesma resolução da rota de prepostagem: o rótulo só sai pelo cartão que
  // emitiu a pré-postagem, então as duas rotas têm de chegar na mesma empresa.
  const empresaRow = await resolverEmpresaRemetente(supabase, proposta?.empresa);

  try {
    const pdf = await baixarRotuloPdf(exp.correios_id_prepostagem, empresaRow?.id ?? null);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="correios_${idInt}.pdf"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    return respostaErro(request, e instanceof Error ? e.message : "Erro desconhecido nos Correios.", 502);
  }
}
