import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import QRCode from "qrcode";
import { renderToBuffer } from "@react-pdf/renderer";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { montarEtiquetaViewModel } from "@/features/expedicao/services/etiqueta-viewmodel.service";
import { criarEtiquetaElement } from "@/features/expedicao/pdf/EtiquetaPdfDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Erro legível na aba (a etiqueta abre por navegação, como o PDF da OS). */
function respostaErro(request: Request, message: string, status: number) {
  const aceitaHtml = (request.headers.get("accept") || "").includes("text/html");
  if (!aceitaHtml) return NextResponse.json({ success: false, message }, { status });
  const escapado = message.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Etiqueta</title><body style="font-family:sans-serif;padding:2rem"><h1>Não foi possível gerar a etiqueta</h1><p>${escapado}</p></body>`,
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

  // Bearer (fetch programático) OU cookie (aba aberta por navegação) —
  // mesmo padrão de /api/pedidos/imprimir-os.
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

  const vm = await montarEtiquetaViewModel(supabase, idInt);
  if (!vm) return respostaErro(request, `Pedido #${idInt} não encontrado.`, 404);
  const volumesOverride = volumesParam !== null ? Math.trunc(Number(volumesParam)) : NaN;
  if (Number.isFinite(volumesOverride) && volumesOverride > 0 && volumesOverride <= 50) {
    vm.volumes = volumesOverride;
  }

  // QR: link do pedido no ERP (conferência interna escaneia e acha o pedido).
  let qrDataUrl: string | null = null;
  try {
    const base = (process.env.APP_URL || "").trim() || new URL(request.url).origin;
    qrDataUrl = await QRCode.toDataURL(`${base}/orcamentos/${idInt}`, { margin: 0, width: 256 });
  } catch {
    qrDataUrl = null; // etiqueta sai sem QR — não é bloqueante
  }

  const pdf = await renderToBuffer(criarEtiquetaElement(vm, qrDataUrl));

  // Registra a geração (sub-estado "Aguardando transportadora" no painel).
  // Falha aqui não bloqueia a etiqueta — o PDF já está pronto.
  const { error: marcaErr } = await supabase.from("expedicoes").upsert(
    { id_int: idInt, etiqueta_impressa_em: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: "id_int" }
  );
  if (marcaErr) console.warn("[expedicao/etiqueta] Falha ao registrar etiqueta_impressa_em:", marcaErr);

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etiqueta_${idInt}.pdf"`,
      "Cache-Control": "no-store"
    }
  });
}
