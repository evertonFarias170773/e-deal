/**
 * POST /api/expedicao/corrigir-frete — dois modos.
 *
 * `simular` (Etapas 1 e 2) responde "dá para corrigir este pedido? e quanto muda
 * no valor?" sem tocar em uma linha do banco. `confirmar` (Etapa 4) grava.
 *
 * Toda a decisão mora nos módulos: `simularCorrecaoFrete` avalia,
 * `confirmarCorrecaoFrete` grava e trata a diferença financeira. Aqui só entram
 * JWT, permissão e o transporte HTTP. Assim o mesmo código que responde ao
 * navegador pode ser rodado contra os pedidos reais por um script — foi como as
 * barreiras, a projeção e a gravação foram conferidas antes de publicar.
 *
 * O MODO `simular` CONTINUA SEM ESCREVER: nenhum `insert`, `update`, `delete` ou
 * `rpc` acontece nele. A gravação existe apenas no caminho do `confirmar`, e ela
 * reavalia as barreiras do zero em vez de confiar na simulação que a tela fez.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { simularCorrecaoFrete } from "@/features/expedicao/services/corrigir-frete-simulacao";
import { confirmarCorrecaoFrete } from "@/features/expedicao/services/corrigir-frete-gravacao";

export const runtime = "nodejs";

/** A mesma que já libera a edição de proposta paga — decisão do dono, sem permissão nova. */
const PERMISSAO = "propostas.editar_paga";

export async function POST(request: NextRequest) {
  let idInt = 0;
  let modalidade = "";
  let transportadoraId: number | null = null;
  let modo = "simular";
  let acaoFinanceira: string | null = null;
  let categoriaFreteDeclarada: string | null = null;
  let chaveEvento: string | null = null;

  try {
    const body = (await request.json()) as {
      idInt?: unknown;
      modalidade?: unknown;
      transportadoraId?: unknown;
      modo?: unknown;
      acaoFinanceira?: unknown;
      categoriaFreteDeclarada?: unknown;
      chaveEvento?: unknown;
    };
    idInt = Number(body?.idInt ?? 0);
    modalidade = String(body?.modalidade ?? "");
    const bruto = body?.transportadoraId;
    transportadoraId =
      bruto === null || bruto === undefined || bruto === "" ? null : Number(bruto);
    modo = String(body?.modo ?? "simular").trim().toLowerCase();
    acaoFinanceira = body?.acaoFinanceira ? String(body.acaoFinanceira).trim().toUpperCase() : null;
    categoriaFreteDeclarada = body?.categoriaFreteDeclarada
      ? String(body.categoriaFreteDeclarada).trim().toUpperCase()
      : null;
    chaveEvento = body?.chaveEvento ? String(body.chaveEvento).trim() : null;
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
   * Dois modos, e nada além deles. Recusar um terceiro de forma explícita é
   * melhor do que aceitar em silêncio um nome escrito errado e devolver uma
   * simulação para quem pediu gravação.
   */
  if (modo !== "simular" && modo !== "confirmar") {
    return NextResponse.json(
      {
        success: false,
        message: `Modo "${modo}" nao existe nesta rota. Use "simular" ou "confirmar".`
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

  if (modo === "confirmar") {
    // O nome do operador vai para o histórico da proposta e para a
    // reconciliação de status. Ausente, o e-mail da sessão serve — é o que o
    // `editar-paga` também faz quando a tela não manda nome.
    const { data: usuarioRow } = await supabase
      .from("usuarios")
      .select("nome")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    const email = authData.user.email ?? "";
    const resultado = await confirmarCorrecaoFrete(supabase, {
      idInt,
      modalidade,
      transportadoraId,
      temPermissaoEditarPaga: temPermissao,
      acaoFinanceira,
      categoriaFreteDeclarada,
      chaveEvento,
      ator: {
        uid: authData.user.id,
        nome: String((usuarioRow as { nome?: string | null } | null)?.nome ?? "") || email || "Sistema",
        email
      }
    });

    if (!resultado.ok) {
      return NextResponse.json(
        { success: false, motivo: resultado.motivo, message: resultado.mensagem },
        { status: resultado.status }
      );
    }

    // `ok` fica de fora do corpo: quem lê a resposta HTTP tem `success`, e dois
    // campos dizendo a mesma coisa é convite para divergirem.
    const { ok, ...corpo } = resultado;
    void ok;
    return NextResponse.json({ success: true, ...corpo }, { status: 200 });
  }

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
