/**
 * /api/cobrancas/estorno-credito/route.ts
 *
 * Estorno de um lançamento AVULSO (sem proposta) de movimento_credito, por
 * lançamento compensatório — nunca por UPDATE (movimento_credito é
 * append-only). Restrito a administrador/superadministrador.
 *
 * ESCRITA: via RPC `mc_ajuste_avulso_estornar` (SECURITY DEFINER) — nunca por
 * INSERT direto. A RPC também revalida escopo (origem=AJUSTE, sem proposta) e
 * idempotência (índice único em id_movimento_ref WHERE tipo_evento=ESTORNO).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Origens que indicam vínculo com proposta — não podem ser estornadas por esta tela. */
const ORIGENS_VINCULADAS_PROPOSTA = new Set([
  "PROPOSTA_ALTERADA",
  "CONSUMO_CREDITO",
  "CONSUMO",
  "PROPOSTA",
  "CANCELAMENTO",
]);

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
    const { id_movimento } = body;

    if (!id_movimento) {
      return NextResponse.json({ error: "id_movimento é obrigatório" }, { status: 400 });
    }

    // ── Pré-checagem de escopo para mensagem de erro clara (a RPC revalida) ───
    const { data: mov, error: errFetch } = await supabase
      .from("movimento_credito")
      .select("id, origem, id_int, cancelado")
      .eq("id", id_movimento)
      .single();

    if (errFetch || !mov) {
      return NextResponse.json({ error: "Movimento não encontrado." }, { status: 404 });
    }

    if (mov.cancelado) {
      return NextResponse.json({ error: "Este movimento já está cancelado." }, { status: 400 });
    }

    if (ORIGENS_VINCULADAS_PROPOSTA.has(mov.origem) || mov.id_int != null) {
      return NextResponse.json(
        { error: "Este movimento está vinculado a uma proposta e não pode ser estornado por esta tela." },
        { status: 400 }
      );
    }

    // ── Executar via RPC (permissão admin/superadmin validada dentro dela) ────
    const { data: idEstorno, error: rpcError } = await supabase.rpc("mc_ajuste_avulso_estornar", {
      p_id_movimento: id_movimento,
      p_observacao: null,
    });

    if (rpcError) {
      const status = rpcError.message?.startsWith("PERM:") || rpcError.message?.startsWith("AUTH:") ? 403 : 400;
      return NextResponse.json({ error: rpcError.message }, { status });
    }

    return NextResponse.json({ success: true, id: idEstorno });
  } catch (error) {
    console.error("[POST /api/cobrancas/estorno-credito] Erro:", error);
    const message = error instanceof Error ? error.message : "Erro ao estornar movimento";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
