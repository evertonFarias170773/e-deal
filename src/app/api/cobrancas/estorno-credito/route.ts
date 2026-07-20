import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { estornarMovimentoCredito } from "@/features/cobrancas/services/movimento-credito.service";

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

    // ── Permissão ─────────────────────────────────────────────────────────────
    const { data: usuarioData } = await supabase
      .from("usuarios")
      .select("is_super_adm, is_admin")
      .eq("user_id", user.id)
      .maybeSingle();

    const isAdm = usuarioData?.is_super_adm || usuarioData?.is_admin;
    if (!isAdm) {
      return NextResponse.json(
        { error: "Apenas administradores podem realizar esta operação de crédito." },
        { status: 403 }
      );
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json();
    const { id_movimento } = body;

    if (!id_movimento) {
      return NextResponse.json(
        { error: "id_movimento é obrigatório" },
        { status: 400 }
      );
    }

    // ── Buscar movimento para validação de origem ─────────────────────────────
    const { data: mov, error: errFetch } = await supabase
      .from("movimento_credito")
      .select("id, origem, id_int, cancelado")
      .eq("id", id_movimento)
      .single();

    if (errFetch || !mov) {
      return NextResponse.json(
        { error: "Movimento não encontrado." },
        { status: 404 }
      );
    }

    if (mov.cancelado) {
      return NextResponse.json(
        { error: "Este movimento já está cancelado." },
        { status: 400 }
      );
    }

    // Bloqueia estorno de movimentos vinculados a propostas
    if (ORIGENS_VINCULADAS_PROPOSTA.has(mov.origem)) {
      return NextResponse.json(
        {
          error:
            "Este movimento está vinculado a uma proposta e não pode ser estornado por esta tela.",
        },
        { status: 400 }
      );
    }

    // Guarda secundária: movimentos com id_int preenchido são de propostas
    if (mov.id_int != null) {
      return NextResponse.json(
        {
          error:
            "Este movimento está vinculado a uma proposta (id_int) e não pode ser estornado por esta tela.",
        },
        { status: 400 }
      );
    }

    // ── Executar estorno ──────────────────────────────────────────────────────
    const result = await estornarMovimentoCredito(
      id_movimento,
      user.id,
      supabase
    );

    if (!result.success) {
      return NextResponse.json({ error: result.errorMessage }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[POST /api/cobrancas/estorno-credito] Erro:", error);
    const message = error instanceof Error ? error.message : "Erro ao estornar movimento";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
