/**
 * /api/conta-corrente/usar/route.ts
 *
 * Rota fina: autentica, e delega para a RPC `cc_usar_pendencia`
 * (SECURITY DEFINER, search_path fixo, valida auth.uid()/permissão no banco).
 * Toda a lógica sensível (trava de linha, invariante de saldo, uso único)
 * vive na RPC — ver supabase/migrations/20260721_conta_corrente_fase1a_aditiva.sql.
 *
 * modo:
 *  - CREDITO_IMEDIATO: consome uma pendência FAVOR_CLIENTE e credita um pagamento já criado.
 *  - RESERVA_DEBITO: reserva uma pendência FAVOR_EMPRESA contra uma cobrança já criada
 *    (pagamentos_v2 pendente). Nenhuma integração externa ocorre nesta rota — a reserva
 *    é confirmada/liberada depois, via /api/conta-corrente/encerrar.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

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
    valor?: number;
    modo?: "CREDITO_IMEDIATO" | "RESERVA_DEBITO";
    idIntDestino?: number;
    idPagamento?: string;
    chaveReserva?: string;
    observacao?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }

  const { idPendencia, valor, modo, idIntDestino, idPagamento, chaveReserva, observacao } = body;
  if (!idPendencia || !valor || valor <= 0 || !modo) {
    return NextResponse.json(
      { success: false, error: "idPendencia, valor (>0) e modo são obrigatórios." },
      { status: 400 }
    );
  }
  if (modo === "RESERVA_DEBITO" && (!idPagamento || !chaveReserva)) {
    return NextResponse.json(
      { success: false, error: "idPagamento e chaveReserva são obrigatórios no modo RESERVA_DEBITO." },
      { status: 400 }
    );
  }

  const { data: movimentoId, error: rpcError } = await supabase.rpc("cc_usar_pendencia", {
    p_id_pendencia: idPendencia,
    p_valor: valor,
    p_modo: modo,
    p_id_int_destino: idIntDestino ?? null,
    p_id_pagamento: idPagamento ?? null,
    p_chave_reserva: chaveReserva ?? null,
    p_observacao: observacao ?? null,
  });

  if (rpcError) {
    const isPermissao = rpcError.message?.startsWith("PERM:") || rpcError.message?.startsWith("AUTH:");
    const isSaldo = rpcError.message?.includes("CC_SALDO_INSUFICIENTE") || rpcError.message?.includes("CC_RESIDUO");
    return NextResponse.json(
      { success: false, error: rpcError.message },
      { status: isPermissao ? 403 : (isSaldo ? 409 : 400) }
    );
  }

  return NextResponse.json({ success: true, movimentoId: movimentoId ?? null });
}
