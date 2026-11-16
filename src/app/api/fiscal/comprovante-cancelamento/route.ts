import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  chaveEmBlocos,
  dataHoraDeBrasilia,
  documentoFormatado,
  lerEventoDeCancelamento,
  lerPartesDaNfe,
  nomeDoComprovanteDeCancelamento,
  serieENumeroDaChave
} from "@/lib/fiscal/comprovante-cancelamento";
import { criarComprovanteCancelamentoElement } from "@/features/fiscal/pdf/ComprovanteCancelamentoPdfDocument";

/**
 * GET /api/fiscal/comprovante-cancelamento?ref=NFE-25028-001[&formato=xml|pdf]
 *
 * Comprovante de cancelamento de uma NF-e cancelada. Pedidos da Edina,
 * 16/11/2026.
 *
 * XML (padrão): o XML do evento (`procEventoNFe`, evento 110111, com o
 *   protocolo da SEFAZ), entregue como está.
 *
 * PDF: gerado pelo Vibe a partir desse mesmo XML, porque a Focus não gera PDF do
 *   cancelamento da NF-e e o cliente não lê XML. Do XML do evento saem a chave,
 *   o CNPJ do emitente, as datas, os protocolos, o código 135/155 e a
 *   justificativa; o PDF só sai se o XML for de cancelamento confirmado e a
 *   chave bater com a da nota. Os nomes do emitente e do destinatário vêm do XML
 *   da própria NF-e (`<ref>/nfe.xml`); sem ele, do cadastro da empresa e do
 *   destinatário gravado na nota. A data de autorização vem da nota.
 *
 * DE ONDE VEM O ARQUIVO
 *   Ao cancelar, a Focus devolve só `caminho_xml_cancelamento`. O fluxo de
 *   cancelamento do n8n baixa esse XML da Focus, com o token da empresa da nota,
 *   e o guarda no bucket privado `nfe-documentos` em `<ref>/cancelamento.xml`.
 *   O token da Focus fica só no n8n; o Vibe nunca o vê e não chama a Focus.
 *
 * QUEM PODE
 *   Quem tem sessão e enxerga a nota. A nota é relida com o JWT do usuário (o
 *   RLS de `notas_fiscais` decide) e precisa estar CANCELADA. Só então a chave
 *   de serviço baixa os arquivos DESTA nota. O caminho é montado aqui, nunca
 *   vem do navegador.
 *
 * NFS-e: o cancelamento de NFS-e não passa pelo Vibe e a Focus devolve só
 *   `{status: "cancelado"}`. Não há comprovante guardado; a rota só atende NF-e.
 *
 * Só leitura: nada é cancelado, reenviado, emitido ou gravado.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "nfe-documentos";
const REF_VALIDA = /^NFE-[0-9A-Z-]{1,40}$/;

function erro(status: number, message: string) {
  return NextResponse.json({ success: false, message }, { status });
}

type NotaLida = {
  ref: string;
  id_int: number | null;
  numero_nf: string | number | null;
  serie: string | number | null;
  status: string | null;
  chave_nfe: string | null;
  data_autorizacao: string | null;
  id_empresa: number | null;
  dest_nome: string | null;
};

export async function GET(request: Request) {
  try {
    const busca = new URL(request.url).searchParams;
    const ref = String(busca.get("ref") ?? "").trim().toUpperCase();
    if (!REF_VALIDA.test(ref)) return erro(400, "Referência da NF-e inválida.");
    const formato = String(busca.get("formato") ?? "xml").trim().toLowerCase();
    if (formato !== "xml" && formato !== "pdf") return erro(400, "Formato desconhecido.");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
      console.error("[API][ComprovanteCancelamento] ENV AUSENTE (url, anon ou service role)");
      return erro(503, "O download do comprovante está indisponível neste servidor.");
    }

    // 1. Sessão.
    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return erro(401, "Sessão não encontrada.");
    const doUsuario = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await doUsuario.auth.getUser();
    if (authError || !authData.user) return erro(401, "Sessão inválida.");

    // 2. A nota, relida com o JWT do usuário.
    const { data: nota, error } = await doUsuario
      .from("notas_fiscais")
      .select("ref, id_int, numero_nf, serie, status, chave_nfe, data_autorizacao, id_empresa, dest_nome")
      .eq("ref", ref)
      .maybeSingle();
    if (error) {
      console.error("[API][ComprovanteCancelamento] Falha ao ler a nota:", error.message);
      return erro(500, "Não foi possível ler a nota no banco.");
    }
    if (!nota) return erro(404, "Nota não encontrada.");
    const linha = nota as NotaLida;
    if (String(linha.status ?? "").toUpperCase() !== "CANCELADA") {
      return erro(409, "Esta nota não está cancelada no Vibe.");
    }

    // 3. O XML do evento, guardado pelo n8n no cancelamento.
    const servico = createSupabaseClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: conteudo, error: erroDownload } = await servico.storage.from(BUCKET).download(`${ref}/cancelamento.xml`);
    if (erroDownload || !conteudo || conteudo.size === 0) {
      console.error(`[API][ComprovanteCancelamento] ${ref}/cancelamento.xml indisponível:`, erroDownload?.message);
      return erro(
        404,
        "O comprovante de cancelamento desta nota não está guardado no Vibe: não há XML do evento de cancelamento confirmado pela SEFAZ para ela. Confira a situação da nota na SEFAZ antes de seguir."
      );
    }

    if (formato === "xml") {
      const nome = nomeDoComprovanteDeCancelamento({ numero: linha.numero_nf, idInt: linha.id_int, ref }, "xml");
      return new Response(conteudo, {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${nome}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }

    // 4. PDF: só de cancelamento confirmado e com a chave da própria nota.
    const leitura = lerEventoDeCancelamento(await conteudo.text());
    if (!leitura.ok) return erro(422, `Não foi possível gerar o PDF: ${leitura.motivo}`);
    const evento = leitura.evento;
    const chaveDaNota = String(linha.chave_nfe ?? "").replace(/^NFe/i, "").trim();
    if (chaveDaNota && chaveDaNota !== evento.chave) {
      return erro(422, "Não foi possível gerar o PDF: a chave do XML do evento não é a desta nota.");
    }

    const { data: nfeXml } = await servico.storage.from(BUCKET).download(`${ref}/nfe.xml`);
    const partes = lerPartesDaNfe(nfeXml ? await nfeXml.text() : null);
    type EmpresaLida = { razao_social?: string | null; cnpj?: string | null };
    let empresa: EmpresaLida = {};
    if (!partes.emitente?.nome && linha.id_empresa != null) {
      const { data } = await servico.from("empresas").select("razao_social, cnpj").eq("id", linha.id_empresa).maybeSingle();
      empresa = (data as EmpresaLida | null) ?? {};
    }
    const daChave = serieENumeroDaChave(evento.chave);

    const pdf = await renderToBuffer(
      criarComprovanteCancelamentoElement({
        emitente: {
          nome: partes.emitente?.nome || String(empresa.razao_social ?? ""),
          documento: documentoFormatado(evento.cnpjEmitente || partes.emitente?.documento || String(empresa.cnpj ?? ""))
        },
        destinatario: {
          nome: partes.destinatario?.nome || String(linha.dest_nome ?? ""),
          documento: documentoFormatado(partes.destinatario?.documento ?? "")
        },
        numero: daChave.numero || String(linha.numero_nf ?? ""),
        serie: daChave.serie || String(linha.serie ?? ""),
        chave: chaveEmBlocos(evento.chave),
        dataAutorizacao: dataHoraDeBrasilia(linha.data_autorizacao),
        protocoloAutorizacao: evento.protocoloAutorizacao,
        dataEvento: dataHoraDeBrasilia(evento.dataEvento),
        dataRegistro: dataHoraDeBrasilia(evento.dataRegistro),
        protocoloCancelamento: evento.protocoloCancelamento,
        cStat: evento.cStat,
        motivo: evento.motivo,
        justificativa: evento.justificativa,
        ambiente: evento.ambiente === "homologacao" ? "Homologação (sem valor fiscal)" : "Produção",
        ref,
        geradoEm: dataHoraDeBrasilia(new Date().toISOString())
      })
    );
    const nome = nomeDoComprovanteDeCancelamento({ numero: linha.numero_nf, idInt: linha.id_int, ref }, "pdf");
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nome}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (err) {
    console.error("[API][ComprovanteCancelamento] Erro inesperado:", err);
    return erro(500, "Erro inesperado ao baixar o comprovante de cancelamento.");
  }
}
