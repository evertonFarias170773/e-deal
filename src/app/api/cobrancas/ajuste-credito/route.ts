import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { registrarMovimento } from "@/features/cobrancas/services/movimento-credito.service";

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
    const { id_cliente, tipo, valor, observacao } = body;

    // ── Validações ────────────────────────────────────────────────────────────
    if (!id_cliente) {
      return NextResponse.json(
        { error: "id_cliente é obrigatório" },
        { status: 400 }
      );
    }

    // Verifica se o cliente existe no banco
    const { data: clienteExiste } = await supabase
      .from("clientes")
      .select("id_cliente")
      .eq("id_cliente", id_cliente)
      .maybeSingle();

    if (!clienteExiste) {
      return NextResponse.json(
        { error: "Cliente não encontrado." },
        { status: 404 }
      );
    }

    if (tipo !== "CREDITO" && tipo !== "DEBITO") {
      return NextResponse.json(
        { error: "tipo inválido. Use CREDITO ou DEBITO." },
        { status: 400 }
      );
    }

    if (typeof valor !== "number" || valor <= 0) {
      return NextResponse.json(
        { error: "valor deve ser um número positivo maior que zero." },
        { status: 400 }
      );
    }

    if (!observacao || typeof observacao !== "string" || !observacao.trim()) {
      return NextResponse.json(
        { error: "A observação é obrigatória para este ajuste administrativo." },
        { status: 400 }
      );
    }

    // ── Idempotência para id_int=null (ajustes manuais) ───────────────────────
    // Evita duplicatas por duplo clique / retry (janela de 60 segundos)
    const umMinAtras = new Date(Date.now() - 60 * 1000).toISOString();
    const { data: duplicado } = await supabase
      .from("movimento_credito")
      .select("id")
      .eq("id_cliente", id_cliente)
      .eq("tipo", tipo)
      .eq("valor", valor)
      .eq("cancelado", false)
      .is("id_int", null)
      .gte("created_at", umMinAtras)
      .limit(1)
      .maybeSingle();

    if (duplicado) {
      console.info(
        `[ajuste-credito] Idempotência: retornando movimento existente id=${duplicado.id}`
      );
      return NextResponse.json({ success: true, id: duplicado.id });
    }

    // ── Registrar movimento ───────────────────────────────────────────────────
    const result = await registrarMovimento(
      {
        id_cliente,
        id_int: null,
        valor,
        tipo,
        origem: "AJUSTE",
        observacao: observacao.trim(),
        created_by: user.id,
      },
      supabase
    );

    if (!result.success) {
      return NextResponse.json({ error: result.errorMessage }, { status: 400 });
    }

    return NextResponse.json({ success: true, id: result.id });
  } catch (error) {
    console.error("[POST /api/cobrancas/ajuste-credito] Erro:", error);
    const message = error instanceof Error ? error.message : "Erro ao processar ajuste manual";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
