import type { SupabaseClient } from "npm:@supabase/supabase-js@2.46.1";
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

// ============================
// MONTAGEM DO PDF (sem gravar nada)
// ============================
// Dois documentos sobre o mesmo desenho de dados:
//   - "orcamento": modelo em empresas.url_pdf_base_prop;
//   - "oc" (autorização de faturamento): modelo em empresas.url_pdf_base_oc.
// Os modelos dessas colunas (03/10/2026) são só o fundo: logo, título, caixa do
// número, VALOR TOTAL (no orçamento) e rodapé. Os rótulos (CLIENTE:, CPF/CNPJ:,
// QTD, Produto, Sub Total...) e a linha da empresa com CNPJ e endereço são
// escritos aqui, nas mesmas posições do modelo antigo.
// Sem modelo na coluna, o orçamento cai no modelo antigo de
// pdf_propostas_modelos, que já traz os rótulos impressos.

export type Documento = "orcamento" | "oc";

export type ParametrosPdf = {
  idInt: number;
  idEmpresa?: number | null;
  idModelo?: number | null;
  documento: Documento;
  obsPropostaBody?: string | null;
};

export class ErroPdf extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const normalizeMultiline = (text: string | null | undefined) => {
  if (!text) return "";

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
};

const formatDate = (iso: string | null) => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

export const sanitizeName = (s: string | null) =>
  (s ?? "cliente")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
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
    .replace(/️/g, "")
    .replace(/‍/g, "")
    .replace(/ /g, " ")
    .replace(/×/g, "x")
    .trim();

