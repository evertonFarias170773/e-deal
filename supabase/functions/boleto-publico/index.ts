import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 👉 pega o código da URL
    const urlReq = new URL(req.url);
    const codigo = urlReq.searchParams.get("codigo");

    if (!codigo) {
      return new Response(
        JSON.stringify({ error: "Parâmetro 'codigo' é obrigatório" }),
        { headers: corsHeaders, status: 400 }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // --- Correcao 22/09/2026 -------------------------------------------
    // Desde a migration 20260817_boletos_n_doc_unico_somente_ativos.sql um
    // mesmo `n_doc_boleto` pode ter uma linha CANCELADA e uma ativa: o indice
    // unico passou a valer so para as ativas, justamente para permitir cancelar
    // e refaturar a mesma parcela. O `.single()` que estava aqui falha com duas
    // linhas, e o catch abaixo transforma isso em 404 "Boleto nao encontrado" —
    // era esse o link quebrado dos pedidos refaturados (22285, 22120, 19923,
    // 21965, 21878, 20087 e outros).
    //
    // Agora a busca PREFERE A LINHA NAO CANCELADA, mais recente primeiro.
    // `idx_boletos_n_doc_boleto_ativo` garante no maximo uma ativa; a ordem por
    // `created_at` e cinto de seguranca para status nulo.
    //
    // Sem nenhuma linha ativa, o comportamento e exatamente o de antes: uma
    // linha unica serve, varias continuam 404. Servir boleto cancelado seria
    // pior que o defeito — o cliente pagaria um titulo ja baixado no banco.
    const { data: linhas, error } = await supabase
      .from("boletos")
      .select("*")
      .eq("n_doc_boleto", codigo);

    const ativas = (linhas ?? [])
      .filter((linha) => String(linha.status ?? "").toUpperCase() !== "CANCELADO")
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));

    const boleto = ativas[0] ?? (linhas?.length === 1 ? linhas[0] : null);

    if (error || !boleto) {
      return new Response(
        JSON.stringify({ error: "Boleto não encontrado" }),
        { headers: corsHeaders, status: 404 }
      );
    }

    // 🔥 monta a URL correta SEM depender do banco
    const pdfUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/boletos/${boleto.id_int}/parcela_${boleto.parcela}.pdf`;

const pdfResponse = await fetch(pdfUrl);

// Objeto ausente no Storage: sem isto o corpo de erro do Storage (400, ~88
// bytes de JSON) sairia daqui como HTTP 200 `application/pdf` — arquivo
// quebrado anunciado como PDF. 21878 e 21965 estao nesse estado: boleto
// existe na tabela, PDF nunca foi gerado.
if (!pdfResponse.ok) {
  return new Response(
    JSON.stringify({ error: "PDF do boleto ainda não foi gerado" }),
    { headers: corsHeaders, status: 404 }
  );
}

const pdfBytes = await pdfResponse.arrayBuffer();

return new Response(pdfBytes, {
  headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": "inline",
  },
});

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: corsHeaders, status: 500 }
    );
  }
});