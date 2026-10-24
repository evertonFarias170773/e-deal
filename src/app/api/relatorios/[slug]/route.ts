import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { buscarRelatorio } from "@/features/relatorios/registro";
import { diasDoPeriodo, ehDataIso } from "@/features/relatorios/lib/periodo";

/**
 * GET /api/relatorios/[slug]?ini=AAAA-MM-DD&fim=AAAA-MM-DD&<filtro>=<valor>
 *
 * Rota única de dados dos relatórios (24/10/2026). Quem manda no que existe é a
 * lista de `features/relatorios/registro.ts`; a rota não conhece relatório nenhum.
 *
 * SEGURANÇA
 * - Sessão do usuário (Authorization: Bearer): a RPC roda com o JWT dele, então a
 *   checagem de permissão do banco (`cc__assert_permissao`) vale também aqui.
 * - Antes da RPC, a permissão do relatório é conferida de novo no servidor
 *   (`verificarPermissaoServerSide`): admin e super admin passam; perfil só com a chave.
 * - Período obrigatório e limitado por `periodo.maxDias` da definição; filtros com
 *   opções fixas só aceitam um desses valores.
 * Somente leitura: nada é gravado.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const relatorio = buscarRelatorio(slug);
  if (!relatorio) {
    return NextResponse.json({ success: false, error: "Relatório não encontrado." }, { status: 404 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, error: "Sessão não encontrada." }, { status: 401 });
  }

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    }
  );
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, error: "Sessão inválida." }, { status: 401 });
  }

  if (!(await verificarPermissaoServerSide(supabase, authData.user.id, relatorio.permissao))) {
    return NextResponse.json({ success: false, error: "Sem permissão para este relatório." }, { status: 403 });
  }

  const query = request.nextUrl.searchParams;
  const inicio = query.get("ini") ?? "";
  const fim = query.get("fim") ?? "";
  if (!ehDataIso(inicio) || !ehDataIso(fim) || inicio > fim) {
    return NextResponse.json({ success: false, error: "Período inválido." }, { status: 400 });
  }
  if (diasDoPeriodo({ inicio, fim }) > relatorio.periodo.maxDias) {
    return NextResponse.json(
      { success: false, error: `Período máximo de ${relatorio.periodo.maxDias} dias.` },
      { status: 400 }
    );
  }

  const filtros: Record<string, string> = {};
  for (const filtro of relatorio.filtros) {
    const valor = (query.get(filtro.chave) ?? "").trim();
    if (valor.length > 120) {
      return NextResponse.json({ success: false, error: `Filtro ${filtro.rotulo} inválido.` }, { status: 400 });
    }
    if (valor && filtro.opcoes && !filtro.opcoes.some((o) => o.valor === valor)) {
      return NextResponse.json({ success: false, error: `Filtro ${filtro.rotulo} inválido.` }, { status: 400 });
    }
    filtros[filtro.chave] = valor;
  }

  const { data, error } = await supabase.rpc(
    relatorio.rpc.nome,
    relatorio.rpc.argumentos({ inicio, fim, filtros })
  );
  if (error) {
    const semPermissao = error.code === "42501" || error.code === "28000";
    if (!semPermissao) console.error(`[relatorios/${slug}]`, error.message);
    return NextResponse.json(
      { success: false, error: semPermissao ? "Sem permissão para este relatório." : "Não foi possível gerar o relatório." },
      { status: semPermissao ? 403 : 500 }
    );
  }

  return NextResponse.json({ success: true, ...relatorio.normalizar(data) });
}