const formatCnpj = (doc: string | null | undefined) => {
  const d = String(doc ?? "").replace(/\D/g, "");
  if (d.length !== 14) return String(doc ?? "");
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

const formatCep = (cep: string | null | undefined) => {
  const d = String(cep ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 2)}.${d.slice(2, 5)}-${d.slice(5)}` : String(cep ?? "");
};

const PREPOSICOES = new Set(["de", "da", "do", "das", "dos", "e"]);
const capitalizar = (s: string | null | undefined) =>
  String(s ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => (i > 0 && PREPOSICOES.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");

type Empresa = {
  id: number;
  empresa: string | null;
  cnpj: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  municipio: string | null;
  uf: string | null;
  url_pdf_base_prop: string | null;
  url_pdf_base_oc: string | null;
};

const linhaEndereco = (e: Empresa) =>
  [
    [capitalizar(e.logradouro), e.numero].filter(Boolean).join(", "),
    e.complemento ? capitalizar(e.complemento) : "",
    e.bairro ? `B. ${capitalizar(e.bairro)}` : "",
    e.cep ? `CEP ${formatCep(e.cep)}` : "",
    e.municipio ?? "",
    e.uf ?? "",
  ]
    .filter(Boolean)
    .join(" - ");

// Cor dos rótulos de cada empresa: a mesma do modelo antigo.
const COR_ROTULO: Record<number, [number, number, number]> = {
  1: [0x01, 0x8d, 0x9e],
  2: [0x23, 0x1f, 0x20],
  3: [0x00, 0x7a, 0x5a],
};
const COR_TEXTO: [number, number, number] = [0x23, 0x1f, 0x20];
const cor = ([r, g, b]: [number, number, number]) => rgb(r / 255, g / 255, b / 255);

// ============================
// MODELO: Storage do projeto (bucket privado, lido com a service role) ou URL
// ============================
async function carregarModelo(
  supabase: SupabaseClient,
  supabaseUrl: string,
  ref: string
): Promise<Uint8Array> {
  let url: URL | null = null;
  try {
    url = new URL(ref);
  } catch {
    url = null;
  }

  const doProjeto =
    url && url.host === new URL(supabaseUrl).host
      ? url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/|public\/)?([^/]+)\/(.+)$/)
      : null;

  if (doProjeto) {
    const bucket = doProjeto[1];
    const caminho = decodeURIComponent(doProjeto[2]);
    const { data, error } = await supabase.storage.from(bucket).download(caminho);
    if (error || !data) {
      console.error("Erro ao baixar modelo do Storage:", bucket, caminho, error);
      throw new ErroPdf("Modelo PDF não encontrado no Storage", 404);
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  const resposta = await fetch(ref);
  if (!resposta.ok) {
    throw new Error("Erro ao carregar template PDF");
  }
  return new Uint8Array(await resposta.arrayBuffer());
}

export async function montarPdfProposta(
  supabase: SupabaseClient,
  supabaseUrl: string,
  params: ParametrosPdf
): Promise<{ bytes: Uint8Array; cliente: string }> {
  const { idInt: id_int, documento } = params;

  // ============================
  // EMPRESA E MODELO
  // ============================
  // id_empresa vem das telas; id_modelo (10, 11, 12) é o parâmetro antigo,
  // ainda usado pelo Maestro: a linha de pdf_propostas_modelos diz a empresa.
  let idEmpresa = Number(params.idEmpresa) || null;
  let modeloAntigo: string | null = null;

  if (params.idModelo) {
    const { data: modeloData, error: modeloError } = await supabase
      .from("pdf_propostas_modelos")
      .select("id_empresa, modelo_pdf")
      .eq("id", params.idModelo)
      .limit(1);

    if (modeloError || !modeloData || modeloData.length === 0) {
      console.error("Erro ao buscar modelo PDF:", modeloError);
      throw new ErroPdf("Modelo PDF não encontrado", 404);
    }
    idEmpresa = idEmpresa ?? Number(modeloData[0].id_empresa);
    modeloAntigo = modeloData[0].modelo_pdf;
  }

  if (!idEmpresa) {
    throw new ErroPdf("Informe 'id_empresa' ou 'id_modelo'", 400);
  }

  const { data: empresaData, error: empresaError } = await supabase
    .from("empresas")
    .select(
      "id, empresa, cnpj, logradouro, numero, complemento, bairro, cep, municipio, uf, url_pdf_base_prop, url_pdf_base_oc"
    )
    .eq("id", idEmpresa)
    .single();

  if (empresaError || !empresaData) {
    console.error("Erro ao buscar empresa:", empresaError);
    throw new ErroPdf("Empresa não encontrada", 404);
  }
  const empresa = empresaData as Empresa;

  let templateRef =
    documento === "oc" ? empresa.url_pdf_base_oc : empresa.url_pdf_base_prop;
  const escreverRotulos = Boolean(templateRef);

  if (!templateRef) {
    if (documento === "oc") {
      throw new ErroPdf("Modelo de OC não cadastrado para esta empresa", 404);
    }
    if (!modeloAntigo) {
      const { data: geral } = await supabase
        .from("pdf_propostas_modelos")
        .select("modelo_pdf")
        .eq("id_empresa", idEmpresa)
        .eq("pagamento", "GERAL")
        .limit(1);
      modeloAntigo = geral?.[0]?.modelo_pdf ?? null;
    }
    if (!modeloAntigo) {
      throw new ErroPdf("Modelo PDF não encontrado", 404);
    }
    templateRef = modeloAntigo;
  }

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
    throw new ErroPdf("Proposta não encontrada", 404);
  }

  const proposta = propostaData[0];

  // ============================
  // BUSCAR id_faturado NA TABELA PROPOSTAS
  // ============================
  const { data: propostaFat, error: propostaFatError } = await supabase
    .from("propostas")
    .select("id_faturado, obs_proposta, modalidade_frete, frete_escolhido, id_endereco_ent")
    .eq("id_int", id_int)
    .single();

  if (propostaFatError || !propostaFat) {
    console.error("Erro ao buscar id_faturado na proposta:", propostaFatError);
    throw new ErroPdf("Proposta não encontrada para faturamento", 404);
  }

  // ============================
  // ENTREGA E ENVIO (só a OC mostra)
  // ============================
  // Endereço: o que a proposta gravou (propostas.id_endereco_ent).
  // Envio: modalidade + o mesmo nome da coluna Envio da lista de Pedidos, pela
  // regra de nomeTransporteEfetivo (src/features/orcamentos/lib/modalidade-frete.ts):
  // FOB -> transportadora gravada em frete_escolhido; CIF ou sem modalidade ->
  // serviço cotado gravado em frete_escolhido. RETIRA não usa o nome da
  // coluna: ENVIO repete "Retira no balcão", igual à linha ENTREGA.
  const modalidade = String(propostaFat.modalidade_frete ?? "").trim().toUpperCase() || null;
  let linhaEntrega = "";
  let linhaEnvio = "";
  if (documento === "oc") {
    const freteGravado = String(propostaFat.frete_escolhido ?? "").trim();
    const nomeEnvio =
      modalidade === "FOB" ? freteGravado || "Transportadora a definir" : freteGravado;
    linhaEnvio =
      modalidade === "RETIRA" ? "Retira no balcão"
      : modalidade ? `${modalidade} — ${nomeEnvio || "—"}`
      : nomeEnvio || "—";

    if (modalidade === "RETIRA") {
      linhaEntrega = "Retira no balcão";
    } else if (propostaFat.id_endereco_ent) {
      const { data: end } = await supabase
        .from("enderecos")
        .select("endereco, numero, complemento, bairro, cep, cidade, uf")
        .eq("id", propostaFat.id_endereco_ent)
        .maybeSingle();
      if (end) {
        // O cadastro às vezes traz espaços em sequência no meio do texto, ou um
        // "-" no lugar do complemento vazio: parte só de pontuação sai.
        const limpo = (v: unknown) => {
          const t = String(v ?? "").replace(/\s+/g, " ").trim();
          return /^[\s\-–—.,/]*$/.test(t) ? "" : t;
        };
        linhaEntrega = [
          [end.endereco, end.numero].map(limpo).filter(Boolean).join(", "),
          limpo(end.complemento),
          limpo(end.bairro),
          end.cep ? `CEP ${formatCep(end.cep)}` : "",
          limpo(end.cidade),
          limpo(end.uf),
        ]
          .filter(Boolean)
          .join(" - ");
      }
    }
    linhaEntrega = linhaEntrega || "Endereço de entrega não informado";
  }

  const obsNormalizada = normalizeMultiline(
    propostaFat.obs_proposta ?? params.obsPropostaBody ?? ""
  );

  // Fallback seguro:
  // se não houver id_faturado, usa o id_cliente da view
  const idClienteBusca = propostaFat.id_faturado ?? proposta.id_cliente;

  if (!idClienteBusca) {
    throw new ErroPdf("A proposta não possui id_faturado nem id_cliente válido.", 400);
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
    throw new ErroPdf("Cliente faturado não encontrado", 404);
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
    throw new ErroPdf("Erro ao buscar itens da proposta", 500);
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
  const templatePdfBytes = await carregarModelo(supabase, supabaseUrl, templateRef);
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
    align: Align = "left",
    color = rgb(0, 0, 0),
    pagina = page
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

    pagina.drawText(t, {
      x: xFinal,
      y,
      size,
      font: f,
      color,
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
  // RÓTULOS (modelos novos, que vêm sem eles)
  // ============================
  const corRotulo = cor(COR_ROTULO[idEmpresa] ?? COR_TEXTO);
  const corTexto = cor(COR_TEXTO);
  const ehOc = documento === "oc";

  // A OC traz o mesmo conteúdo do orçamento. O bloco de cima muda de ordem e
  // de altura porque o modelo de OC tem "Dados para faturamento:" impresso
  // (y 731) e ele introduz os dados do CLIENTE: logo abaixo vêm CLIENTE,
  // CPF/CNPJ, ENTREGA e ENVIO (os dois últimos só a OC tem); depois "Orçado
  // por:"; por último a empresa emissora e o endereço dela. Para caber, as
  // linhas ficam a 15 pt e a tabela de produtos (DETALHES, QTD/Produto e
  // itens) desce 21 pt; totais, observações e assinatura não mudam.
  const yCliente = ehOc ? 716 : 680;
  const yDocumento = ehOc ? 702 : 660;
  const yEntrega = 687;
  const yEnvio = 672;
  const yVendedor = ehOc ? 657 : 709;
  const yEmpresa = ehOc ? 642 : 743;
  const yEndereco = ehOc ? 627 : 726;
  const descidaTabela = ehOc ? 21 : 0;

  // A linha da empresa termina antes de "DATA:" / "Validade" (x 473): o texto
  // longo diminui a fonte em vez de invadir a coluna da direita.
  const tamanhoQueCabe = (t: string, bold: boolean, tamanho: number, largura: number) => {
    const f = bold ? fontBold : font;
    let s = tamanho;
    while (s > 7 && f.widthOfTextAtSize(sanitizeForPdf(t), s) > largura) s -= 0.25;
    return s;
  };

  if (escreverRotulos) {
    const linhaEmpresa = `${empresa.empresa ?? ""} - CNPJ: ${formatCnpj(empresa.cnpj)}`;
    const endereco = linhaEndereco(empresa);
    drawText(linhaEmpresa, 31.5, yEmpresa, tamanhoQueCabe(linhaEmpresa, true, 11, 435), true, "left", corTexto);
    drawText(endereco, 31.5, yEndereco, tamanhoQueCabe(endereco, false, 11, 435), false, "left", corTexto);
    if (ehOc) {
      // O modelo de orçamento já traz estes textos; o de OC não. Mesma grafia
      // do orçamento ("Válidade").
      drawText("DATA:", 473.1, 740.8, 9, true, "left", corRotulo);
      drawText("Válidade: 15 dias", 477.8, 725.5, 9, true, "left", corRotulo);
      drawText(
        "A entrega será realizada por empresa terceira contratada,  (Correios, Azul Cargo, Transportadora, etc...).",
        29.6, 149, 10, false, "left", corTexto
      );
    }
    drawText("Orçado por:", 31.5, yVendedor - 0.5, 10, true, "left", corTexto);
    drawText("CLIENTE:", 31.5, yCliente - 0.5, 10, true, "left", corRotulo);
    drawText("CPF/CNPJ:", 31.5, yDocumento - 0.3, 10, true, "left", corRotulo);
    if (ehOc) {
      drawText("ENTREGA:", 31.5, yEntrega - 0.3, 10, true, "left", corRotulo);
      drawText("ENVIO:", 31.5, yEnvio - 0.3, 10, true, "left", corRotulo);
    }
    drawText("DETALHES DO ORÇAMENTO:", 31.6, 627 - descidaTabela, 12, true, "left", corRotulo);
    drawText("*P.P. - Prazo de Produção.", 228.9, 627 - descidaTabela, 10, true, "left", corRotulo);
    drawText("QTD", 31.9, 602.7 - descidaTabela, 12, true, "left", corRotulo);
    drawText("Produto", 144.4, 602.8 - descidaTabela, 12, true, "left", corRotulo);
    drawText("Sub Total (Produtos):", 364.8, 365.5, 12, false, "left", corTexto);
    if (ehOc) {
      drawText("VALOR TOTAL:", 390.3, 304.8, 12, true, "left", corRotulo);
    }
    if (obsNormalizada) {
      drawText("Observações :", 29.5, 281.3, 12, true, "left", corTexto);
    }
  }

  // ============================
  // CABEÇALHO
  // ============================
  drawText(String(id_int), 514, 760, 16, true, "center");
  drawText(formatDate(dataProposta), 505, 741, 10);

  // Na OC o cliente fica na altura de "Válidade" (x 478): nome longo diminui.
  drawText(cliente, 92, yCliente, ehOc ? tamanhoQueCabe(cliente, false, 11, 375) : 11);
  drawText(cpf_cnpj, 92, yDocumento, 10);
  drawText(vendedor, 100, yVendedor, 9);

  if (ehOc) {
    // Endereço longo diminui a fonte para não passar da margem direita.
    drawText(linhaEntrega, 92, yEntrega, tamanhoQueCabe(linhaEntrega, false, 10, 470));
    drawText(linhaEnvio, 92, yEnvio, tamanhoQueCabe(linhaEnvio, false, 10, 470));
  }

  // ============================
  // PRODUTOS COM WRAP
  // ============================
  let currentY = 580 - descidaTabela;
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

  // ============================
  // OBSERVAÇÕES
  // ============================
  // Espaço: de y 266 (abaixo do VALOR TOTAL) até y 162 (acima da frase da
  // entrega, em y 149). Na OC todas as linhas ficam na coluna da esquerda, antes
  // da linha da assinatura (x 307); no orçamento, na largura de sempre.
  // Não cabe: a fonte desce de 10 até 7 pt, de 0,5 em 0,5. Ainda não cabe:
  // nada é cortado — o resto vai para páginas "Observações (continuação)",
  // com o mesmo modelo de fundo e o número da proposta no cabeçalho.
  if (obsNormalizada) {
    const xObs = 30;
    const larguraObs = ehOc ? 270 : 500;
    const yTopo = 266;
    const yFim = 162;
    const entrelinha = (tamanho: number) => tamanho * 1.5;
    const cabem = (topo: number, tamanho: number) =>
      Math.floor((topo - yFim) / entrelinha(tamanho)) + 1;

    let tamanhoObs = 10;
    let linhasObs = wrapLine(obsNormalizada, larguraObs, tamanhoObs);
    while (tamanhoObs > 7 && linhasObs.length > cabem(yTopo, tamanhoObs)) {
      tamanhoObs -= 0.5;
      linhasObs = wrapLine(obsNormalizada, larguraObs, tamanhoObs);
    }

    const naPrimeira = linhasObs.slice(0, cabem(yTopo, tamanhoObs));
    naPrimeira.forEach((linha, idx) => {
      drawText(linha, xObs, yTopo - idx * entrelinha(tamanhoObs), tamanhoObs);
    });

    let restantes = linhasObs.slice(naPrimeira.length);
    if (restantes.length > 0) {
      // Cópia limpa do modelo (o pdfDoc já tem os textos da primeira página).
      const modeloLimpo = await PDFDocument.load(templatePdfBytes, { ignoreEncryption: true });
      const yTopoContinuacao = 680;
      while (restantes.length > 0) {
        const [pagina] = await pdfDoc.copyPages(modeloLimpo, [0]);
        pdfDoc.addPage(pagina);
        drawText(String(id_int), 514, 760, 16, true, "center", rgb(0, 0, 0), pagina);
        if (ehOc) drawText("DATA:", 473.1, 740.8, 9, true, "left", corRotulo, pagina);
        drawText(formatDate(dataProposta), 505, 741, 10, false, "left", rgb(0, 0, 0), pagina);
        drawText("Observações (continuação)", 29.5, 700, 12, true, "left", corTexto, pagina);
        const nestaPagina = restantes.slice(0, cabem(yTopoContinuacao, tamanhoObs));
        nestaPagina.forEach((linha, idx) => {
          drawText(
            linha, xObs, yTopoContinuacao - idx * entrelinha(tamanhoObs),
            tamanhoObs, false, "left", rgb(0, 0, 0), pagina
          );
        });
        restantes = restantes.slice(nestaPagina.length);
      }
    }
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

  return { bytes: await pdfDoc.save(), cliente };
}
