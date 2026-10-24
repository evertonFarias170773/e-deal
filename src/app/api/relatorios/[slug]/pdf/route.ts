import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { executarRelatorio } from "@/features/relatorios/relatorio.server";
import { criarRelatorioPdfElement } from "@/features/relatorios/pdf/RelatorioPdfDocument";
import { OPCOES_EMPRESA } from "@/features/relatorios/lib/opcoes";
import type { ContextoPdf } from "@/features/relatorios/types";

/**
 * GET /api/relatorios/[slug]/pdf?ini=...&fim=...&<filtro>=<valor>[&baixar=1]
 *
 * PDF do relatório, gerado no servidor com @react-pdf/renderer (mesmo padrão das etiquetas e da
 * declaração de conteúdo da Expedição). Passa pelo mesmo caminho da rota de dados
 * (`relatorio.server.ts`): mesma sessão, mesma permissão, mesmo período, mesmos números.
 * Só existe para relatório que declara `pdf` na definição. `baixar=1` força o download.
 * Somente leitura: nada é gravado.
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
  const { relatorio, consulta, resultado, usuario } = resposta;
  if (!relatorio.pdf) {
    return NextResponse.json({ success: false, error: "Este relatório não tem PDF." }, { status: 404 });
  }

  const filtros = relatorio.filtros
    .map((f) => {
      const valor = consulta.filtros[f.chave];
      if (!valor) return null;
      const rotulo = f.opcoes?.find((o) => o.valor === valor)?.rotulo ?? valor;
      return `${f.rotulo}: ${rotulo}`;
    })
    .filter((x): x is string => x !== null);

  const contexto: ContextoPdf = {
    consulta,
    empresa:
      OPCOES_EMPRESA.find((o) => o.valor === consulta.filtros.empresa)?.rotulo ?? "Todas as empresas",
    filtros,
    geradoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    geradoPor: usuario.nome
  };

  const modelo = relatorio.pdf.montar(resultado, contexto);
  const pdf = await renderToBuffer(criarRelatorioPdfElement(modelo));
  const nome = relatorio.pdf.nomeArquivo(consulta);
  const baixar = request.nextUrl.searchParams.get("baixar") === "1";

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${baixar ? "attachment" : "inline"}; filename="${nome}"`,
      "Cache-Control": "no-store"
    }
  });
}
