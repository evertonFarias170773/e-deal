import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";

/**
 * Marcar (e desmarcar) um pedido como FATURADO NO SISTEMA ANTIGO.
 *
 * POR QUE EXISTE
 *   A operação roda em dois sistemas durante a transição. As notas dos pedidos
 *   antigos foram emitidas no sistema antigo, e esses pedidos poluem a Fila de
 *   Faturamento do Vibe. Ação TEMPORÁRIA, de transição.
 *
 *   Marcar grava `propostas.faturado_fora_em` + `faturado_fora_por` (migration
 *   20260914_propostas_faturado_fora). Com a marca, o pedido some da Fila de
 *   Faturamento — e só dela. Continua em Orçamentos, com badge e com o desfazer
 *   no menu da linha.
 *
 *   POST { id_int, marcar: true }  → marca (ação da Fila de Faturamento).
 *   POST { id_int, marcar: false } → desmarca (menu da linha em Orçamentos):
 *                                    volta as duas colunas para NULL.
 *
 *   Idempotente nos dois sentidos, como `encerrar-teste`: marcar pedido já
 *   marcado preserva o carimbo original e devolve `idempotente: true`, sem
 *   linha nova na timeline.
 *
 * POR QUE NÃO `libera_nf`
 *   `liberarPropostaParaProducao` regrava `libera_nf = true` a cada liberação
 *   para produção — o pedido voltaria à fila sozinho —, e desligá-la apagaria a
 *   diferença entre "nunca liberado" e "faturado fora". Esta rota NÃO toca em
 *   `libera_nf`, `status_interno`, `liberado_producao_em` nem em nota fiscal.
 *
 * PERMISSÃO
 *   `propostas.release_nf` ("Liberar para Nota Fiscal"), que já existia no
 *   catálogo: é a decisão sobre o pedido entrar ou não no faturamento, o mesmo
 *   alcance desta ação. Hoje está nos perfis Administrador e Financeiro; Super
 *   Administrador passa pelo curinga e `is_admin` pelo fallback padrão.
 *
 * A ROTA É A TRANCA DO APP — E SÓ DO APP
 *   A RLS de `public.propostas` é aberta para `authenticated`. Mesma ressalva de
 *   `encerrar-teste`: alguém autenticado ainda consegue escrever a coluna pelo
 *   PostgREST direto. Fechar isso é apertar a RLS da tabela, decisão maior.
 *
 * O MOTIVO
 *   Vai para a linha do tempo do pedido (`propostas_chat`, tipo SISTEMA,
 *   `visivel_externo: false`). Best-effort: falhar ali nunca desfaz a marcação.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Corpo = { id_int?: number; marcar?: boolean; motivo?: string | null };

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
  const marcar = body?.marcar === true;
  const motivo = (body?.motivo || "").trim() || null;

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão expirada." }, { status: 401 });
  }
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int inválido." }, { status: 400 });
  }

  const pode = await verificarPermissaoServerSide(supabase, authData.user.id, "propostas.release_nf");
  if (!pode) {
    return NextResponse.json(
      { success: false, message: "Sem permissão para tirar pedido do faturamento (propostas.release_nf)." },
      { status: 403 }
    );
  }

  const { data: atual, error: leituraErro } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, faturado_fora_em, faturado_fora_por")
    .eq("id_int", idInt)
    .maybeSingle();

  if (leituraErro) {
    return NextResponse.json(
      { success: false, message: leituraErro.message || "Erro ao ler a proposta." },
      { status: 500 }
    );
  }
  if (!atual) {
    return NextResponse.json({ success: false, message: `Proposta #${idInt} não encontrada.` }, { status: 404 });
  }

  const jaEstavaMarcado = atual.faturado_fora_em !== null;
  if (jaEstavaMarcado === marcar) {
    return NextResponse.json({
      success: true,
      idempotente: true,
      marcado: jaEstavaMarcado,
      faturadoForaEm: atual.faturado_fora_em,
      faturadoForaPor: atual.faturado_fora_por
    });
  }

  const autorEmail = authData.user.email ?? null;
  const carimbo = new Date().toISOString();

  // SÓ as duas colunas. Nada de libera_nf, status_interno ou liberado_producao_em.
  const { data: gravado, error: updateErro } = await supabase
    .from("propostas")
    .update(
      marcar
        ? { faturado_fora_em: carimbo, faturado_fora_por: autorEmail }
        : { faturado_fora_em: null, faturado_fora_por: null }
    )
    .eq("id_int", idInt)
    .select("id_int, faturado_fora_em, faturado_fora_por")
    .single();

  if (updateErro || !gravado) {
    return NextResponse.json(
      { success: false, message: updateErro?.message || "Não foi possível gravar a marcação." },
      { status: 500 }
    );
  }

  // Timeline: best-effort e fora da transação — falhar aqui nunca desfaz a marcação.
  try {
    const { data: usuarioRow } = await supabase
      .from("usuarios")
      .select("nome_usuario")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    const autorNome = usuarioRow?.nome_usuario || autorEmail || "Usuário";

    const mensagem = marcar
      ? `🗂️ Pedido marcado como FATURADO NO SISTEMA ANTIGO por ${autorNome}${motivo ? ` — ${motivo}` : ""}. ` +
        `A nota fiscal foi emitida fora do Vibe; o pedido sai da Fila de Faturamento. ` +
        `Nada mais muda: liberação para nota, status e produção seguem como estavam.`
      : `↩️ Marca de FATURADO NO SISTEMA ANTIGO removida por ${autorNome}${motivo ? ` — ${motivo}` : ""}. ` +
        `O pedido volta para a Fila de Faturamento.`;

    const { error: chatErro } = await supabase.from("propostas_chat").insert([
      {
        id_int: idInt,
        id_cliente: atual.id_cliente ?? null,
        tipo: "SISTEMA",
        setor: "Financeiro",
        visivel_externo: false,
        autor_uid: authData.user.id,
        autor_nome: autorNome,
        autor_email: autorEmail,
        mensagem
      }
    ]);
    if (chatErro) console.warn("[faturado-fora] Erro ao gravar na timeline:", chatErro);
  } catch (e) {
    console.warn("[faturado-fora] Exceção ao gravar na timeline:", e);
  }

  return NextResponse.json({
    success: true,
    idempotente: false,
    marcado: gravado.faturado_fora_em !== null,
    faturadoForaEm: gravado.faturado_fora_em,
    faturadoForaPor: gravado.faturado_fora_por
  });
}
