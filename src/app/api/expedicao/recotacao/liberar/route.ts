import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";

/**
 * Liberar e revogar a recotação de frete de UM pedido.
 *
 * POR QUE EXISTE
 *   Desde 20/08/2026 o expedidor não tem autonomia para recotar. O botão nasce
 *   bloqueado e um admin libera caso a caso, pelo menu Ações da Expedição. A
 *   liberação cobre o fluxo inteiro (ver as opções e aplicar uma delas) e é de
 *   uso único: a aplicação a consome. Recotar sem aplicar não consome.
 *
 *   POST   → libera. Idempotente: pedido já liberado devolve a liberação atual.
 *   DELETE → revoga, enquanto não consumida. Liberação já usada não se desfaz.
 *
 * PERMISSÃO
 *   `expedicao.admin`, que já existia no catálogo de perfis e não era usada em
 *   lugar nenhum. Vale o fallback padrão do projeto: super admin passa sempre, a
 *   chave no perfil passa, e `is_admin` passa por fallback — ou seja, a chave
 *   não restringe quem já é admin; ela existe para poder delegar a liberação a
 *   um supervisor sem dar admin geral do ERP.
 *
 * ONDE A REGRA É GARANTIDA
 *   No banco, não aqui. `exp_liberar_recotacao` e `exp_revogar_recotacao` são
 *   `SECURITY DEFINER` e repetem a checagem de permissão; a unicidade da
 *   liberação ativa é um índice único parcial. Esta rota existe para responder
 *   bem ao usuário, não para ser a tranca.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Corpo = { id_int?: number; motivo?: string | null };

async function contexto(request: Request) {
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
  const motivo = (body?.motivo || "").trim() || null;

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { erro: NextResponse.json({ success: false, message: "Sessão expirada." }, { status: 401 }) };
  }
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return { erro: NextResponse.json({ success: false, message: "id_int inválido." }, { status: 400 }) };
  }
  const podeAdmin = await verificarPermissaoServerSide(supabase, authData.user.id, "expedicao.admin");
  if (!podeAdmin) {
    return {
      erro: NextResponse.json(
        { success: false, message: "Só um administrador da Expedição pode liberar ou cancelar a recotação." },
        { status: 403 }
      )
    };
  }

  const { data: usuarioRow } = await supabase
    .from("usuarios")
    .select("nome_usuario")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  return {
    supabase,
    idInt,
    motivo,
    user: authData.user,
    autorNome: usuarioRow?.nome_usuario || authData.user.email || "Administrador"
  };
}

/** Timeline: best-effort e fora da transação — falhar aqui nunca desfaz a autorização. */
async function timeline(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  idInt: number,
  userId: string,
  autorNome: string,
  autorEmail: string | null,
  mensagem: string
) {
  try {
    const { data: prop } = await supabase.from("propostas").select("id_cliente").eq("id_int", idInt).maybeSingle();
    const { error } = await supabase.from("propostas_chat").insert([
      {
        id_int: idInt,
        id_cliente: prop?.id_cliente ?? null,
        tipo: "SISTEMA",
        setor: "EXPEDICAO",
        autor_uid: userId,
        autor_nome: autorNome,
        autor_email: autorEmail,
        mensagem
      }
    ]);
    if (error) console.warn("[recotacao/liberar] Erro ao gravar na timeline:", error);
  } catch (e) {
    console.warn("[recotacao/liberar] Exceção ao gravar na timeline:", e);
  }
}

export async function POST(request: Request) {
  const ctx = await contexto(request);
  if ("erro" in ctx) return ctx.erro;
  const { supabase, idInt, motivo, user, autorNome } = ctx;

  // Idempotência: o índice parcial garante uma ativa por pedido, e a RPC
  // devolve a existente em vez de falhar. Lemos antes só para saber se houve
  // criação de fato — o que decide se a timeline recebe linha nova.
  const { data: jaAtiva } = await supabase
    .from("expedicao_recotacao_liberacoes")
    .select("id, liberado_em, liberado_por_nome")
    .eq("id_int", idInt)
    .is("consumida_em", null)
    .is("revogada_em", null)
    .maybeSingle();

  const { data: idLiberacao, error } = await supabase.rpc("exp_liberar_recotacao", {
    p_id_int: idInt,
    p_motivo: motivo,
    p_autor_nome: autorNome,
    p_autor_email: user.email ?? null
  });

  if (error) {
    const msg = error.message || "Não foi possível liberar a recotação.";
    return NextResponse.json(
      { success: false, message: msg.replace(/^.*?EXP_LIB_[A-Z_]+:\s*/, "") },
      { status: /EXP_LIB_/.test(msg) ? 409 : 500 }
    );
  }

  if (jaAtiva) {
    return NextResponse.json({
      success: true,
      idempotente: true,
      idLiberacao: jaAtiva.id,
      liberadoEm: jaAtiva.liberado_em,
      liberadoPorNome: jaAtiva.liberado_por_nome
    });
  }

  await timeline(
    supabase,
    idInt,
    user.id,
    autorNome,
    user.email ?? null,
    `🔓 Recotação de frete liberada por ${autorNome}${motivo ? ` — ${motivo}` : ""}. ` +
      `Vale para UMA aplicação: assim que o expedidor aplicar uma opção, a liberação é consumida.`
  );

  return NextResponse.json({ success: true, idempotente: false, idLiberacao, liberadoPorNome: autorNome });
}

export async function DELETE(request: Request) {
  const ctx = await contexto(request);
  if ("erro" in ctx) return ctx.erro;
  const { supabase, idInt, motivo, user, autorNome } = ctx;

  const { data: idLiberacao, error } = await supabase.rpc("exp_revogar_recotacao", {
    p_id_int: idInt,
    p_motivo: motivo,
    p_autor_nome: autorNome
  });

  if (error) {
    const msg = error.message || "Não foi possível cancelar a liberação.";
    return NextResponse.json(
      { success: false, message: msg.replace(/^.*?EXP_LIB_[A-Z_]+:\s*/, "") },
      { status: /EXP_LIB_/.test(msg) ? 409 : 500 }
    );
  }

  await timeline(
    supabase,
    idInt,
    user.id,
    autorNome,
    user.email ?? null,
    `🔒 Liberação de recotação de frete cancelada por ${autorNome}${motivo ? ` — ${motivo}` : ""}.`
  );

  return NextResponse.json({ success: true, idLiberacao });
}
