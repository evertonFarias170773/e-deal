import { addDays } from "@/lib/period";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDataCivil } from "@/lib/formatters/date";
import type { ColunaPdf, LinhaRelatorio, ModeloPdf, RelatorioDef, ResultadoRelatorio } from "../types";

/**
 * Fretes despachados (lista) — uma linha por despacho do período, sem agrupar.
 *
 * Fontes (só leitura, com a sessão do usuário, lidas na rota):
 * - `expedicoes`: data_despacho, tipo_frete, conhecimento e endereço do despacho. Tem uma linha
 *   por pedido (`id_int` único); o reenvio sobrescreve a mesma linha e guarda o envio anterior em
 *   `expedicao_reenvios`, que este relatório não lê. Então um pedido aparece uma vez só, com o
 *   despacho que vale hoje.
 * - `propostas.valor_frete`: o frete cobrado do cliente, sem recalcular — o mesmo valor do
 *   relatório "Frete cobrado por transportadora".
 * - `enderecos` (cidade, uf): o endereço gravado no despacho (`expedicoes.id_endereco_entrega`);
 *   na falta, o da proposta (`propostas.id_endereco_ent`). É a precedência de
 *   `features/expedicao/lib/endereco-entrega.ts` para despacho confirmado.
 *
 * CONHECIMENTO: `expedicoes.codigo_rastreamento` (decisão de 15/10/2026, sem coluna própria). Para
 * TRANSPORTADORA e MOTOBOY é o conhecimento digitado; para CORREIOS é o código de rastreio do
 * objeto. Vazio ali, cai em `expedicoes.correios_codigo_objeto` (o objeto da prepostagem).
 *
 * Sem função no banco: a lista sai ordenada da consulta e a soma é feita na rota, no servidor.
 * A tela recebe uma página por vez (`paginacao`); CSV e PDF levam o período inteiro.
 */

const TAMANHO_PAGINA = 1000;
const MAX_PAGINAS = 10;
const LOTE = 200;

type Despacho = {
  id_int: number;
  tipo_frete: string | null;
  data_despacho: string;
  codigo_rastreamento: string | null;
  correios_codigo_objeto: string | null;
  id_endereco_entrega: string | null;
};

type Proposta = { valor_frete: number | null; id_endereco_ent: string | null };
type Endereco = { cidade: string | null; uf: string | null };

type Dados = {
  despachos: Despacho[];
  propostas: Record<string, Proposta>;
  enderecos: Record<string, Endereco>;
};

const TIPOS_FRETE = ["CORREIOS", "MOTOBOY", "TRANSPORTADORA", "RETIRA_BALCAO", "SEM_CUSTO", "INDEFINIDO"] as const;

const plural = (q: number, um: string, varios: string) => `${q.toLocaleString("pt-BR")} ${q === 1 ? um : varios}`;
const arred = (n: number) => Math.round(n * 100) / 100;
const limpo = (v: string | null | undefined) => String(v ?? "").trim();

