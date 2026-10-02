/**
 * Libera a proposta para produção — o botão "Liberar para Produção" da lista
 * de orçamentos.
 *
 * POR QUE EXISTE (Etapa 7 da reforma do boletim)
 *   Até aqui o botão chamava `liberarPropostaParaProducao` direto do navegador:
 *   as validações da liberação — status, pagamentos, artes — rodavam no código
 *   do cliente. Com a trava nova (quantidade vendida × soma dos lotes), a
 *   liberação passa a ser conferida NO SERVIDOR: esta rota roda a MESMA função,
 *   com a sessão do usuário, e o navegador só recebe o resultado.
 *
 *   A liberação automática de prateleira (`/api/cobrancas/confirmar`) já
 *   rodava a função no servidor. Os dois caminhos agora passam pela mesma
 *   função, do mesmo lado.
 *
 * O QUE ELA NÃO FAZ
 *   Não acrescenta permissão nova: exige sessão válida, como a chamada direta
 *   exigia (a RLS de `propostas` não distingue perfil). Não muda nenhuma
 *   validação — só o lugar onde elas rodam.
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { liberarPropostaParaProducao } from "@/features/orcamentos/services/orcamentos.service";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";

/**
 * A chave do catalogo "Liberar para Produção". Ate 02/10/2026 esta rota so
 * conferia a sessao: qualquer usuario logado liberava. A liberacao AUTOMATICA
 * de pedido de prateleira (na confirmacao do pagamento) nao passa por aqui —
 * chama `liberarPropostaParaProducao` direto — e por isso continua sem exigir a
 * chave de quem confirma.
 */
const PERMISSAO = "propostas.release_producao";

export async function POST(request: Request) {
  let body: { id_int?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Corpo da requisição inválido." }, { status: 400 });
  }

  const idInt = Number(body.id_int);
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int é obrigatório." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[API][LiberarProducao] ENV AUSENTE");
    return NextResponse.json({ success: false, message: "Erro interno no servidor." }, { status: 500 });
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

  // A permissão vale AQUI, no servidor. O menu só esconde o item.
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, PERMISSAO);
  if (!temPermissao) {
    return NextResponse.json(
      { success: false, code: "SEM_PERMISSAO", message: `Sem permissão para liberar para produção (${PERMISSAO}).` },
      { status: 403 }
    );
  }

  const resultado = await liberarPropostaParaProducao(idInt, supabase);

  if (!resultado.success) {
    return NextResponse.json(
      {
        success: false,
        code: resultado.code,
        divergencias: resultado.divergencias,
        message: resultado.errorMessage || "A proposta não pôde ser liberada para produção."
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true });
}
