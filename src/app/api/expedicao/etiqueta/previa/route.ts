import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import QRCode from "qrcode";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { montarEtiquetaViewModel } from "@/features/expedicao/services/etiqueta-viewmodel.service";
import { SITE_QR_ETIQUETA } from "@/features/expedicao/lib/etiqueta-apresentacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PREVIA DA ETIQUETA 10x15 — o view model em JSON (04/09/2026).
 *
 * O modal Despachar passou a EXIBIR a etiqueta enquanto o expedidor preenche.
 * Para a previa e o PDF nunca discordarem, ela nao monta nada por conta
 * propria: le o MESMO `montarEtiquetaViewModel` da rota do PDF (`../route.ts`)
 * — destinatario, endereco, remetente, transportadora e telefone resolvidos
 * pela mesma funcao, com a mesma precedencia — e devolve o resultado cru. O
 * browser so sobrepoe os campos que esta editando (NF manual, volumes,
 * observacao), que sao os que `salvarDadosExpedicao` vai gravar antes de o
 * PDF ser gerado.
 *
 * ROTA PROPRIA, e nao um `?formato=json` na do PDF, por dois motivos: a rota do
 * PDF carimba `expedicoes.etiqueta_impressa_em` a cada chamada, e uma previa
 * nao e impressao; e a rota do PDF e o artefato de producao — fica intocada.
 * Mesma autenticacao (Bearer ou cookie) e mesma permissao (`expedicao.view`).
 *
 * `destinatario` (opcional): o id escolhido no drop "Em nome de quem sai a
 * etiqueta" AINDA NAO GRAVADO. Passa pela mesma validacao que o valor
 * persistido — id que nao seja o cliente nem o pagador cai no cliente —, entao
 * nao ha caminho por onde um id arbitrario chegue a previa.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idInt = Number(searchParams.get("id_int"));
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "Parâmetro id_int inválido." }, { status: 400 });
  }
  const destinatarioParam = searchParams.get("destinatario");
  const idDestinatario = destinatarioParam !== null ? Math.trunc(Number(destinatarioParam)) : NaN;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) {
    return NextResponse.json({ success: false, message: "Supabase não configurado no servidor." }, { status: 500 });
  }

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
    return NextResponse.json(
      { success: false, message: "Sessão não encontrada ou expirada. Faça login novamente." },
      { status: 401 }
    );
  }
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "expedicao.view");
  if (!temPermissao) {
    return NextResponse.json(
      { success: false, message: "Sem permissão para ver a etiqueta (expedicao.view)." },
      { status: 403 }
    );
  }

  const vm = await montarEtiquetaViewModel(supabase, idInt, {
    idDestinatarioEtiqueta: Number.isFinite(idDestinatario) && idDestinatario > 0 ? idDestinatario : null
  });
  if (!vm) {
    return NextResponse.json({ success: false, message: `Pedido #${idInt} não encontrado.` }, { status: 404 });
  }

  // O MESMO QR da rota do PDF: mesmo conteudo, mesma biblioteca. Falha nao
  // bloqueia — a previa sai sem QR, como o PDF sairia.
  let qrDataUrl: string | null = null;
  try {
    qrDataUrl = await QRCode.toDataURL(SITE_QR_ETIQUETA, { margin: 0, width: 256 });
  } catch {
    qrDataUrl = null;
  }

  return NextResponse.json(
    { success: true, vm, qrDataUrl },
    { headers: { "Cache-Control": "no-store" } }
  );
}