/** Dia civil de São Paulo (UTC-3, sem horário de verão) de um timestamptz. */
function diaDeSaoPaulo(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Conhecimento do despacho: o campo da expedição; vazio, o objeto da prepostagem dos Correios. */
export function conhecimentoDoDespacho(d: Pick<Despacho, "codigo_rastreamento" | "correios_codigo_objeto">): string {
  return limpo(d.codigo_rastreamento) || limpo(d.correios_codigo_objeto);
}

async function consultar(
  supabase: Parameters<NonNullable<RelatorioDef["consultar"]>>[0],
  { inicio, fim, filtros }: Parameters<NonNullable<RelatorioDef["consultar"]>>[1]
) {
  const de = `${inicio}T00:00:00-03:00`;
  const ate = `${addDays(fim, 1)}T00:00:00-03:00`;

  const despachos: Despacho[] = [];
  for (let pagina = 0; ; pagina++) {
    if (pagina >= MAX_PAGINAS) {
      return { data: null, error: { code: "LIMITE", message: "Muitos despachos no período." } };
    }
    let consulta = supabase
      .from("expedicoes")
      .select("id_int,tipo_frete,data_despacho,codigo_rastreamento,correios_codigo_objeto,id_endereco_entrega")
      .not("data_despacho", "is", null)
      .gte("data_despacho", de)
      .lt("data_despacho", ate);
    if (filtros.tipo_frete === "SEM") consulta = consulta.is("tipo_frete", null);
    else if (filtros.tipo_frete) consulta = consulta.eq("tipo_frete", filtros.tipo_frete);

    const { data, error } = await consulta
      .order("data_despacho", { ascending: true })
      .order("id_int", { ascending: true })
      .range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1);
    if (error) return { data: null, error };
    despachos.push(...((data ?? []) as Despacho[]));
    if ((data ?? []).length < TAMANHO_PAGINA) break;
  }

  const ids = [...new Set(despachos.map((d) => d.id_int))];
  const propostas: Record<string, Proposta> = {};
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await supabase
      .from("propostas")
      .select("id_int,valor_frete,id_endereco_ent")
      .in("id_int", ids.slice(i, i + LOTE));
    if (error) return { data: null, error };
    for (const p of (data ?? []) as Array<{ id_int: number; valor_frete: number | string | null; id_endereco_ent: string | null }>) {
      propostas[String(p.id_int)] = {
        valor_frete: p.valor_frete === null ? null : Number(p.valor_frete),
        id_endereco_ent: p.id_endereco_ent
      };
    }
  }

  const idsEndereco = [
    ...new Set(
      despachos
        .map((d) => limpo(d.id_endereco_entrega) || limpo(propostas[String(d.id_int)]?.id_endereco_ent))
        .filter(Boolean)
    )
  ];
  const enderecos: Record<string, Endereco> = {};
  for (let i = 0; i < idsEndereco.length; i += LOTE) {
    const { data, error } = await supabase.from("enderecos").select("id,cidade,uf").in("id", idsEndereco.slice(i, i + LOTE));
    if (error) return { data: null, error };
    for (const e of (data ?? []) as Array<{ id: string; cidade: string | null; uf: string | null }>) {
      enderecos[String(e.id)] = { cidade: e.cidade, uf: e.uf };
    }
  }

  return { data: { despachos, propostas, enderecos } satisfies Dados, error: null };
}

function normalizar(resposta: unknown): ResultadoRelatorio {
  const { despachos = [], propostas = {}, enderecos = {} } = (resposta ?? {}) as Partial<Dados>;

  let totalFrete = 0;
  let freteZero = 0;
  let comConhecimento = 0;
  let semCidade = 0;
  const transportadoraSemConhecimento: number[] = [];

  // A consulta já vem por data de despacho e id_int; reordena pelo DIA de São Paulo para o
  // empate do mesmo dia seguir o id_int, como pedido.
  const linhas: LinhaRelatorio[] = despachos
    .map((d) => {
      const proposta = propostas[String(d.id_int)];
      const idEndereco = limpo(d.id_endereco_entrega) || limpo(proposta?.id_endereco_ent);
      const endereco = idEndereco ? enderecos[idEndereco] : undefined;
      const cidade = limpo(endereco?.cidade);
      const uf = limpo(endereco?.uf);
      const conhecimento = conhecimentoDoDespacho(d);
      const frete = arred(Number(proposta?.valor_frete ?? 0));

      totalFrete += frete;
      if (frete <= 0) freteZero += 1;
      if (conhecimento) comConhecimento += 1;
      else if (d.tipo_frete === "TRANSPORTADORA" || d.tipo_frete === "MOTOBOY") transportadoraSemConhecimento.push(d.id_int);
      if (!cidade) semCidade += 1;

      return {
        id_int: d.id_int,
        tipo_frete: limpo(d.tipo_frete) || "(sem tipo)",
        data_despacho: diaDeSaoPaulo(d.data_despacho),
        cidade_destino: cidade ? (uf ? `${cidade}/${uf}` : cidade) : null,
        conhecimento: conhecimento || null,
        valor_frete: frete
      };
    })
    .sort(
      (a, b) =>
        String(a.data_despacho).localeCompare(String(b.data_despacho)) || Number(a.id_int) - Number(b.id_int)
    );

  totalFrete = arred(totalFrete);
  const registros = linhas.length;

  const avisos: string[] = [];
  if (transportadoraSemConhecimento.length > 0) {
    avisos.push(
      `Despachos de transportadora ou motoboy sem conhecimento gravado: ${transportadoraSemConhecimento.length}.`
    );
  }
  if (semCidade > 0) avisos.push(`Despachos sem cidade de destino no endereço: ${semCidade}.`);

  return {
    linhas,
    total: {
      id_int: plural(registros, "registro", "registros"),
      valor_frete: totalFrete
    },
    avisos,
    cards: [
      { titulo: "Despachos", valor: registros.toLocaleString("pt-BR"), descricao: "Uma linha por despacho do período.", tom: "info" },
      { titulo: "Frete cobrado", valor: formatCurrency(totalFrete), descricao: "Soma do frete das propostas despachadas.", tom: "success" },
      { titulo: "Com frete zero", valor: freteZero.toLocaleString("pt-BR"), descricao: "Retira, FOB e CIF sem frete cobrado.", tom: "warning" },
      {
        titulo: "Com conhecimento",
        valor: comConhecimento.toLocaleString("pt-BR"),
        descricao: "Com código gravado no despacho (nos Correios, o rastreio).",
        tom: "neutral"
      }
    ]
  };
}

