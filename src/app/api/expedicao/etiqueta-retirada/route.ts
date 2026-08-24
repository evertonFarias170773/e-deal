import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { montarEtiquetaRetiradaViewModel } from "@/features/expedicao/services/etiqueta-retirada-viewmodel.service";
import { criarEtiquetaRetiradaElement } from "@/features/expedicao/pdf/EtiquetaRetiradaPdfDocument";

/**
 * Etiqueta da RETIRA NO BALCAO — mesmo desenho de rota da 10x15 e da Declaracao:
 * sessao por Bearer ou cookie, permissao `expedicao.view`, PDF inline.
 *
 * Nao gera QR: a etiqueta de balcao nao tem para onde apontar que ajude o
 * atendente — quem confere o pedido esta com o sistema aberto na frente.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Erro legível na aba (a etiqueta abre por navegação, como a 10x15). */
function respostaErro(request: Request, message: string, status: number) {
  const aceitaHtml = (request.headers.get("accept") || "").includes("text/html");
  if (!aceitaHtml) return NextResponse.json({ success: false, message }, { status });
  const escapado = message.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Etiqueta de retirada</title><body style="font-family:sans-serif;padding:2rem"><h1>Não foi possível gerar a etiqueta</h1><p>${escapado}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idInt = Number(searchParams.get("id_int"));
  const volumesParam = searchParams.get("volumes");
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return respostaErro(request, "Parâmetro id_int inválido.", 400);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) return respostaErro(request, "Supabase não configurado no servidor.", 500);

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
    return respostaErro(request, "Sessão não encontrada ou expirada. Faça login novamente.", 401);
  }
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "expedicao.view");
  if (!temPermissao) {
    return respostaErro(request, "Sem permissão para gerar etiquetas (expedicao.view).", 403);
  }

  const vm = await montarEtiquetaRetiradaViewModel(supabase, idInt);
  if (!vm) return respostaErro(request, `Pedido #${idInt} não encontrado.`, 404);
  const volumesOverride = volumesParam !== null ? Math.trunc(Number(volumesParam)) : NaN;
  if (Number.isFinite(volumesOverride) && volumesOverride > 0 && volumesOverride <= 50) {
    vm.volumes = volumesOverride;
  }

  const pdf = await renderToBuffer(criarEtiquetaRetiradaElement(vm));

  // Mesmo carimbo da 10x15: `etiqueta_impressa_em` responde "o volume ja foi
  // etiquetado?", e a resposta e a mesma seja qual for o modelo impresso. Falha
  // aqui nao bloqueia — o PDF ja esta pronto.
  const { error: marcaErr } = await supabase.from("expedicoes").upsert(
    { id_int: idInt, etiqueta_impressa_em: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: "id_int" }
  );
  if (marcaErr) console.warn("[expedicao/etiqueta-retirada] Falha ao registrar etiqueta_impressa_em:", marcaErr);

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="retirada_${idInt}.pdf"`,
      "Cache-Control": "no-store"
    }
  });
}
