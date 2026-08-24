import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";

/**
 * MARCA no ERP que a prepostagem dos Correios foi cancelada — no portal deles.
 *
 * O QUE ESTA ROTA NÃO FAZ
 *   Não chama a API dos Correios. Não existe cancelamento de prepostagem no
 *   ERP: quando a etiqueta sai errada, quem cancela é uma pessoa no portal dos
 *   Correios. O que faltava era o sistema SABER disso — sem essa marca, a tela
 *   seguia exibindo o rastreio e oferecendo a etiqueta oficial de um objeto que
 *   já não vale.
 *
 * O QUE ELA GRAVA
 *   Só as três colunas da marcação. `correios_id_prepostagem`,
 *   `correios_codigo_objeto` e `codigo_rastreamento` ficam EXATAMENTE como
 *   estão: a marcação muda o que a tela mostra, nunca o que o banco guarda
 *   sobre o objeto emitido. Apagar seria destruir a prova de que ele existiu.
 *
 * AUTORIA VEM DA SESSÃO, NUNCA DO CORPO
 *   `prepostagem_cancelada_por` sai de `auth.getUser()` no servidor e o nome de
 *   `usuarios.nome_usuario`. O cliente manda apenas `id_int` — quem marcou não
 *   é informação que o navegador possa escolher.
 *
 * PERMISSÃO
 *   `expedicao.admin`, verificada no SERVIDOR, mesmo padrão de
 *   `/api/expedicao/recotacao/liberar`. Esconder o item no menu é conveniência
 *   de UI; a regra de verdade é esta.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Corpo = { id_int?: number };

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supabase = token
    ? createSupabaseClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : await createServerSupabaseClient();

  const body = (await request.json().catch(() => null)) as Corpo | null;
  const idInt = Number(body?.id_int);

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão expirada." }, { status: 401 });
  }
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int inválido." }, { status: 400 });
  }

  const podeAdmin = await verificarPermissaoServerSide(supabase, authData.user.id, "expedicao.admin");
  if (!podeAdmin) {
    return NextResponse.json(
      { success: false, message: "Só um administrador da Expedição pode marcar a prepostagem como cancelada." },
      { status: 403 }
    );
  }

  const { data: exp, error: expErr } = await supabase
    .from("expedicoes")
    .select("correios_id_prepostagem, correios_codigo_objeto, prepostagem_cancelada_em")
    .eq("id_int", idInt)
    .maybeSingle();

  if (expErr) {
    return NextResponse.json({ success: false, message: `Falha ao ler a expedição: ${expErr.message}` }, { status: 500 });
  }
  if (!exp?.correios_id_prepostagem) {
    return NextResponse.json(
      { success: false, message: "Este pedido não tem prepostagem dos Correios para marcar como cancelada." },
      { status: 409 }
    );
  }
  // Idempotente: marcar duas vezes não reescreve quem marcou nem quando.
  if (exp.prepostagem_cancelada_em) {
    return NextResponse.json({
      success: true,
      jaMarcada: true,
      canceladaEm: String(exp.prepostagem_cancelada_em)
    });
  }

  const { data: usuarioRow } = await supabase
    .from("usuarios")
    .select("nome_usuario")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  const autorNome = usuarioRow?.nome_usuario || authData.user.email || "Administrador";

  const agora = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("expedicoes")
    .update({
      prepostagem_cancelada_em: agora,
      prepostagem_cancelada_por: authData.user.id,
      prepostagem_cancelada_por_nome: autorNome,
      updated_at: agora
    })
    .eq("id_int", idInt)
    // Guarda otimista: se outra pessoa marcou no meio do caminho, esta escrita
    // casa zero linhas em vez de sobrescrever a autoria dela.
    .is("prepostagem_cancelada_em", null);

  if (upErr) {
    return NextResponse.json({ success: false, message: `Falha ao marcar: ${upErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    canceladaEm: agora,
    codigoObjeto: exp.correios_codigo_objeto ?? null
  });
}
