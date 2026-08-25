/**
 * "Esta cobrança pode ser cancelada?" — LEITURA PURA, para a UI.
 *
 * Existe para que a tela reflita o servidor em vez de decidir por conta
 * própria: até aqui `CobrancasProvider` recusava o cancelamento no navegador,
 * sem que requisição nenhuma saísse. O modal passa a consultar esta rota e a
 * exibir a mesma mensagem que a rota de escrita produziria — porque as duas
 * chamam o mesmo coletor.
 *
 * NENHUMA ESCRITA. Se algum dia esta rota precisar gravar, ela deixou de ser
 * esta rota.
 *
 * Spec: docs/superpowers/specs/2026-08-25-cancelamento-cobranca-refaturamento-design.md
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { verificarEscopoPropostaServerSide } from "@/lib/auth/verificar-escopo-proposta";
import { avaliarCancelamentoNoServidor } from "@/features/cobrancas/services/cancelamento-elegibilidade.server";

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim() || "";
    if (!id) {
      return NextResponse.json({ success: false, message: "Cobrança não informada." }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      console.error("[pode-cancelar] ENV AUSENTE");
      return NextResponse.json(
        { success: false, message: "Erro interno no servidor de banco de dados." },
        { status: 500 }
      );
    }

    // 1. Sessão — mesmo padrão de cancelar-externo: JWT do usuário, sem
    //    service role, para a RLS continuar valendo.
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

    // 2. Permissão — a MESMA cascata da rota de escrita. Se divergisse, a tela
    //    ofereceria o cancelamento a quem a rota depois recusaria (ou o
    //    contrário), que é exatamente o problema que este desenho resolve.
    const temCancelamentoFinanceiro = await verificarPermissaoServerSide(
      supabase,
      authData.user.id,
      "cobrancas.cancel"
    );
    if (!temCancelamentoFinanceiro) {
      const temCancelamentoRestrito = await verificarPermissaoServerSide(
        supabase,
        authData.user.id,
        "propostas.cancelar_cobranca_nao_paga"
      );
      if (!temCancelamentoRestrito) {
        return NextResponse.json(
          { success: false, message: "Sem permissão para cancelar cobrança (cobrancas.cancel)." },
          { status: 403 }
        );
      }
    }

    // 3. O veredito. Toda a leitura acontece aqui dentro.
    const resultado = await avaliarCancelamentoNoServidor(supabase, id);

    if (!resultado.ok) {
      return NextResponse.json(
        { success: false, code: resultado.erro, message: resultado.mensagem },
        { status: resultado.erro === "NAO_ENCONTRADA" ? 404 : 503 }
      );
    }

    // 4. Escopo pela PROPOSTA, conferido ANTES de devolver qualquer detalhe da
    //    cobrança — mesma regra de cancelar-externo, e mesma resposta genérica
    //    para não revelar dados a quem está fora do escopo. A leitura do passo
    //    3 já aconteceu, mas nada dela sai daqui neste ramo.
    const { data: usuarioRow } = await supabase
      .from("usuarios")
      .select("is_super_adm")
      .eq("user_id", authData.user.id)
      .maybeSingle<{ is_super_adm: boolean | null }>();

    if (!usuarioRow) {
      return NextResponse.json({ success: false, message: "Acesso negado a esta cobrança." }, { status: 403 });
    }

    if (!usuarioRow.is_super_adm) {
      const { data: propostaDoPagamento } = await supabase
        .from("propostas")
        .select("empresa, vendedor")
        .eq("id_int", resultado.pagamento.id_int)
        .maybeSingle<{ empresa: string | null; vendedor: string | null }>();

      const escopoOk = propostaDoPagamento
        ? await verificarEscopoPropostaServerSide(supabase, authData.user.id, {
            empresa: propostaDoPagamento.empresa,
            vendedor: propostaDoPagamento.vendedor
          })
        : false;

      if (!escopoOk) {
        console.warn("[pode-cancelar] Escopo de proposta negado", {
          userId: authData.user.id,
          idInt: resultado.pagamento.id_int
        });
        return NextResponse.json({ success: false, message: "Acesso negado a esta cobrança." }, { status: 403 });
      }
    }

    const { veredito } = resultado;

    // O dossiê inteiro NÃO sai daqui: a tela precisa do veredito, não dos
    // dados brutos que o produziram.
    return NextResponse.json({
      success: true,
      pode: veredito.pode,
      code: veredito.code,
      message: veredito.message,
      ...(veredito.acao ? { acao: veredito.acao } : {}),
      fluxo: veredito.fluxo,
      jaInativa: veredito.jaInativa,
      titulosEmAberto: veredito.titulosEmAberto,
      recusas: veredito.recusas.map((r) => r.code)
    });
  } catch (error: unknown) {
    console.error("[pode-cancelar] Exceção na API route:", error);
    return NextResponse.json(
      { success: false, message: "Falha inesperada ao verificar o cancelamento." },
      { status: 500 }
    );
  }
}
