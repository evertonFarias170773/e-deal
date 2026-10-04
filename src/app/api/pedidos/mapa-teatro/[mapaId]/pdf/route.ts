import { NextResponse } from "next/server";
import { buscarPdfDoMapa, ehUuid } from "@/features/orcamentos/lib/mapa-teatro-pdf";

/**
 * GET /api/pedidos/mapa-teatro/{mapaId}/pdf
 *
 * Repassa à função `mapas-teatro-pdfs` do parceiro o pedido do PDF do mapa
 * completo, com o `Authorization` de quem clicou. Só leitura. Esta rota não
 * usa chave de serviço nem credencial própria: quem decide se o usuário pode
 * ver o mapa é a função do parceiro, pelo token dele.
 *
 * Respostas:
 *   200 application/pdf       o arquivo, em fluxo; `X-Mapa-Tamanho` traz o
 *                             tamanho que o parceiro informou, para a tela conferir
 *   200 { estado: "pendente" } o parceiro ainda não publicou o PDF deste mapa
 *   401 | 403 | 404           repassados do parceiro
 *   503                       parceiro fora do ar ou resposta fora do combinado
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEM_CACHE = { "Cache-Control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ mapaId: string }> }) {
  const autorizacao = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(autorizacao)) {
    return NextResponse.json({ error: "Sessão não identificada." }, { status: 401, headers: SEM_CACHE });
  }

  const urlDoSupabase = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  if (!urlDoSupabase) {
    return NextResponse.json({ error: "PDF do mapa indisponível." }, { status: 503, headers: SEM_CACHE });
  }

  const { mapaId } = await params;
  const resultado = await buscarPdfDoMapa({
    base: `${urlDoSupabase}/functions/v1/mapas-teatro-pdfs`,
    mapaId,
    autorizacao,
    buscar: (url, init) => fetch(url, init),
    // Sem token, sem endereço e sem corpo: só o passo, o motivo e o status.
    registrar: (falha) =>
      console.warn(
        `[mapa-teatro-pdf] mapa ${ehUuid(mapaId) ? mapaId : "(id inválido)"}: falhou em ${falha.passo} — ${falha.motivo}` +
          (falha.statusDoParceiro !== undefined ? ` (HTTP ${falha.statusDoParceiro})` : "")
      )
  });

  if (resultado.tipo === "pendente") {
    return NextResponse.json({ estado: "pendente" }, { status: 200, headers: SEM_CACHE });
  }
  if (resultado.tipo === "erro") {
    return NextResponse.json({ error: "PDF do mapa indisponível." }, { status: resultado.status, headers: SEM_CACHE });
  }

  return new Response(resultado.resposta.body, {
    status: 200,
    headers: {
      ...SEM_CACHE,
      "Content-Type": "application/pdf",
      ...(resultado.tamanhoBytes !== null ? { "X-Mapa-Tamanho": String(resultado.tamanhoBytes) } : {})
    }
  });
}
