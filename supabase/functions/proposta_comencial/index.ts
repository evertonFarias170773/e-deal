import { createClient } from "npm:@supabase/supabase-js@2.46.1";
import { ErroPdf, montarPdfProposta, sanitizeName, type Documento } from "./gerar.ts";

// ============================
// CORS
// ============================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Helpers
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
  });

Deno.serve(async (req) => {
  try {
    // ============================
    // CORS preflight
    // ============================
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        status: 200,
        headers: corsHeaders,
      });
    }

    if (req.method !== "POST") {
      return json({ error: "Método não permitido" }, 405);
    }

    // ============================
    // PARÂMETROS
    // ============================
    let body;

    try {
      body = await req.json();
    } catch (e) {
      console.error("JSON inválido recebido:", e);
      return json({ error: "JSON inválido no body da requisição" }, 400);
    }

    const {
      id_int: rawIdInt,
      id_modelo,
      id_empresa,
      documento: rawDocumento,
      obs_proposta: obsPropostaBody,
    } = body;

    const id_int = Number(rawIdInt);

    if (!id_int || Number.isNaN(id_int)) {
      return json(
        { error: "Parâmetro 'id_int' é obrigatório e deve ser numérico" },
        400
      );
    }

    if (id_modelo != null && typeof id_modelo !== "number") {
      return json({ error: "Parâmetro 'id_modelo' deve ser numérico" }, 400);
    }

    if (id_empresa != null && typeof id_empresa !== "number") {
      return json({ error: "Parâmetro 'id_empresa' deve ser numérico" }, 400);
    }

    if (!id_modelo && !id_empresa) {
      return json(
        { error: "Informe 'id_empresa' (ou o antigo 'id_modelo')" },
        400
      );
    }

    const documento: Documento = rawDocumento === "oc" ? "oc" : "orcamento";

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Variáveis de ambiente ausentes." }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { bytes: pdfBytes, cliente } = await montarPdfProposta(supabase, SUPABASE_URL, {
      idInt: id_int,
      idEmpresa: id_empresa ?? null,
      idModelo: id_modelo ?? null,
      documento,
      obsPropostaBody,
    });

    // ============================
    // SALVAR PDF
    // ============================
    const bucket = "pdf_fatura";
    const prefixo = documento === "oc" ? "oc" : "proposta";
    const fileName = `${prefixo}_${sanitizeName(cliente)}_${id_int}_${Date.now()}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(fileName, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      console.error("Erro ao salvar PDF no storage:", uploadError);
      return json({ error: "Erro ao salvar PDF" }, 500);
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${fileName}`;

    return json({
      success: true,
      url: publicUrl,
    });
  } catch (e) {
    if (e instanceof ErroPdf) {
      return json({ error: e.message }, e.status);
    }
    console.error("ERRO:", e);
    return json({ error: "Erro ao gerar PDF", detalhe: String(e) }, 500);
  }
});
