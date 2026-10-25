import { formatCurrency } from "@/lib/formatters/currency";
import { formatDataCivil } from "@/lib/formatters/date";
import { addDays } from "@/lib/period";
import { OPCOES_EMPRESA } from "../lib/opcoes";
import type {
  ArquivosDoZip,
  ColunaPdf,
  ConsultaRelatorio,
  LinhaRelatorio,
  ModeloPdf,
  RelatorioDef,
  ResultadoRelatorio
} from "../types";

/**
 * Notas fiscais (NF-e) do mês — para a contabilidade fechar os impostos.
 *
 * Dados: `rpc_relatorio_notas_fiscais` (só leitura). Lista só as NF-e autorizadas de venda
 * ("Venda de produção do estabelecimento"), com produtos, frete e total como estão na nota.
 * Canceladas e de outra natureza ficam fora da lista e são citadas, com o número, na nota de
 * critério. NFS-e (serviço) não entra. A função confere a permissão `relatorios.notas_fiscais`.
 *
 * Arquivos: o XML de cada NF-e está no bucket privado `nfe-documentos` (`<ref>/nfe.xml`), lido na
 * rota com o cliente de serviço. Os XML de cancelamento e de carta de correção NÃO estão no ERP
 * (só no provedor fiscal): o zip sai sem eles e o PDF e a tela avisam quais faltam.
 */

const BUCKET = "nfe-documentos";
const NATUREZA_VENDA = "Venda de produção do estabelecimento";
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const numero = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (v: number | string | null | undefined) => Number(v ?? 0);
const plural = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;
const listaNf = (itens: string[]) => itens.map((x) => String(x)).join(", ");

function formatarCnpj(cnpj: string) {
  const d = String(cnpj ?? "").replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : cnpj;
}

/** "Setembro/2026" quando o período é um mês inteiro; senão, o intervalo. */
function rotuloDoPeriodo({ inicio, fim }: { inicio: string; fim: string }) {
  const [ano, mes, dia] = inicio.split("-").map(Number);
  const ultimoDia = addDays(`${mes === 12 ? ano + 1 : ano}-${String(mes === 12 ? 1 : mes + 1).padStart(2, "0")}-01`, -1);
  if (dia === 1 && fim === ultimoDia) return { texto: `${MESES[mes - 1]}/${ano}`, mesInteiro: true, mm: String(mes).padStart(2, "0"), aaaa: String(ano) };
  return { texto: `${formatDataCivil(inicio)} a ${formatDataCivil(fim)}`, mesInteiro: false, mm: "", aaaa: "" };
}

const serieDe = (consulta: ConsultaRelatorio) => consulta.filtros.serie || "2";

type NotaApi = {
  numero_nf: string;
  ref: string;
  data: string;
  destinatario: string;
  cfop: string | null;
  produtos: number | string;
  frete: number | string;
  total: number | string;
};

type NfeXml = { numero_nf: string; ref: string; chave: string | null; status: string };
type EventoApi = { tipo: string; numero_nf: string; ref: string; chave: string | null; sequencia: number | null; dia: string };

type RespostaApi = {
  emitente?: { razao_social?: string; cnpj?: string };
  filtros?: { serie?: string };
  totais?: {
    quantidade?: number;
    produtos?: number | string;
    frete?: number | string;
    total?: number | string;
    nfe_no_periodo?: number;
    cancelamentos?: number;
    cartas_correcao?: number;
  };
  notas?: NotaApi[];
  canceladas?: Array<{ numero_nf: string }>;
  outras?: Array<{ numero_nf: string; natureza: string }>;
  nfe_xml?: NfeXml[];
  eventos?: EventoApi[];
};

type Extras = {
  emitente: { razao_social: string; cnpj: string };
  serie: string;
  canceladas: string[];
  outras: Array<{ numero_nf: string; natureza: string }>;
  nfe_xml: NfeXml[];
  eventos: EventoApi[];
  contagens: { nfe: number; cancelamentos: number; cartas: number };
  /** Preenchido em `complementar`: números das NF-e cujo XML não está no ERP. */
  xml_ausentes?: string[];
  /** Verdadeiro quando não deu para conferir os arquivos (servidor sem acesso). */
  xml_nao_verificado?: boolean;
};

