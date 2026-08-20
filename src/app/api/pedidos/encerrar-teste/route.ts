import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";

/**
 * Encerrar (e reabrir) um pedido de TESTE.
 *
 * POR QUE EXISTE
 *   A transição do sistema antigo deixou pedidos de teste nas filas de
 *   trabalho. Ninguém quer deletá-los — o histórico e a trilha de auditoria são
 *   reais. O que incomoda é a poluição das listas operacionais.
 *
 *   Marcar grava `propostas.encerrado_teste_em` + `encerrado_teste_por`. Com a
 *   marca, o pedido some do painel geral de Produção, do Kanban, da fila de
 *   impressão, do painel de Expedição e do bloco Produção do dashboard. Continua
 *   acessível por URL direta, por busca por número e visível em Orçamentos com
 *   badge — que é justamente o caminho de volta.
 *
 *   POST { id_int, encerrar: true }  → marca.
 *   POST { id_int, encerrar: false } → reabre (volta a coluna para NULL).
 *
 *   Idempotente nos dois sentidos: marcar pedido já marcado preserva o carimbo
 *   original (quem marcou primeiro é quem fica no registro) e devolve
 *   `idempotente: true`, sem linha nova na timeline.
 *
 * PERMISSÃO
 *   `propostas.release_producao` — a MESMA de "Retirar da Produção", que já
 *   existia no catálogo. Não há chave nova: as duas ações têm exatamente a mesma
 *   natureza (tirar pedido das listas operacionais) e o mesmo alcance. Vale o
 *   fallback padrão do projeto (super admin sempre passa; `is_admin` passa por
 *   fallback quando o usuário não tem perfil com permissões granulares).
 *
 * POR QUE A ROTA É A TRANCA — E ATÉ ONDE ELA TRANCA
 *   A RLS de `public.propostas` é aberta para `authenticated` (política
 *   `update_all_propostas`, com `qual = true`). Então esconder o item do menu
 *   não protege nada: é decoração. Esta rota, que revalida a permissão no
 *   servidor, é o gate real do FLUXO DO APP.
 *
 *   Sendo honesto sobre o limite: enquanto a RLS estiver aberta, alguém
 *   autenticado ainda consegue escrever a coluna chamando o PostgREST direto,
 *   por fora do app. Fechar isso é apertar a RLS de `propostas` — decisão maior,
 *   que afeta todos os fluxos de escrita da tabela e não cabe nesta tarefa.
 *   Registrado aqui para não passar por resolvido.
 *
 * O QUE ESTA ROTA NÃO FAZ
 *   Não toca em `is_prd_aprovado` nem em `status_interno` — o pedido continua
 *   com o estado operacional real que tinha. Não mexe em pagamento, boleto, nota
 *   nem em nenhuma soma financeira: pedido de teste marcado SEGUE contando no
 *   faturamento. Tirá-lo de lá é tarefa à parte, com decisão própria.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Corpo = { id_int?: number; encerrar?: boolean; motivo?: string | null };

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
  const encerrar = body?.encerrar === true;
  const motivo = (body?.motivo || "").trim() || null;

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão expirada." }, { status: 401 });
  }
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int inválido." }, { status: 400 });
  }

  const podeMarcar = await verificarPermissaoServerSide(
    supabase,
    authData.user.id,
    "propostas.release_producao"
  );
  if (!podeMarcar) {
    return NextResponse.json(
      { success: false, message: "Só um administrador pode encerrar ou reabrir pedido de teste." },
      { status: 403 }
    );
  }

  // Estado atual: decide idempotência e alimenta a mensagem da timeline.
  const { data: atual, error: leituraErro } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, status_interno, encerrado_teste_em, encerrado_teste_por")
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

  const jaEstavaMarcado = atual.encerrado_teste_em !== null;
  if (jaEstavaMarcado === encerrar) {
    return NextResponse.json({
      success: true,
      idempotente: true,
      encerrado: jaEstavaMarcado,
      encerradoEm: atual.encerrado_teste_em,
      encerradoPor: atual.encerrado_teste_por
    });
  }

  const autorEmail = authData.user.email ?? null;
  const carimbo = new Date().toISOString();

  const { data: gravado, error: updateErro } = await supabase
    .from("propostas")
    .update(
      encerrar
        ? { encerrado_teste_em: carimbo, encerrado_teste_por: autorEmail }
        : { encerrado_teste_em: null, encerrado_teste_por: null }
    )
    .eq("id_int", idInt)
    .select("id_int, encerrado_teste_em, encerrado_teste_por")
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
    const autorNome = usuarioRow?.nome_usuario || autorEmail || "Administrador";

    const mensagem = encerrar
      ? `🧪 Pedido marcado como TESTE ENCERRADO por ${autorNome}${motivo ? ` — ${motivo}` : ""}. ` +
        `Sai do painel de Produção, do Kanban, da fila de impressão e da Expedição. ` +
        `Continua acessível por busca e por URL, e segue contando no faturamento. ` +
        `Status operacional preservado: ${atual.status_interno || "sem status"}.`
      : `↩️ Pedido REABERTO por ${autorNome}${motivo ? ` — ${motivo}` : ""}. ` +
        `Volta a aparecer nas listas operacionais.`;

    const { error: chatErro } = await supabase.from("propostas_chat").insert([
      {
        id_int: idInt,
        id_cliente: atual.id_cliente ?? null,
        tipo: "SISTEMA",
        setor: "PRODUCAO",
        autor_uid: authData.user.id,
        autor_nome: autorNome,
        autor_email: autorEmail,
        mensagem
      }
    ]);
    if (chatErro) console.warn("[encerrar-teste] Erro ao gravar na timeline:", chatErro);
  } catch (e) {
    console.warn("[encerrar-teste] Exceção ao gravar na timeline:", e);
  }

  return NextResponse.json({
    success: true,
    idempotente: false,
    encerrado: gravado.encerrado_teste_em !== null,
    encerradoEm: gravado.encerrado_teste_em,
    encerradoPor: gravado.encerrado_teste_por
  });
}
