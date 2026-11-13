/**
 * POST /api/cobrancas/registrar-devolucao — "Registrar devolução e cancelar
 * pedido" (13/11/2026, caso 25098).
 *
 * O dinheiro já foi devolvido pelo aplicativo do banco: esta rota NÃO chama
 * nenhuma API de banco. Ela confere a forma dos campos e chama, com a sessão
 * do usuário, a função `fin_registrar_devolucao_e_cancelar`, que decide tudo
 * numa transação: só super admin, só cobrança paga com dinheiro, só o valor
 * total, as travas (nota, produção, despacho, outras cobranças, crédito,
 * mês fechado) e sem gravar em dobro.
 *
 * Corpo: { idPagamento, valor, dataDevolucao (AAAA-MM-DD), e2eId?, comprovante?,
 *          motivo, confirmaMesFechado? }
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  codigoDoErro,
  dataCivilSaoPaulo,
  normalizarE2e,
  problemaNosCampos,
  statusHttpDoErro,
  textoDoErro
} from "@/features/cobrancas/lib/devolucao-pagamento";

function erro(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return erro("DEV_PARAMS", "Corpo da requisição inválido.", 400);

  const idPagamento = String(body.idPagamento ?? "").trim();
  const valor = Number(body.valor);
  const campos = {
    dataDevolucao: String(body.dataDevolucao ?? "").trim(),
    e2eId: String(body.e2eId ?? ""),
    comprovante: String(body.comprovante ?? ""),
    motivo: String(body.motivo ?? "")
  };
  const confirmaMesFechado = body.confirmaMesFechado === true;

  if (!/^[0-9a-f-]{36}$/i.test(idPagamento)) return erro("DEV_PARAMS", "Cobrança não informada.", 400);
  if (!Number.isFinite(valor) || valor <= 0) return erro("DEV_VALOR", "Informe o valor da devolução.", 400);
  // A data do pagamento é conferida pela função (ela lê a cobrança).
  const problema = problemaNosCampos(campos, dataCivilSaoPaulo(new Date())!, null);
  if (problema) return erro("DEV_PARAMS", problema, 400);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return erro("FALHA", "Configuração de ambiente incompleta.", 500);

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return erro("DEV_AUTH", "Sessão não encontrada.", 401);

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return erro("DEV_AUTH", "Sessão inválida.", 401);

  const e2e = normalizarE2e(campos.e2eId);
  const { data, error } = await supabase.rpc("fin_registrar_devolucao_e_cancelar", {
    p_id_pagamento: idPagamento,
    p_valor: Math.round(valor * 100) / 100,
    p_data_devolucao: campos.dataDevolucao,
    p_e2e_id: e2e || null,
    p_comprovante: campos.comprovante.trim() || null,
    p_motivo: campos.motivo.trim(),
    p_confirma_mes_fechado: confirmaMesFechado
  });

  if (error) {
    const code = codigoDoErro(error.message);
    if (code === "FALHA") {
      console.error("[registrar-devolucao] falha na função:", error.message);
      return erro("FALHA", "Não foi possível registrar a devolução. Nada foi alterado.", 500);
    }
    return erro(code, textoDoErro(error.message), statusHttpDoErro(code));
  }

  const resultado = (data ?? {}) as {
    ja_registrada?: boolean;
    id_devolucao?: number;
    id_int?: number;
    valor?: number;
    ref_cobranca?: string;
  };
  return NextResponse.json({
    success: true,
    jaRegistrada: resultado.ja_registrada === true,
    idDevolucao: resultado.id_devolucao ?? null,
    idInt: resultado.id_int ?? null,
    valor: resultado.valor ?? null,
    refCobranca: resultado.ref_cobranca ?? null
  });
}