function frasesDeCriterio(extras: Extras) {
  const partes: string[] = [];
  if (extras.canceladas.length > 0) partes.push(`as notas canceladas (NF ${listaNf(extras.canceladas)})`);
  if (extras.outras.length > 0) {
    partes.push(
      `as de outra natureza (${extras.outras.map((o) => `NF ${o.numero_nf}: ${o.natureza}`).join("; ")})`
    );
  }
  return partes.length > 0
    ? `Ficam de fora desta lista ${partes.join(" e ")}.`
    : "Nenhuma nota cancelada ou de outra natureza no período.";
}

function frasesDeEventos(extras: Extras) {
  const cancelamentos = extras.eventos.filter((e) => e.tipo === "CANCELAMENTO").map((e) => e.numero_nf);
  const cartas = extras.eventos.filter((e) => e.tipo === "CARTA_CORRECAO").map((e) => e.numero_nf);
  if (cancelamentos.length === 0 && cartas.length === 0) return null;
  const itens: string[] = [];
  if (cancelamentos.length > 0) itens.push(`cancelamento (NF ${listaNf(cancelamentos)})`);
  if (cartas.length > 0) itens.push(`carta de correção (NF ${listaNf(cartas)})`);
  return `Os XML de ${itens.join(" e de ")} estão registrados, mas só existem no provedor fiscal: não estão guardados no ERP e não entram no zip.`;
}

function normalizar(resposta: unknown): ResultadoRelatorio {
  const r = (resposta ?? {}) as RespostaApi;
  const t = r.totais ?? {};
  const quantidade = n(t.quantidade);
  const produtos = n(t.produtos);
  const frete = n(t.frete);
  const total = n(t.total);

  const linhas: LinhaRelatorio[] = (r.notas ?? []).map((nota) => ({
    numero_nf: nota.numero_nf,
    data: nota.data,
    destinatario: nota.destinatario,
    cfop: nota.cfop ?? "",
    produtos: n(nota.produtos),
    frete: n(nota.frete),
    total: n(nota.total)
  }));

  const extras: Extras = {
    emitente: { razao_social: r.emitente?.razao_social ?? "", cnpj: r.emitente?.cnpj ?? "" },
    serie: r.filtros?.serie ?? "2",
    canceladas: (r.canceladas ?? []).map((c) => c.numero_nf),
    outras: r.outras ?? [],
    nfe_xml: r.nfe_xml ?? [],
    eventos: r.eventos ?? [],
    contagens: { nfe: n(t.nfe_no_periodo), cancelamentos: n(t.cancelamentos), cartas: n(t.cartas_correcao) }
  };

  const avisos = [frasesDeCriterio(extras)];
  const eventos = frasesDeEventos(extras);
  if (eventos) avisos.push(eventos);

  return {
    linhas,
    total: { destinatario: plural(quantidade, "nota", "notas"), produtos, frete, total },
    avisos,
    extras: extras as unknown as Record<string, unknown>,
    cards: [
      {
        titulo: "Notas na lista",
        valor: String(quantidade),
        descricao: "NF-e autorizadas de venda no período.",
        tom: "info"
      },
      {
        titulo: "Produtos",
        valor: formatCurrency(produtos),
        descricao: "Valor dos produtos, como na nota.",
        tom: "success"
      },
      {
        titulo: "Frete",
        valor: formatCurrency(frete),
        descricao: "Frete cobrado nas notas.",
        tom: "neutral"
      },
      {
        titulo: "Total das notas",
        valor: formatCurrency(total),
        descricao: "Valor total das notas (produtos mais frete).",
        tom: "success"
      }
    ]
  };
}

