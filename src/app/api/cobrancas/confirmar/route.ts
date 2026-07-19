import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { calcularSituacaoQuitacaoProposta } from "@/features/cobrancas/services/conferencia-financeira.service";
import fs from "fs";
import path from "path";

type UsuarioMinRow = {
  id_perfil: number | null;
  is_super_adm: boolean;
  is_admin: boolean;
};

type PerfilMinRow = {
  permissoes: string[];
};

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!token) {
    return NextResponse.json({ success: false, error: "Sessão não encontrada." }, { status: 401 });
  }
  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, error: "Sessão inválida." }, { status: 401 });
  }
  const userId = authData.user.id;

  // 1. Validar permissão (conferencia.confirm)
  let temPermissao = false;
  {
    const { data: usuarioData } = await supabase
      .from("usuarios")
      .select("id_perfil, is_super_adm, is_admin")
      .eq("user_id", userId)
      .maybeSingle();

    if (usuarioData) {
      const row = usuarioData as UsuarioMinRow;
      if (row.is_super_adm || row.is_admin) {
        temPermissao = true;
      } else if (row.id_perfil != null) {
        const { data: perfilData } = await supabase
          .from("perfis")
          .select("permissoes")
          .eq("id", row.id_perfil)
          .eq("ativo", true)
          .maybeSingle();
        if (perfilData) {
          const permissoes: string[] = Array.isArray(perfilData.permissoes) ? perfilData.permissoes : [];
          temPermissao = permissoes.includes("*") || permissoes.includes("conferencia.confirm");
        }
      }
    }
  }

  if (!temPermissao) {
    return NextResponse.json({ success: false, error: "Sem permissão para confirmar cobrança." }, { status: 403 });
  }

  // 2. Body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }

  const { idCobranca, confirmadoPor, acao } = body;
  if (!idCobranca) {
    return NextResponse.json({ success: false, error: "idCobranca obrigatório." }, { status: 400 });
  }

  // Idempotência baseada no ID da cobrança
  const lockPath = path.join(process.cwd(), `.lock_confirmar_cobranca_${idCobranca}`);
  let lockAdquirido = false;
  const startTime = Date.now();

  while (Date.now() - startTime < 3000) {
    try {
      fs.writeFileSync(lockPath, 'LOCKED', { flag: 'wx' });
      lockAdquirido = true;
      break;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        await new Promise(resolve => setTimeout(resolve, 50));
      } else {
        throw err;
      }
    }
  }

  if (!lockAdquirido) {
    return NextResponse.json(
      { success: false, error: "Confirmação já em processamento. Tente novamente." },
      { status: 503 }
    );
  }

  try {
    // 3. Revalidação da cobrança
    const { data: cobranca, error: cobError } = await supabase
      .from("pagamentos_v2")
      .select("*")
      .eq("id", idCobranca)
      .single();

    if (cobError || !cobranca) {
      return NextResponse.json({ success: false, error: "Cobrança não encontrada." }, { status: 404 });
    }

    if (cobranca.status === "CANCELADO" || cobranca.status === "CANCELADA" || cobranca.status === "EXTORNADO" || cobranca.status === "RECUSADO") {
      return NextResponse.json({ success: false, error: "Não é possível confirmar uma cobrança com status inválido." }, { status: 400 });
    }

    const isAutorizacao = acao === "autorizar_faturamento";
    if (!isAutorizacao && cobranca.confirmado) {
      return NextResponse.json({ success: true, message: "Cobrança já estava confirmada." }); // Idempotente
    }

    // 4. Executar helper (calcularSituacaoQuitacaoProposta) para bloquear se parcial
    const situacao = await calcularSituacaoQuitacaoProposta(supabase, cobranca.id_int, idCobranca);

    // Se é uma liberação normal (não autorização) e a regra bloqueou:
    if (!isAutorizacao && !situacao.podeConfirmar) {
      return NextResponse.json({
        success: false,
        isConferenciaBloqueada: true,
        error: "Confirmação bloqueada: o valor quitado é menor que o total da proposta.",
        situacao
      }, { status: 422 });
    }

    // 5. UPDATE
    const payloadUpdate: any = {};
    if (isAutorizacao) {
      payloadUpdate.status = "A_VENCER";
      payloadUpdate.aprovado_por = confirmadoPor;
    } else {
      payloadUpdate.confirmado = true;
      payloadUpdate.confirmado_por = confirmadoPor;
      payloadUpdate.data_confirmacao = new Date().toISOString();
      if (cobranca.status === "A_RECEBER") {
        payloadUpdate.status = "PAID";
      }
    }

    const { error: updateErr } = await supabase
      .from("pagamentos_v2")
      .update(payloadUpdate)
      .eq("id", idCobranca);

    if (updateErr) {
      throw updateErr;
    }

    // Opcional: disparar automação ou chat aqui (o frontend já pode fazer se quiser, ou fazemos)
    // O sync-status já é feito externamente ou via trigger em alguns casos.
    return NextResponse.json({ success: true });
    
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  } finally {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  }
}
