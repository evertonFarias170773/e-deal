import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { gravarValorFreteNegociado } from "@/features/orcamentos/services/valor-frete-negociado";

/**
 * Valor negociado do frete, pelo bloco admin da aba Fretes.
 *
 * Mesma porta estreita de `/api/propostas/transportadora`: JWT do usuário (a
 * auditoria de `propostas` precisa do autor), permissão `expedicao.admin`
 * conferida aqui, no servidor, e nada de `saveProposta` nem `cotacao_frete`.
 *
 * A regra — o que grava, o que recusa e o que faz com a diferença — mora em
 * `features/orcamentos/services/valor-frete-negociado.ts`. Esta rota autentica,
 * lê o corpo e traduz o resultado em HTTP.
 */

export const maxDuration = 30;

const PERMISSAO = "expedicao.admin";

export async function POST(request: Request) {
  try {
    let idInt = 0;
    let valorFrete = Number.NaN;
    let chaveEvento: string | null = null;
    try {
      const body = (await request.json()) as { idInt?: unknown; valorFrete?: unknown; chaveEvento?: unknown };
      idInt = Number(body?.idInt ?? 0);
      valorFrete = body?.valorFrete === null || body?.valorFrete === undefined || body?.valorFrete === "" ? Number.NaN : Number(body.valorFrete);
      chaveEvento = typeof body?.chaveEvento === "string" ? body.chaveEvento : null;
    } catch {
      return NextResponse.json({ success: false, message: "Corpo da requisição inválido." }, { status: 400 });
    }

    if (!Number.isFinite(idInt) || idInt <= 0) {
      return NextResponse.json({ success: false, message: "Pedido não informado." }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      console.error("[API][PropostaValorFrete] ENV AUSENTE");
      return NextResponse.json(
        { success: false, message: "Erro interno no servidor de banco de dados." },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
    }

    const supabase = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
    }

    const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, PERMISSAO);
    if (!temPermissao) {
      return NextResponse.json(
        { success: false, code: "SEM_PERMISSAO", message: `Sem permissão para corrigir o frete da proposta (${PERMISSAO}).` },
        { status: 403 }
      );
    }

    const email = authData.user.email ?? "";
    const resultado = await gravarValorFreteNegociado(supabase, {
      idInt,
      valorFrete,
      chaveEvento,
      ator: { uid: authData.user.id, nome: email || "Sistema", email }
    });

    if (!resultado.ok) {
      return NextResponse.json(
        { success: false, code: resultado.code, message: resultado.mensagem, gravado: resultado.gravado },
        { status: resultado.status }
      );
    }

    return NextResponse.json({ success: true, ...resultado });
  } catch (err) {
    console.error("[API][PropostaValorFrete] Erro inesperado:", err);
    return NextResponse.json(
      { success: false, message: "Erro inesperado ao gravar o valor do frete." },
      { status: 500 }
    );
  }
}