/** Confere, no bucket privado, quais XML de NF-e existem. Só lê. */
async function complementar(
  resultado: ResultadoRelatorio,
  servico: Parameters<NonNullable<RelatorioDef["complementar"]>>[1]
): Promise<ResultadoRelatorio> {
  const extras = resultado.extras as unknown as Extras;
  const total = extras.nfe_xml.length;
  const avisos = [...(resultado.avisos ?? [])];
  let disponiveis = 0;

  if (total === 0) {
    extras.xml_ausentes = [];
  } else if (!servico) {
    extras.xml_nao_verificado = true;
    avisos.push("Não foi possível conferir os XML das NF-e: o servidor não tem acesso aos arquivos.");
  } else {
    const caminhos = extras.nfe_xml.map((x) => `${x.ref}/nfe.xml`);
    const { data, error } = await servico.storage.from(BUCKET).createSignedUrls(caminhos, 60);
    if (error || !data) {
      extras.xml_nao_verificado = true;
      avisos.push("Não foi possível conferir os XML das NF-e (falha ao consultar os arquivos).");
    } else {
      const ausentes = extras.nfe_xml.filter((_, i) => !data[i] || data[i].error || !data[i].signedUrl);
      extras.xml_ausentes = ausentes.map((x) => x.numero_nf);
      disponiveis = total - ausentes.length;
      if (ausentes.length > 0) {
        avisos.push(`XML de NF-e que não estão no ERP e ficam fora do zip: NF ${listaNf(extras.xml_ausentes)}.`);
      }
    }
  }

  const xmlEventos = extras.eventos.length;
  return {
    ...resultado,
    avisos,
    extras: extras as unknown as Record<string, unknown>,
    cards: [
      ...resultado.cards,
      {
        titulo: "XML das NF-e",
        valor: extras.xml_nao_verificado ? "—" : `${disponiveis} de ${total}`,
        descricao:
          xmlEventos > 0
            ? `No zip. Cancelamento e carta de correção (${xmlEventos}) não estão guardados no ERP.`
            : "NF-e do período com XML guardado, prontas para o zip.",
        tom: extras.xml_ausentes && extras.xml_ausentes.length > 0 ? "warning" : "neutral"
      }
    ]
  };
}

async function baixarArquivos(
  caminhos: string[],
  servico: NonNullable<Parameters<NonNullable<RelatorioDef["complementar"]>>[1]>
) {
  const resultados: Array<Uint8Array | null> = new Array(caminhos.length).fill(null);
  const LOTE = 8;
  for (let i = 0; i < caminhos.length; i += LOTE) {
    await Promise.all(
      caminhos.slice(i, i + LOTE).map(async (caminho, k) => {
        const { data, error } = await servico.storage.from(BUCKET).download(caminho);
        if (!error && data) resultados[i + k] = new Uint8Array(await data.arrayBuffer());
      })
    );
  }
  return resultados;
}

async function montarZipDeXml(
  resultado: ResultadoRelatorio,
  servico: NonNullable<Parameters<NonNullable<RelatorioDef["complementar"]>>[1]>
): Promise<ArquivosDoZip> {
  const extras = resultado.extras as unknown as Extras;
  const conteudos = await baixarArquivos(
    extras.nfe_xml.map((x) => `${x.ref}/nfe.xml`),
    servico
  );

  const arquivos: ArquivosDoZip["arquivos"] = [];
  const ausentes: string[] = [];
  extras.nfe_xml.forEach((nota, i) => {
    const conteudo = conteudos[i];
    if (!conteudo) {
      ausentes.push(`NF-e ${nota.numero_nf}`);
      return;
    }
    const chave = String(nota.chave ?? "").replace(/^NFe/i, "");
    arquivos.push({ nome: chave ? `${chave}-nfe.xml` : `NF-e-${nota.numero_nf}.xml`, conteudo });
  });

  // Eventos: só o registro existe no ERP; o XML está no provedor fiscal.
  for (const e of extras.eventos) {
    ausentes.push(
      e.tipo === "CANCELAMENTO" ? `Cancelamento da NF ${e.numero_nf}` : `Carta de correção ${e.sequencia ?? ""} da NF ${e.numero_nf}`.replace("  ", " ")
    );
  }

  const linhas = [
    `Relação de XML — notas fiscais (NF-e) — Série ${extras.serie}`,
    `Emitente: ${extras.emitente.razao_social} — CNPJ ${formatarCnpj(extras.emitente.cnpj)}`,
    "",
    `NF-e neste arquivo: ${arquivos.length} de ${extras.nfe_xml.length}`,
    `Cancelamentos registrados no período: ${extras.contagens.cancelamentos}`,
    `Cartas de correção registradas no período: ${extras.contagens.cartas}`,
    "",
    ausentes.length === 0
      ? "Todos os arquivos estão neste zip."
      : "Não estão neste zip (não guardados no ERP; só o provedor fiscal os tem):",
    ...ausentes.map((a) => `  - ${a}`)
  ];
  arquivos.push({ nome: "LEIAME.txt", conteudo: new TextEncoder().encode(linhas.join("\r\n") + "\r\n") });

  return { arquivos, ausentes };
}

