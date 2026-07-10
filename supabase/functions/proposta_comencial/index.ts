import { createClient } from "npm:@supabase/supabase-js@2.46.1";
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

// ============================
// CORS
// ============================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const normalizeMultiline = (text: string | null | undefined) => {
  if (!text) return "";

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
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

const formatDate = (iso: string | null) => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const sanitizeName = (s: string | null) =>
  (s ?? "cliente")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);

const formatBRL = (value: unknown) => {
  const n = Number(value ?? 0);
  return (
    "R$ " +
    n
      .toFixed(2)
      .replace(".", ",")
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  );
};

const sanitizeForPdf = (str: string | null | undefined) =>
  (str ?? "-")
    .replace(/\uFE0F/g, "")
    .replace(/\u200D/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/×/g, "x")
    .trim();

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
      obs_proposta: obsPropostaBody,
    } = body;

    const id_int = Number(rawIdInt);

    if (!id_int || Number.isNaN(id_int)) {
      return json(
        { error: "Parâmetro 'id_int' é obrigatório e deve ser numérico" },
        400
      );
    }

    if (!id_modelo || typeof id_modelo !== "number") {
      return json(
        { error: "Parâmetro 'id_modelo' é obrigatório e deve ser numérico" },
        400
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Variáveis de ambiente ausentes." }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // ============================
    // BUSCAR PROPOSTA (VIEW)
    // ============================
    const { data: propostaData, error: propostaError } = await supabase
      .from("vw_proposta_completa")
      .select("*")
      .eq("id_int", id_int)
      .limit(1);

    if (propostaError || !propostaData || propostaData.length === 0) {
      console.error("Erro ao buscar vw_proposta_completa:", propostaError);
      return json({ error: "Proposta não encontrada" }, 404);
    }

    const proposta = propostaData[0];

    // ============================
    // BUSCAR id_faturado NA TABELA PROPOSTAS
    // ============================
    const { data: propostaFat, error: propostaFatError } = await supabase
      .from("propostas")
      .select("id_faturado, obs_proposta")
      .eq("id_int", id_int)
      .single();

    if (propostaFatError || !propostaFat) {
      console.error("Erro ao buscar id_faturado na proposta:", propostaFatError);
      return json({ error: "Proposta não encontrada para faturamento" }, 404);
    }

    const obsNormalizada = normalizeMultiline(
      propostaFat.obs_proposta ?? obsPropostaBody ?? ""
    );

    // Fallback seguro:
    // se não houver id_faturado, usa o id_cliente da view
    const idClienteBusca = propostaFat.id_faturado ?? proposta.id_cliente;

    if (!idClienteBusca) {
      return json(
        { error: "A proposta não possui id_faturado nem id_cliente válido." },
        400
      );
    }

    // ============================
    // BUSCAR NOME + DOCUMENTO DO CLIENTE
    // ref: clientes.id_cliente = propostas.id_faturado
    // ============================
    const { data: clienteData, error: clienteError } = await supabase
      .from("clientes")
      .select("nome, documento")
      .eq("id_cliente", idClienteBusca)
      .single();

    if (clienteError || !clienteData) {
      console.error("Erro ao buscar cliente faturado:", clienteError);
      return json({ error: "Cliente faturado não encontrado" }, 404);
    }

    const cliente = clienteData.nome ?? "";
    const cpf_cnpj = clienteData.documento ?? "";
    const vendedor = proposta.vendedor ?? "";

    const valorProdutos = proposta.valor_produtos ?? 0;
    const valorDesconto = proposta.desconto_calculado ?? 0;
    const valorFrete = proposta.valor_frete ?? 0;
    const valorTotal = proposta.valor_total_calculado ?? 0;
    const freteEscolhido = proposta.frete_escolhido ?? "";
    const dataProposta = proposta.created_at;

    // ============================
    // ITENS DA PROPOSTA
    // ============================
    type ItemLinha = { left: string; valor: string };

    const itensLista: ItemLinha[] = [];

    const { data: itensData, error: itensError } = await supabase
      .from("produtos_proposta")
      .select("qtd, nome_produto, modelo_descri, valor_sub_total")
      .eq("id_int", id_int)
      .order("id_produto", { ascending: true })
      .limit(1000);

    if (itensError) {
      console.error("Erro ao buscar itens da proposta:", itensError);
      return json({ error: "Erro ao buscar itens da proposta" }, 500);
    }

    if (itensData && itensData.length > 0) {
      for (const item of itensData as any[]) {
        const qtd = item.qtd ?? 0;
        const nome = sanitizeForPdf(item.nome_produto ?? "");
        const modelo = sanitizeForPdf(item.modelo_descri ?? "");
        const produtoCompleto = modelo ? `${nome} - ${modelo}` : nome;

        itensLista.push({
          left: `${qtd}  ${produtoCompleto}`,
          valor: formatBRL(item.valor_sub_total ?? 0),
        });
      }
    }

    // ============================
    // TEMPLATE PDF
    // ============================
    const { data: modeloData, error: modeloError } = await supabase
      .from("pdf_propostas_modelos")
      .select("modelo_pdf")
      .eq("id", id_modelo)
      .limit(1);

    if (modeloError || !modeloData || modeloData.length === 0) {
      console.error("Erro ao buscar modelo PDF:", modeloError);
      return json({ error: "Modelo PDF não encontrado" }, 404);
    }

    const templateUrl = modeloData[0].modelo_pdf;

    const templateResponse = await fetch(templateUrl);
    if (!templateResponse.ok) {
      throw new Error("Erro ao carregar template PDF");
    }

    const templatePdfBytes = new Uint8Array(
      await templateResponse.arrayBuffer()
    );
    const pdfDoc = await PDFDocument.load(templatePdfBytes, {
      ignoreEncryption: true,
    });

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const page = pdfDoc.getPage(0);

    type Align = "left" | "right" | "center";

    const drawText = (
      text: string | number | null | undefined,
      x: number,
      y: number,
      size = 10,
      bold = false,
      align: Align = "left"
    ) => {
      const raw = text != null ? String(text) : "-";
      const t = sanitizeForPdf(raw).replace(/\n/g, " ");
      const f = bold ? fontBold : font;

      let xFinal = x;
      if (align === "right") {
        const width = f.widthOfTextAtSize(t, size);
        xFinal = x - width;
      } else if (align === "center") {
        const width = f.widthOfTextAtSize(t, size);
        xFinal = x - width / 2;
      }

      page.drawText(t, {
        x: xFinal,
        y,
        size,
        font: f,
        color: rgb(0, 0, 0),
      });
    };

    // ============================
    // FUNÇÃO DE QUEBRA DE LINHA
    // ============================
    function wrapLine(text: string, maxWidth: number, fontSize: number) {
      const clean = sanitizeForPdf(text);

      const logicalLines = clean.split("\n");
      const finalLines: string[] = [];

      for (const logical of logicalLines) {
        const words = logical.split(" ");
        let currentLine = "";

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const width = font.widthOfTextAtSize(testLine, fontSize);

          if (width > maxWidth && currentLine) {
            finalLines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }

        if (currentLine) {
          finalLines.push(currentLine);
        }
      }

      return finalLines;
    }

    // ============================
    // CABEÇALHO
    // ============================
    drawText(String(id_int), 514, 760, 16, true, "center");
    drawText(formatDate(dataProposta), 505, 741, 10);

    drawText(cliente, 92, 680, 11);
    drawText(cpf_cnpj, 92, 660, 10);
    drawText(vendedor, 100, 709, 9);

    // ============================
    // PRODUTOS COM WRAP
    // ============================
    let currentY = 580;
    const fontSize = 11;
    const lineSpacing = 7;
    const maxWidthProduto = 460;

    for (const item of itensLista) {
      const linhas = wrapLine(item.left, maxWidthProduto, fontSize);

      linhas.forEach((linha, idx) => {
        const y = currentY - idx * (fontSize + lineSpacing);

        drawText(linha, 36, y, fontSize);

        if (idx === 0) {
          drawText(item.valor, 568, y, fontSize, false, "right");
        }
      });

      currentY -= linhas.length * (fontSize + lineSpacing);
    }

    if (obsNormalizada) {
      const obsFontSize = 10;
      const obsLineSpacing = 5;
      const obsMaxWidth = 500;

      const linhasObs = wrapLine(obsNormalizada, obsMaxWidth, obsFontSize);

      linhasObs.forEach((linha, idx) => {
        const y = 266 - idx * (obsFontSize + obsLineSpacing);
        drawText(linha, 30, y, obsFontSize);
      });
    }

    // ============================
    // TOTAIS
    // ============================
    drawText(formatBRL(valorTotal), 568, 305, 12, true, "right");
    drawText(formatBRL(valorProdutos), 568, 366, 11, true, "right");

    if (valorDesconto > 0) {
      drawText("Desconto:", 475, 325, 10.5, true, "right");
      drawText(formatBRL(valorDesconto), 568, 325, 11, false, "right");
    }

    if (valorFrete > 0) {
      const labelFrete = freteEscolhido
        ? `Frete (${sanitizeForPdf(freteEscolhido)})`
        : "Frete";

      drawText(labelFrete, 475, 345, 10, false, "right");
      drawText(formatBRL(valorFrete), 568, 345, 10, false, "right");
    }

    // ============================
    // SALVAR PDF
    // ============================
    const pdfBytes = await pdfDoc.save();

    const bucket = "pdf_fatura";
    const fileName = `proposta_${sanitizeName(cliente)}_${id_int}_${Date.now()}.pdf`;

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
    console.error("ERRO:", e);
    return json({ error: "Erro ao gerar PDF", detalhe: String(e) }, 500);
  }
});