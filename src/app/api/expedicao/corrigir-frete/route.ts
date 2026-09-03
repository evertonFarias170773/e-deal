/**
 * POST /api/expedicao/corrigir-frete — MODO SIMULAR, sem gravar nada.
 *
 * Etapas 1 e 2 do plano de correção de frete pós-liberação. Responde "dá para
 * corrigir este pedido? e quanto muda no valor?" — a gravação é rodada seguinte
 * e depende da flag do `saveProposta`, que ainda NÃO existe.
 *
 * Toda a decisão mora em `simularCorrecaoFrete`; aqui só entram JWT, permissão e
 * o transporte HTTP. Assim o mesmo código que responde ao navegador pôde ser
 * rodado contra os pedidos reais por um script antes de publicar.
 *
 * A ROTA NÃO ESCREVE. Não há `insert`, `update`, `delete` nem `rpc` neste
 * arquivo nem no módulo que ele chama — só `select`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { simularCorrecaoFrete } from "@/features/expedicao/services/corrigir-frete-simulacao";

export const runtime = "nodejs";

/** A mesma que já libera a edição de proposta paga — decisão do dono, sem permissão nova. */
const PERMISSAO = "propostas.editar_paga";

export async function POST(request: NextRequest) {
  let idInt = 0;
  let modalidade = "";
  let transportadoraId: number | null = null;
  let modo = "simular";

  try {
    const body = (await request.json()) as {
      idInt?: unknown;
      modalidade?: unknown;
      transportadoraId?: unknown;
      modo?: unknown;
    };
    idInt = Number(body?.idInt ?? 0);
    modalidade = String(body?.modalidade ?? "");
    const bruto = body?.transportadoraId;
    transportadoraId =
      bruto === null || bruto === undefined || bruto === "" ? null : Number(bruto);
    modo = String(body?.modo ?? "simular").trim().toLowerCase();
  } catch {
    return NextResponse.json({ success: false, message: "Corpo da requisição inválido." }, { status: 400 });
  }

  if (!Number.isFinite(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "Pedido não informado." }, { status: 400 });
  }
  if (transportadoraId !== null && !Number.isFinite(transportadoraId)) {
    return NextResponse.json({ success: false, message: "Transportadora inválida." }, { status: 400 });
  }

  /**
   * Só `simular` existe. A gravação é a Etapa 3+, e recusar aqui de forma
   * explícita é melhor do que aceitar em silêncio um modo que não faz nada —
   * quem chamar com `modo: "confirmar"` recebe um erro que diz o porquê.
   */
  if (modo !== "simular") {
    return NextResponse.json(
      {
        success: false,
        message: "Esta rota está apenas no modo simular: a gravação da correção de frete ainda não foi liberada."
      },
      { status: 400 }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[API][CorrigirFrete] ENV AUSENTE");
    return NextResponse.json({ success: false, message: "Erro interno no servidor de banco de dados." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
  }

  // Client com o TOKEN DO USUÁRIO: as consultas falam como `authenticated`.
  // Nenhuma leitura desta rota passa como `anon`.
  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
  }

  // A permissão vale AQUI, no servidor. A tela apenas esconde o controle.
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, PERMISSAO);

  const simulacao = await simularCorrecaoFrete(supabase, {
    idInt,
    modalidade,
    transportadoraId,
    temPermissaoEditarPaga: temPermissao
  });

  if (!simulacao.permitido) {
    return NextResponse.json(
      { success: false, motivo: simulacao.motivo, message: simulacao.mensagem },
      { status: simulacao.status }
    );
  }

  return NextResponse.json({ success: true, avisos: simulacao.avisos, ...simulacao.dados }, { status: 200 });
}
