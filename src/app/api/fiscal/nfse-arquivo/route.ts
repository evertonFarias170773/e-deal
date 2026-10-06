import { NextResponse } from "next/server";
import {
  autenticarEmissorDeNfse,
  clienteDeServico,
  respostaDeErro
} from "@/features/nfse/services/nfse-pedido.server";
import { nomeDoArquivoNfse } from "@/features/nfse/lib/regras-emissao";

/**
 * GET /api/fiscal/nfse-arquivo?ref=NFS-23248-001&arquivo=pdf|xml
 *
 * Baixa o PDF ou o XML de uma NFS-e, com nome de arquivo legível
 * ("NFS-e-14-Pedido-23248.pdf").
 *
 * POR QUE PELO SERVIDOR
 *   Os arquivos ficam no bucket PRIVADO `nfe-documentos`, em `<ref>/danfe.pdf`
 *   e `<ref>/nfe.xml`. O navegador não tem como lê-los, e o link gravado na
 *   nota vence em 7 dias. A rota confere sessão e `fiscal.emit_nfse`, relê a
 *   nota com o token do usuário (o RLS decide se ele a enxerga) e só então usa
 *   a chave de serviço para buscar ESTE arquivo DESTA nota. Nenhuma chave e
 *   nenhum link assinado chegam ao navegador.
 *
 * Só leitura: não escreve na nota e não fala com a Focus.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "nfe-documentos";
const REF_VALIDA = /^NFS-[0-9A-Z-]{1,40}$/;
const ARQUIVOS = {
  pdf: { nome: "danfe.pdf", coluna: "url_pdf", tipo: "application/pdf", rotulo: "PDF" },
  xml: { nome: "nfe.xml", coluna: "url_xml", tipo: "application/xml", rotulo: "XML" }
} as const;

export async function GET(request: Request) {
  try {
    const sessao = await autenticarEmissorDeNfse(request);
    if (sessao instanceof NextResponse) return sessao;

    const parametros = new URL(request.url).searchParams;
    const ref = String(parametros.get("ref") ?? "").trim().toUpperCase();
    const pedido = String(parametros.get("arquivo") ?? "").trim().toLowerCase();
    if (!REF_VALIDA.test(ref)) return respostaDeErro(400, "Referência da nota inválida.");
    if (pedido !== "pdf" && pedido !== "xml") return respostaDeErro(400, "Arquivo desconhecido.");
    const arquivo = ARQUIVOS[pedido];

    const { data: nota, error } = await sessao.supabase
      .from("notas_servico")
      .select(`ref, id_int, numero_nfse, ${arquivo.coluna}`)
      .eq("ref", ref)
      .maybeSingle();
    if (error) {
      console.error("[API][NfseArquivo] Falha ao ler a nota:", error.message);
      return respostaDeErro(500, "Não foi possível ler a nota de serviço no banco.");
    }
    if (!nota) return respostaDeErro(404, "Nota de serviço não encontrada.");

    const linha = nota as unknown as Record<string, unknown>;
    if (String(linha[arquivo.coluna] ?? "").trim() === "") {
      return respostaDeErro(404, `Esta nota ainda não tem ${arquivo.rotulo} guardado.`);
    }

    const servico = clienteDeServico();
    if (!servico) {
      console.error("[API][NfseArquivo] SUPABASE_SERVICE_ROLE_KEY ausente.");
      return respostaDeErro(503, "O download de documentos está indisponível neste servidor.");
    }

    const { data: conteudo, error: erroDownload } = await servico.storage.from(BUCKET).download(`${ref}/${arquivo.nome}`);
    if (erroDownload || !conteudo) {
      console.error(`[API][NfseArquivo] Falha ao baixar ${ref}/${arquivo.nome}:`, erroDownload?.message);
      return respostaDeErro(404, `O ${arquivo.rotulo} desta nota não foi encontrado no armazenamento.`);
    }

    const nome = nomeDoArquivoNfse({
      numeroNfse: linha.numero_nfse as string | number | null,
      idInt: linha.id_int == null ? null : Number(linha.id_int),
      ref,
      tipo: pedido
    });

    return new Response(conteudo, {
      status: 200,
      headers: {
        "Content-Type": arquivo.tipo,
        "Content-Disposition": `attachment; filename="${nome}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (err) {
    console.error("[API][NfseArquivo] Erro inesperado:", err);
    return respostaDeErro(500, "Erro inesperado ao baixar o documento da nota.");
  }
}
