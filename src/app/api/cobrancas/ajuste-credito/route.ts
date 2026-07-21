/**
 * /api/cobrancas/ajuste-credito/route.ts
 *
 * Ajuste manual avulso (sem proposta) de crédito/débito na conta corrente do
 * cliente. Restrito a administrador/superadministrador — fora do domínio de
 * Conta Corrente/Pendências (v1 não cobre ajuste avulso, id_int=null).
 *
 * ESCRITA: via RPC `mc_ajuste_avulso_criar` (SECURITY DEFINER) — nunca por
 * INSERT direto em movimento_credito. Após o cutover (fase 1b), INSERT direto
 * nessa tabela é revogado de `authenticated`; a RPC é a única via de escrita.
 *
 * IDEMPOTÊNCIA: chave persistida (`chaveIdempotencia`, UUID) por tentativa,
 * gravada em `movimento_credito.chave_idempotencia` — substitui a antiga
 * deduplicação por janela de 60s, que descartava operações legítimas
 * próximas no tempo.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    // ── Auth ──────────────────────────────────────────────────────────────────
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json();
    const { id_cliente, tipo, valor, observacao, chaveIdempotencia } = body;

    // ── Validações de forma (a RPC revalida tudo — checagem final e definitiva) ─
    if (!id_cliente) {
      return NextResponse.json({ error: "id_cliente é obrigatório" }, { status: 400 });
    }
    if (tipo !== "CREDITO" && tipo !== "DEBITO") {
      return NextResponse.json({ error: "tipo inválido. Use CREDITO ou DEBITO." }, { status: 400 });
    }
    if (typeof valor !== "number" || valor <= 0) {
      return NextResponse.json({ error: "valor deve ser um número positivo maior que zero." }, { status: 400 });
    }
    if (!observacao || typeof observacao !== "string" || !observacao.trim()) {
      return NextResponse.json({ error: "A observação é obrigatória para este ajuste administrativo." }, { status: 400 });
    }
    if (!chaveIdempotencia || typeof chaveIdempotencia !== "string" || !/^[0-9a-f-]{36}$/i.test(chaveIdempotencia)) {
      return NextResponse.json({ error: "chaveIdempotencia (UUID) é obrigatória." }, { status: 400 });
    }

    // ── Executar via RPC (permissão admin/superadmin validada dentro dela) ────
    const { data: idMovimento, error: rpcError } = await supabase.rpc("mc_ajuste_avulso_criar", {
      p_id_cliente: id_cliente,
      p_tipo: tipo,
      p_valor: valor,
      p_observacao: observacao.trim(),
      p_chave_idempotencia: chaveIdempotencia,
    });

    if (rpcError) {
      const status = rpcError.message?.startsWith("PERM:") || rpcError.message?.startsWith("AUTH:") ? 403 : 400;
      return NextResponse.json({ error: rpcError.message }, { status });
    }

    return NextResponse.json({ success: true, id: idMovimento });
  } catch (error) {
    console.error("[POST /api/cobrancas/ajuste-credito] Erro:", error);
    const message = error instanceof Error ? error.message : "Erro ao processar ajuste manual";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
