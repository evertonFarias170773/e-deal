/**
 * /api/conta-corrente/encerrar/route.ts
 *
 * Rota fina: autentica e delega para a RPC `cc_encerrar_pendencia`
 * (SECURITY DEFINER, search_path fixo, valida auth.uid()/permissão no banco,
 * inclusive o requisito de admin/superadmin para ESTORNO na v1).
 *
 * modo: CONFIRMAR_RESERVA | LIBERAR_RESERVA | DEVOLUCAO | BONIFICACAO | BAIXA |
 *       CANCELAMENTO | ESTORNO
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

const MODOS_VALIDOS = [
  "CONFIRMAR_RESERVA", "LIBERAR_RESERVA", "DEVOLUCAO", "BONIFICACAO", "BAIXA", "CANCELAMENTO", "ESTORNO",
];

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ success: false, error: "Configuração de ambiente incompleta." }, { status: 500 });
  }
  if (!token) {
    return NextResponse.json({ success: false, error: "Sessão não encontrada." }, { status: 401 });
  }

  const supabase: SupabaseClient<any, any, any> = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, error: "Sessão inválida." }, { status: 401 });
  }

  let body: {
    idPendencia?: number;
    modo?: string;
    valor?: number;
    idMovimentoRef?: number;
    chaveReserva?: string;
    motivo?: string;
    observacao?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }

  const { idPendencia, modo, valor, idMovimentoRef, chaveReserva, motivo, observacao } = body;
  if (!idPendencia || !modo || !MODOS_VALIDOS.includes(modo)) {
    return NextResponse.json(
      { success: false, error: `idPendencia obrigatório e modo deve ser um de: ${MODOS_VALIDOS.join(", ")}.` },
      { status: 400 }
    );
  }
  if (["DEVOLUCAO", "BONIFICACAO", "BAIXA"].includes(modo) && (!valor || valor <= 0)) {
    return NextResponse.json({ success: false, error: "valor (>0) é obrigatório para este modo." }, { status: 400 });
  }
  if (modo === "ESTORNO" && !idMovimentoRef) {
    return NextResponse.json({ success: false, error: "idMovimentoRef é obrigatório para ESTORNO." }, { status: 400 });
  }
  if ((modo === "CONFIRMAR_RESERVA" || modo === "LIBERAR_RESERVA") && !chaveReserva) {
    return NextResponse.json({ success: false, error: "chaveReserva é obrigatória para este modo." }, { status: 400 });
  }

  const { error: rpcError } = await supabase.rpc("cc_encerrar_pendencia", {
    p_id_pendencia: idPendencia,
    p_modo: modo,
    p_valor: valor ?? null,
    p_id_movimento_ref: idMovimentoRef ?? null,
    p_chave_reserva: chaveReserva ?? null,
    p_motivo: motivo ?? null,
    p_observacao: observacao ?? null,
  });

  if (rpcError) {
    const isPermissao = rpcError.message?.startsWith("PERM:") || rpcError.message?.startsWith("AUTH:");
    const isSaldo = rpcError.message?.includes("CC_SALDO_INSUFICIENTE") || rpcError.message?.includes("CC_RESERVA_ATIVA");
    return NextResponse.json(
      { success: false, error: rpcError.message },
      { status: isPermissao ? 403 : (isSaldo ? 409 : 400) }
    );
  }

  return NextResponse.json({ success: true });
}