const COLUNAS_PDF: ColunaPdf[] = [
  { titulo: "ID_INT", largura: 10 },
  { titulo: "Tipo frete", largura: 16 },
  { titulo: "Data despacho", largura: 13 },
  { titulo: "Cidade destino", largura: 27 },
  { titulo: "Conhecimento do frete", largura: 20 },
  { titulo: "Valor do frete", largura: 14, alinhamento: "right" }
];

function montarPdf(
  resultado: ResultadoRelatorio,
  contexto: Parameters<NonNullable<RelatorioDef["pdf"]>["montar"]>[1]
): ModeloPdf {
  const { inicio, fim } = contexto.consulta;
  return {
    titulo: "Fretes despachados (lista)",
    empresa: "Todas as empresas",
    periodo: `Despacho de ${formatDataCivil(inicio)} a ${formatDataCivil(fim)}`,
    filtros: contexto.filtros,
    criterio: CRITERIO,
    secoes: [
      {
        titulo: `Despachos — ${plural(resultado.linhas.length, "registro", "registros")}`,
        colunas: COLUNAS_PDF,
        linhas: resultado.linhas.map((l) => [
          String(l.id_int),
          String(l.tipo_frete),
          l.data_despacho ? formatDataCivil(String(l.data_despacho)) : "—",
          l.cidade_destino ? String(l.cidade_destino) : "—",
          l.conhecimento ? String(l.conhecimento) : "—",
          formatCurrency(Number(l.valor_frete))
        ]),
        linhaTotal: [
          "Total",
          String(resultado.total.id_int),
          "",
          "",
          "",
          formatCurrency(Number(resultado.total.valor_frete))
        ]
      }
    ],
    resumo: [],
    notas: resultado.avisos,
    geradoEm: contexto.geradoEm,
    geradoPor: contexto.geradoPor
  };
}

const CRITERIO =
  "Uma linha por despacho com data no período (dia de São Paulo), em ordem de data de despacho e ID_INT. Tipo de frete, conhecimento e cidade são os do despacho (a cidade cai no endereço da proposta só quando o despacho não gravou endereço). Nos Correios, o conhecimento é o código de rastreio do objeto. O valor é o frete gravado na proposta (o cobrado do cliente), sem recalcular, o mesmo do relatório Frete cobrado por transportadora. Retira e FOB entram com o frete que a proposta tiver, normalmente zero. Pedido reenviado aparece uma vez, com o despacho atual.";

export const fretesDespachadosLista: RelatorioDef = {
  slug: "fretes-despachados-lista",
  area: "expedicao",
  titulo: "Fretes despachados (lista)",
  descricao: "Lista completa dos despachos do período, um por linha, com tipo de frete, cidade, conhecimento e frete cobrado.",
  permissao: "relatorios.fretes_despachados_lista",

  dataReferencia: { rotulo: "Data de despacho", criterio: CRITERIO },

  periodo: { presets: ["mes", "mes_anterior", "custom"], padrao: "mes", maxDias: 366 },

  filtros: [
    {
      chave: "tipo_frete",
      rotulo: "Tipo de frete",
      todasRotulo: "Todos",
      opcoes: [...TIPOS_FRETE.map((t) => ({ valor: t, rotulo: t })), { valor: "SEM", rotulo: "Sem tipo" }]
    }
  ],

  colunas: [
    { id: "id_int", titulo: "ID_INT", tipo: "texto" },
    { id: "tipo_frete", titulo: "Tipo frete", tipo: "texto" },
    { id: "data_despacho", titulo: "Data despacho", tipo: "data" },
    { id: "cidade_destino", titulo: "Cidade destino", tipo: "texto" },
    { id: "conhecimento", titulo: "Conhecimento do frete", tipo: "texto" },
    { id: "valor_frete", titulo: "Valor do frete", tipo: "moeda" }
  ],
  ordenacaoPadrao: { coluna: "data_despacho", direcao: "asc" },

  paginacao: { tamanho: 100 },

  consultar,
  normalizar,

  pdf: {
    nomeArquivo: ({ inicio, fim }) => `fretes-despachados_${inicio}_a_${fim}.pdf`,
    montar: montarPdf
  }
};
