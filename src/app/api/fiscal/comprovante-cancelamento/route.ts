import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { nomeDoComprovanteDeCancelamento } from "@/lib/fiscal/comprovante-cancelamento";

/**
 * GET /api/fiscal/comprovante-cancelamento?ref=NFE-25028-001
 *
 * Baixa o comprovante de cancelamento de uma NF-e cancelada: o XML do evento
 * (`procEventoNFe`, evento 110111, com o protocolo da SEFAZ). Pedido da Edina,
 * 16/11/2026.
 *
 * DE ONDE VEM O ARQUIVO
 *   Ao cancelar, a Focus devolve só `caminho_xml_cancelamento` (o XML do
 *   evento; não há PDF do cancelamento na NF-e). O fluxo de cancelamento do n8n
 *   baixa esse XML da Focus, com o token da empresa da nota, e o guarda no
 *   bucket privado `nfe-documentos` em `<ref>/cancelamento.xml`. O token da
 *   Focus fica só no n8n; o Vibe nunca o vê. Esta rota entrega essa cópia, que
 *   é o mesmo arquivo da Focus. Nada é pedido de novo à Focus e nada é
 *   cancelado, reenviado ou emitido.
 *
 * QUEM PODE
 *   Quem tem sessão e enxerga a nota. A nota é relida com o JWT do usuário (o
 *   RLS de `notas_fiscais` decide) e precisa estar CANCELADA. Só então a chave
 *   de serviço baixa ESTE arquivo DESTA nota. O caminho é montado aqui, nunca
 *   vem do navegador.
 *
 * NFS-e: o cancelamento de NFS-e não passa pelo Vibe (o item está desligado) e
 *   a Focus devolve só `{status: "cancelado"}` ao cancelar. Não há comprovante
 *   guardado, então a rota só atende NF-e.
 *
 * Só leitura.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "nfe-documentos";
const REF_VALIDA = /^NFE-[0-9A-Z-]{1,40}$/;

function erro(status: number, message: string) {
  return NextResponse.json({ success: false, message }, { status });
}

export async function GET(request: Request) {
  try {
    const ref = String(new URL(request.url).searchParams.get("ref") ?? "").trim().toUpperCase();
    if (!REF_VALIDA.test(ref)) return erro(400, "Referência da NF-e inválida.");

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
      .select("ref, id_int, numero_nf, status")
      .eq("ref", ref)
      .maybeSingle();
    if (error) {
      console.error("[API][ComprovanteCancelamento] Falha ao ler a nota:", error.message);
      return erro(500, "Não foi possível ler a nota no banco.");
    }
    if (!nota) return erro(404, "Nota não encontrada.");
    const linha = nota as { ref: string; id_int: number | null; numero_nf: string | number | null; status: string | null };
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

    const nome = nomeDoComprovanteDeCancelamento({ numero: linha.numero_nf, idInt: linha.id_int, ref });
    return new Response(conteudo, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
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
