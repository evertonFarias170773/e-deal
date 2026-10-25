import { NextRequest, NextResponse } from "next/server";
import { executarRelatorio } from "@/features/relatorios/relatorio.server";
import { montarZip } from "@/features/relatorios/lib/zip";

/**
 * GET /api/relatorios/[slug]/xml?ini=...&fim=...&<filtro>=<valor>
 *
 * Zip com os arquivos que o relatório declara em `zip` (hoje: os XML das NF-e do mês). Passa pelo
 * mesmo caminho da rota de dados (`relatorio.server.ts`): mesma sessão, mesma permissão, mesmo
 * período, mesmos filtros. Os arquivos são lidos do bucket privado com o cliente de serviço,
 * só os das notas que a consulta do usuário devolveu. O zip sai com os arquivos que existem;
 * o que falta vai listado no LEIAME.txt dentro do zip e no cabeçalho X-Arquivos-Ausentes.
 * Somente leitura: nada é gravado e nenhum provedor fiscal é chamado.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resposta = await executarRelatorio(request, slug);
  if (!resposta.ok) {
    return NextResponse.json({ success: false, error: resposta.error }, { status: resposta.status });
  }
  const { relatorio, consulta, resultado, servico } = resposta;
  if (!relatorio.zip) {
    return NextResponse.json({ success: false, error: "Este relatório não tem zip." }, { status: 404 });
  }
  if (!servico) {
    return NextResponse.json(
      { success: false, error: "O servidor não está configurado para ler os arquivos." },
      { status: 500 }
    );
  }

  const { arquivos, ausentes } = await relatorio.zip.montar(resultado, servico);
  if (arquivos.length === 0) {
    return NextResponse.json(
      { success: false, error: "Nenhum arquivo disponível para este período." },
      { status: 404 }
    );
  }

  const zip = montarZip(arquivos);
  const nome = relatorio.zip.nomeArquivo(consulta);
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "X-Arquivos-Ausentes": String(ausentes.length),
      "Cache-Control": "no-store"
    }
  });
}
