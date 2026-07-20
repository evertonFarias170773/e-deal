import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { calcularSituacaoQuitacaoProposta } from "@/features/cobrancas/services/conferencia-financeira.service";
import { aplicarStatusRecomendadoProposta } from "@/features/orcamentos/services/status-writer.service";
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

    // ── 6. Abatimento de débito da conta corrente ──────────────────────────
    // Se esta cobrança foi criada incluindo abatimento de débito (marcador em
    // obs_v2, gravado por PropostaCobrancaPanel), o crédito na conta corrente
    // só é registrado agora — quando o pagamento é de fato confirmado, nunca
    // no momento da criação da cobrança (evita creditar dinheiro não recebido).
    // "autorizar_faturamento" não é confirmação de recebimento, é só pré-aprovação
    // de faturado — não dispara o abatimento.
    if (!isAutorizacao) {
      const marcador = String(cobranca.obs_v2 || "").match(/\[ABATIMENTO_DEBITO:(\d+(?:\.\d{1,2})?)\]/);
      if (marcador && cobranca.id_cliente) {
        const valorAbatimento = Math.round(parseFloat(marcador[1]) * 100) / 100;
        if (valorAbatimento > 0) {
          const { data: jaRegistrado } = await supabase
            .from("movimento_credito")
            .select("id")
            .eq("id_cliente", cobranca.id_cliente)
            .eq("tipo", "CREDITO")
            .eq("cancelado", false)
            .ilike("observacao", `%pagamento ${idCobranca}%`)
            .limit(1)
            .maybeSingle();

          if (!jaRegistrado) {
            const obsMovimento = `Abatimento de débito via cobrança confirmada (pagamento ${idCobranca}${cobranca.id_int ? `, proposta #${cobranca.id_int}` : ""}). Operador: ${confirmadoPor || "Sistema"}.`;
            const { error: errMovimento } = await supabase
              .from("movimento_credito")
              .insert({
                id_cliente: cobranca.id_cliente,
                id_int: cobranca.id_int ?? null,
                valor: valorAbatimento,
                tipo: "CREDITO",
                origem: "SISTEMA",
                observacao: obsMovimento,
                created_by: userId,
                cancelado: false,
              });

            if (errMovimento) {
              console.error("[confirmar] Falha ao registrar abatimento de débito:", errMovimento.message);
            } else if (cobranca.id_int) {
              await supabase.from("propostas_chat").insert([{
                id_int: cobranca.id_int,
                id_cliente: cobranca.id_cliente,
                mensagem: `💳 Débito de R$ ${valorAbatimento.toFixed(2).replace(".", ",")} abatido na conta corrente após confirmação do pagamento.`,
                tipo: "SISTEMA",
                autor_nome: "Sistema",
                setor: "Financeiro",
                visivel_externo: false,
                anexos: null,
              }]);
            }
          }
        }
      }
    }

    // ── 7. Reconciliar status_interno pelo fluxo oficial ─────────────────────
    // Confirmação de pagamento é um dos eventos que exigem reavaliação (nunca
    // confiar em formState.status do cliente). Best-effort: nunca falha a
    // confirmação do pagamento em si; "autorizar_faturamento" não é recebimento
    // real, não reconcilia aqui.
    if (!isAutorizacao && cobranca.id_int) {
      const reconciliacao = await aplicarStatusRecomendadoProposta(
        cobranca.id_int,
        { uid: userId, nome: confirmadoPor || authData.user.email || "Sistema", email: authData.user.email || "" },
        supabase,
        "AUTO_FINANCEIRO"
      );
      if (!reconciliacao.success) {
        console.warn(`[confirmar] Reconciliação de status sem efeito para proposta #${cobranca.id_int}: ${reconciliacao.errorMessage}`);
      }
    }

    return NextResponse.json({ success: true });
    
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  } finally {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  }
}