const COLUNAS_PDF: ColunaPdf[] = [
  { titulo: "NF", largura: 8 },
  { titulo: "Data", largura: 10 },
  { titulo: "Destinatário", largura: 34 },
  { titulo: "CFOP", largura: 9 },
  { titulo: "Produtos (R$)", largura: 13, alinhamento: "right" },
  { titulo: "Frete (R$)", largura: 12, alinhamento: "right" },
  { titulo: "Total (R$)", largura: 13, alinhamento: "right" }
];

function montarPdf(
  resultado: ResultadoRelatorio,
  contexto: Parameters<NonNullable<RelatorioDef["pdf"]>["montar"]>[1]
): ModeloPdf {
  const extras = resultado.extras as unknown as Extras;
  const { consulta } = contexto;
  const periodo = rotuloDoPeriodo(consulta);
  const serie = extras.serie;
  const quantidade = resultado.linhas.length;
  const t = resultado.total as { produtos: number; frete: number; total: number };

  const notas: string[] = [
    `Fonte: ERP Vibe, notas fiscais eletrônicas (${plural(extras.contagens.nfe, "NF-e", "NF-e")}, ${plural(extras.contagens.cancelamentos, "cancelamento", "cancelamentos")}, ${plural(extras.contagens.cartas, "carta de correção", "cartas de correção")}). A lista traz ${plural(quantidade, "nota", "notas")}; a diferença para o total de NF-e são as notas citadas no critério acima. Gerado em ${contexto.geradoEm.split(",")[0]}.`
  ];
  const eventos = frasesDeEventos(extras);
  if (eventos) notas.push(`Atenção: ${eventos}`);
  if (extras.xml_ausentes && extras.xml_ausentes.length > 0) {
    notas.push(`Atenção: XML de NF-e que não estão no ERP e ficam fora do zip: NF ${listaNf(extras.xml_ausentes)}.`);
  }
  if (extras.xml_nao_verificado) {
    notas.push("Atenção: não foi possível conferir se os XML das NF-e estão guardados.");
  }

  return {
    titulo: `Relação das notas de venda — ${periodo.texto} (Série ${serie})`,
    empresa: `${extras.emitente.razao_social} — CNPJ ${formatarCnpj(extras.emitente.cnpj)}`,
    periodo: `Emissão de ${formatDataCivil(consulta.inicio)} a ${formatDataCivil(consulta.fim)}`,
    filtros: [`Série ${serie}`],
    criterio: `NF-e autorizadas de natureza "${NATUREZA_VENDA}", pela data de emissão (dia de São Paulo). Produtos, frete e total como constam em cada nota. ${frasesDeCriterio(extras)}`,
    secoes: [
      {
        titulo: `Notas de venda — ${plural(quantidade, "nota", "notas")}`,
        colunas: COLUNAS_PDF,
        linhas: resultado.linhas.map((l) => [
          String(l.numero_nf),
          formatDataCivil(String(l.data)),
          String(l.destinatario || "—"),
          String(l.cfop || "—"),
          numero.format(Number(l.produtos)),
          numero.format(Number(l.frete)),
          numero.format(Number(l.total))
        ]),
        linhaTotal: [
          "",
          "",
          `Total ${plural(quantidade, "nota", "notas")}`,
          "",
          numero.format(t.produtos),
          numero.format(t.frete),
          numero.format(t.total)
        ]
      }
    ],
    resumo: [],
    notas,
    geradoEm: contexto.geradoEm,
    geradoPor: contexto.geradoPor
  };
}

