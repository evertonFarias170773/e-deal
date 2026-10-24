import { NextRequest, NextResponse } from "next/server";
import { executarRelatorio } from "@/features/relatorios/relatorio.server";

/**
 * GET /api/relatorios/[slug]?ini=AAAA-MM-DD&fim=AAAA-MM-DD&<filtro>=<valor>
 *
 * Rota única de dados dos relatórios (24/10/2026). Quem manda no que existe é a lista de
 * `features/relatorios/registro.ts`; a rota não conhece relatório nenhum. Sessão, permissão,
 * validação e consulta ficam em `relatorio.server.ts`, o mesmo caminho do PDF
 * (`/api/relatorios/[slug]/pdf`).
 *
 * SEGURANÇA
 * - Sessão do usuário (Authorization: Bearer): a RPC roda com o JWT dele, então a checagem de
 *   permissão do banco (`cc__assert_permissao`) vale também aqui.
 * - Antes da consulta, a permissão do relatório é conferida de novo no servidor
 *   (`verificarPermissaoServerSide`): admin e super admin passam; perfil só com a chave.
 * - Período obrigatório e limitado por `periodo.maxDias` da definição; filtros com opções
 *   fixas só aceitam um desses valores.
 * Somente leitura: nada é gravado.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resposta = await executarRelatorio(request, slug);
  if (!resposta.ok) {
    return NextResponse.json({ success: false, error: resposta.error }, { status: resposta.status });
  }
  return NextResponse.json({ success: true, ...resposta.resultado });
}
