import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  chaveEmBlocos,
  dataHoraDeBrasilia,
  documentoFormatado,
  lerPartesDaNfe,
  serieENumeroDaChave
} from "@/lib/fiscal/comprovante-cancelamento";
import {
  caminhoDoXmlDaCarta,
  cartasDaNota,
  lerEventoCartaCorrecao,
  nomeDaCartaDeCorrecao,
  type EventoDaNota
} from "@/lib/fiscal/carta-correcao-arquivo";
import { criarCartaCorrecaoElement } from "@/features/fiscal/pdf/CartaCorrecaoPdfDocument";

/**
 * GET /api/fiscal/carta-correcao/arquivo?ref=NFE-24253-004&seq=2&formato=pdf|xml
 *
 * Baixa uma carta de correção (CC-e) registrada da nota. Pedido da Edina,
 * 17/11/2026 (NF 41390, duas cartas).
 *
 * XML: o procEventoNFe da carta, que o fluxo "Focus NFe - Copia XML de eventos"
 *   do n8n baixa da Focus com o token da empresa e guarda em
 *   `nfe-documentos/<ref>/cce-NN.xml`.
 * PDF: gerado pelo Vibe a partir desse XML. O PDF da Focus
 *   (`caminho_pdf_carta_correcao`) só sai com o token da empresa, que fica no
 *   n8n; sem ele a Focus responde "Arquivo não encontrado".
 *
 * QUEM PODE: quem tem sessão e enxerga a nota e o evento (lidos com o JWT do
 *   usuário, o RLS decide). A carta precisa estar registrada (135) e a chave do
 *   XML precisa ser a da nota. O caminho é montado aqui, nunca vem do navegador.
 *
 * Só leitura: não emite carta, não chama a Focus, não grava nada.
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
    const sequencia = Number(busca.get("seq"));
    if (!Number.isInteger(sequencia) || sequencia < 1 || sequencia > 20) return erro(400, "Sequência da carta inválida.");
    const formato = String(busca.get("formato") ?? "pdf").trim().toLowerCase();
    if (formato !== "xml" && formato !== "pdf") return erro(400, "Formato desconhecido.");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
      console.error("[API][CartaCorrecaoArquivo] ENV AUSENTE (url, anon ou service role)");
      return erro(503, "O download da carta de correção está indisponível neste servidor.");
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

    // 2. A nota e as cartas dela, relidas com o JWT do usuário.
    const { data: nota, error } = await doUsuario
      .from("notas_fiscais")
      .select("ref, id_int, numero_nf, serie, chave_nfe, data_autorizacao, id_empresa, dest_nome")
      .eq("ref", ref)
      .maybeSingle();
    if (error) {
      console.error("[API][CartaCorrecaoArquivo] Falha ao ler a nota:", error.message);
      return erro(500, "Não foi possível ler a nota no banco.");
    }
    if (!nota) return erro(404, "Nota não encontrada.");
    const linha = nota as NotaLida;

    const { data: eventos, error: erroEventos } = await doUsuario
      .from("notas_eventos")
      .select("tipo_evento, status_evento, status_sefaz, sequencia_evento, caminho_xml, payload_retorno, created_at")
      .eq("ref", ref)
      .eq("tipo_evento", "CARTA_CORRECAO");
    if (erroEventos) {
      console.error("[API][CartaCorrecaoArquivo] Falha ao ler as cartas:", erroEventos.message);
      return erro(500, "Não foi possível ler as cartas de correção no banco.");
    }
    if (!cartasDaNota((eventos ?? []) as EventoDaNota[]).includes(sequencia)) {
      return erro(404, `A carta de correção nº ${sequencia} desta nota não está registrada pela SEFAZ no Vibe.`);
    }

    // 3. O XML guardado pelo n8n.
    const servico = createSupabaseClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: conteudo, error: erroDownload } = await servico.storage.from(BUCKET).download(caminhoDoXmlDaCarta(ref, sequencia));
    if (erroDownload || !conteudo || conteudo.size === 0) {
      console.error(`[API][CartaCorrecaoArquivo] ${caminhoDoXmlDaCarta(ref, sequencia)} indisponível:`, erroDownload?.message);
      return erro(
        404,
        "O XML desta carta de correção ainda não foi copiado para o Vibe. A cópia roda uma vez por hora; tente de novo mais tarde."
      );
    }
    const texto = await conteudo.text();
    const leitura = lerEventoCartaCorrecao(texto);
    if (!leitura.ok) return erro(422, `Não foi possível abrir a carta: ${leitura.motivo}`);
    const evento = leitura.evento;
    const chaveDaNota = String(linha.chave_nfe ?? "").replace(/^NFe/i, "").trim();
    if ((chaveDaNota && chaveDaNota !== evento.chave) || Number(evento.sequencia) !== sequencia) {
      return erro(422, "Não foi possível abrir a carta: o XML guardado não é desta nota ou desta sequência.");
    }

    const nomeBase = { numero: linha.numero_nf, idInt: linha.id_int, ref, sequencia };
    if (formato === "xml") {
      return new Response(texto, {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${nomeDaCartaDeCorrecao(nomeBase, "xml")}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }

    // 4. PDF.
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
      criarCartaCorrecaoElement({
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
        sequencia: evento.sequencia,
        dataEvento: dataHoraDeBrasilia(evento.dataEvento),
        dataRegistro: dataHoraDeBrasilia(evento.dataRegistro),
        protocolo: evento.protocolo,
        cStat: evento.cStat,
        motivo: evento.motivo,
        correcao: evento.correcao,
        condicoesDeUso: evento.condicoesDeUso,
        ambiente: evento.ambiente === "homologacao" ? "Homologação (sem valor fiscal)" : "Produção",
        ref,
        geradoEm: dataHoraDeBrasilia(new Date().toISOString())
      })
    );
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nomeDaCartaDeCorrecao(nomeBase, "pdf")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (err) {
    console.error("[API][CartaCorrecaoArquivo] Erro inesperado:", err);
    return erro(500, "Erro inesperado ao baixar a carta de correção.");
  }
}