export const notasFiscais: RelatorioDef = {
  slug: "notas-fiscais",
  area: "financeiro",
  titulo: "Notas fiscais (NF-e)",
  descricao:
    "Relação das NF-e de venda emitidas no mês, por empresa emitente e série, para a contabilidade. Tem PDF para baixar e imprimir e o zip com os XML.",
  permissao: "relatorios.notas_fiscais",

  dataReferencia: {
    rotulo: "Data de emissão",
    criterio:
      "Conta o dia em que a NF-e foi emitida (dia de São Paulo), de uma empresa emitente e uma série por vez. A lista traz só as notas autorizadas de venda; canceladas e de outra natureza ficam fora e são citadas abaixo. Produtos, frete e total são os da própria nota. Só NF-e (mercadoria): NFS-e não entra. Período máximo de 31 dias."
  },

  periodo: { presets: ["mes_anterior", "mes", "custom"], padrao: "mes_anterior", maxDias: 31 },

  filtros: [
    // Emitente é obrigatório: o valor em branco da URL vale Ideal Gráfica (id 1), por isso a
    // primeira opção da lista é rotulada com o nome dela e as outras empresas vêm como opções.
    {
      chave: "empresa",
      rotulo: "Empresa emitente",
      todasRotulo: OPCOES_EMPRESA[0].rotulo,
      opcoes: OPCOES_EMPRESA.slice(1)
    },
    // Idem para a série: em branco vale a Série 2, a de produção.
    {
      chave: "serie",
      rotulo: "Série",
      todasRotulo: "Série 2",
      opcoes: [{ valor: "1", rotulo: "Série 1" }]
    }
  ],

  colunas: [
    { id: "numero_nf", titulo: "NF", tipo: "inteiro", alinhamento: "left" },
    { id: "data", titulo: "Data", tipo: "data", alinhamento: "left" },
    { id: "destinatario", titulo: "Destinatário", tipo: "texto" },
    { id: "cfop", titulo: "CFOP", tipo: "texto" },
    { id: "produtos", titulo: "Produtos (R$)", tipo: "moeda" },
    { id: "frete", titulo: "Frete (R$)", tipo: "moeda" },
    { id: "total", titulo: "Total (R$)", tipo: "moeda" }
  ],
  ordenacaoPadrao: { coluna: "data", direcao: "asc" },

  rpc: {
    nome: "rpc_relatorio_notas_fiscais",
    argumentos: ({ inicio, fim, filtros }) => ({
      p_data_inicio: inicio,
      p_data_fim: fim,
      p_id_empresa: Number(filtros.empresa || 1),
      p_serie: filtros.serie || "2"
    })
  },
  normalizar,
  complementar,

  pdf: {
    nomeArquivo: (consulta) => {
      const p = rotuloDoPeriodo(consulta);
      const base = p.mesInteiro ? `${p.aaaa}-${p.mm}` : `${consulta.inicio}_a_${consulta.fim}`;
      return `relacao-notas-venda_${base}_serie_${serieDe(consulta)}.pdf`;
    },
    montar: montarPdf
  },

  zip: {
    rotulo: "Baixar XML (zip)",
    nomeArquivo: (consulta) => {
      const p = rotuloDoPeriodo(consulta);
      const base = p.mesInteiro ? `${p.mm}-${p.aaaa}` : `${consulta.inicio}_a_${consulta.fim}`;
      return `${base}_serie_${serieDe(consulta)}_XMLs.zip`;
    },
    montar: montarZipDeXml
  }
};
