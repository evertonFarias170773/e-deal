/**
 * /api/admin/encerrar-pedidos-pagos/route.ts
 *
 * "Encerrar pedidos pagos (transição)": passa para ENTREGUE os pedidos já pagos
 * que continuam em LIBERADO, pela regra de `encerrar_pedidos_pagos_transicao()`.
 * Só administrador.
 *
 * POST { dataCorte: "AAAA-MM-DD" }                           → prévia (só lê)
 * POST { dataCorte, aplicar: true, qtdEsperada: <n da prévia> } → aplica
 *
 * SEGURANÇA:
 * - JWT via Authorization: Bearer <token>; somente is_admin / is_super_adm
 *   (public.usuarios), no padrão de /api/orcamentos/abonar-diferenca.
 * - A função só é executável pela service_role, que fica no servidor.
 * - Aplicar exige a quantidade que a pessoa viu na prévia: se a lista mudou no
 *   meio, a função recusa e nada é gravado.
 * - A cópia de antes (status e data de status por pedido) é gravada pela
 *   própria função em `encerramento_transicao_copias`, na MESMA transação da
 *   mudança, com o e-mail de quem aplicou. É de lá que se volta um lote.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    console.error("[encerrar-pedidos-pagos] ENV AUSENTE");
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
    return NextResponse.json({ success: false, error: "Somente administradores podem encerrar pedidos." }, { status: 403 });
  }

  // ── Payload ──────────────────────────────────────────────────────────────
  let body: { dataCorte?: string; aplicar?: boolean; qtdEsperada?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }
  const dataCorte = String(body.dataCorte ?? "");
  if (!DATA_ISO.test(dataCorte)) {
    return NextResponse.json({ success: false, error: "Informe a data de corte (AAAA-MM-DD)." }, { status: 400 });
  }
  const aplicar = body.aplicar === true;
  const qtdEsperada = Number(body.qtdEsperada);
  if (aplicar && (!Number.isInteger(qtdEsperada) || qtdEsperada < 0)) {
    return NextResponse.json({ success: false, error: "Gere a prévia antes de aplicar." }, { status: 400 });
  }

  const admin = createSupabaseClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("encerrar_pedidos_pagos_transicao", {
    p_data_corte: dataCorte,
    p_so_previa: !aplicar,
    p_qtd_esperada: aplicar ? qtdEsperada : null,
    p_executado_por: aplicar ? authData.user.email ?? authData.user.id : null
  });

  if (error) {
    console.error("[encerrar-pedidos-pagos] função recusou:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: aplicar ? 409 : 400 });
  }

  return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "private, no-store" } });
}
