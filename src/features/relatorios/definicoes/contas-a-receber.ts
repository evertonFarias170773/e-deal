import { formatCurrency } from "@/lib/formatters/currency";
import { formatDataCivil } from "@/lib/formatters/date";
import { OPCOES_EMPRESA } from "../lib/opcoes";
import type { ColunaPdf, LinhaRelatorio, ModeloPdf, RelatorioDef, ResultadoRelatorio, Subtotal } from "../types";

/**
 * Contas a receber — títulos vencidos e a vencer, pelo VENCIMENTO, para cobrar e conferir.
 *
 * Dados: `rpc_relatorio_contas_a_receber` (agrega no banco; devolve linhas, subtotais por meio
 * e por empresa, e os totais de vencidas e a vencer). A fonte e as regras são as da Carteira
 * (tabela `boletos`; só VENCIDO e A_VENCER; valor atualizado). A função confere a permissão
 * `relatorios.contas_a_receber` e recusa períodos com mais de 5.000 títulos.
 */

const ROTULO_MEIO: Record<string, string> = { BOLETO: "Boleto", DEPOSITO: "Depósito em conta" };
const ROTULO_SITUACAO: Record<string, string> = { VENCIDA: "Vencida", A_VENCER: "A vencer" };

const rotuloMeio = (m: string) => ROTULO_MEIO[m] ?? m;
const rotuloEmpresa = (id: number | null) =>
  OPCOES_EMPRESA.find((o) => o.valor === String(id))?.rotulo ?? (id === null ? "Sem empresa" : `Empresa ${id}`);

type LinhaApi = {
  id: string;
  vencimento: string;
  pedido: number | null;
  cliente: string;
  meio: string;
  situacao: string;
  id_empresa: number | null;
  valor: number | string;
  dias_atraso: number | null;
};

type RespostaApi = {
  totais?: {
    quantidade?: number;
    total?: number | string;
    quantidade_vencidas?: number;
    total_vencidas?: number | string;
    quantidade_a_vencer?: number;
    total_a_vencer?: number | string;
  };
  por_meio?: Array<{
    meio: string;
    quantidade: number;
    total: number | string;
    qtd_vencidas: number;
    total_vencidas: number | string;
    qtd_a_vencer: number;
    total_a_vencer: number | string;
  }>;
  por_empresa?: Array<{
    id_empresa: number | null;
    quantidade: number;
    total: number | string;
    total_vencidas: number | string;
    total_a_vencer: number | string;
  }>;
  linhas?: LinhaApi[];
};

const n = (v: number | string | null | undefined) => Number(v ?? 0);
const plural = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;
const titulos = (q: number) => plural(q, "título", "títulos");

/** Texto curto da divisão vencidas / a vencer, usado nas notas e no PDF. */
const divisao = (qv: number, tv: number, qa: number, ta: number) =>
  `vencidas ${formatCurrency(tv)} (${qv}) · a vencer ${formatCurrency(ta)} (${qa})`;

function normalizar(resposta: unknown): ResultadoRelatorio {
  const r = (resposta ?? {}) as RespostaApi;
  const t = r.totais ?? {};
  const quantidade = n(t.quantidade);
  const total = n(t.total);
  const totalVencidas = n(t.total_vencidas);
  const totalAVencer = n(t.total_a_vencer);

  const linhas: LinhaRelatorio[] = (r.linhas ?? []).map((l) => ({
    id: l.id,
    vencimento: l.vencimento,
    pedido: l.pedido,
    cliente: l.cliente,
    empresa: rotuloEmpresa(l.id_empresa),
    meio: l.meio,
    meio_rotulo: rotuloMeio(l.meio),
    situacao: ROTULO_SITUACAO[l.situacao] ?? l.situacao,
    valor: n(l.valor),
    dias_atraso: l.dias_atraso
  }));

  const subtotais: Subtotal[] = [
    ...(r.por_meio ?? []).map((m) => ({
      grupo: "forma" as const,
      chave: m.meio,
      rotulo: rotuloMeio(m.meio),
      quantidade: n(m.quantidade),
      valor: n(m.total),
      nota: divisao(n(m.qtd_vencidas), n(m.total_vencidas), n(m.qtd_a_vencer), n(m.total_a_vencer))
    })),
    ...(r.por_empresa ?? []).map((e) => ({
      grupo: "empresa" as const,
      chave: String(e.id_empresa),
      rotulo: rotuloEmpresa(e.id_empresa),
      quantidade: n(e.quantidade),
      valor: n(e.total),
      nota: `vencidas ${formatCurrency(n(e.total_vencidas))} · a vencer ${formatCurrency(n(e.total_a_vencer))}`
    })),
    {
      grupo: "total",
      chave: "TOTAL_VENCIDAS",
      rotulo: "Total vencidas",
      quantidade: n(t.quantidade_vencidas),
      valor: totalVencidas,
      nota: "Já passaram do vencimento"
    },
    {
      grupo: "total",
      chave: "TOTAL_A_VENCER",
      rotulo: "Total a vencer",
      quantidade: n(t.quantidade_a_vencer),
      valor: totalAVencer,
      nota: "Vencem hoje ou depois"
    },
    { grupo: "total", chave: "TOTAL", rotulo: "Total geral", quantidade, valor: total }
  ];

  return {
    linhas,
    total: { cliente: titulos(quantidade), valor: total },
    subtotais,
    cards: [
      {
        titulo: "Vencidas",
        valor: formatCurrency(totalVencidas),
        descricao: `${titulos(n(t.quantidade_vencidas))} já vencidos, com multa e juros quando houver.`,
        tom: "danger"
      },
      {
        titulo: "A vencer",
        valor: formatCurrency(totalAVencer),
        descricao: `${titulos(n(t.quantidade_a_vencer))} que vencem hoje ou depois.`,
        tom: "info"
      },
      {
        titulo: "Total a receber",
        valor: formatCurrency(total),
        descricao: "Vencidas mais a vencer no período.",
        tom: "success"
      },
      {
        titulo: "Títulos",
        valor: String(quantidade),
        descricao: "Títulos em aberto listados.",
        tom: "neutral"
      }
    ]
  };
}

const COLUNAS_PDF: ColunaPdf[] = [
  { titulo: "Vencimento", largura: 12 },
  { titulo: "Pedido", largura: 8 },
  { titulo: "Cliente", largura: 36 },
  { titulo: "Meio", largura: 16 },
  { titulo: "Valor", largura: 14, alinhamento: "right" },
  { titulo: "Dias de atraso", largura: 14, alinhamento: "right" }
];

function montarPdf(
  resultado: ResultadoRelatorio,
  contexto: Parameters<NonNullable<RelatorioDef["pdf"]>["montar"]>[1]
): ModeloPdf {
  const subtotais = resultado.subtotais ?? [];
  const porMeio = subtotais.filter((s) => s.grupo === "forma");

  const secoes = porMeio.map((meio) => {
    const linhas = resultado.linhas.filter((l) => l.meio === meio.chave);
    return {
      titulo: `${meio.rotulo} — ${titulos(meio.quantidade)}`,
      nota: meio.nota,
      colunas: COLUNAS_PDF,
      linhas: linhas.map((l) => [
        formatDataCivil(String(l.vencimento)),
        l.pedido === null ? "—" : String(l.pedido),
        String(l.cliente || "—"),
        String(l.meio_rotulo),
        formatCurrency(Number(l.valor)),
        l.dias_atraso === null ? "" : String(l.dias_atraso)
      ]),
      subtotal: { rotulo: `Subtotal ${meio.rotulo}`, valor: formatCurrency(meio.valor) }
    };
  });

  const resumo = [
    ...porMeio.map((s) => ({
      rotulo: `${s.rotulo} — ${titulos(s.quantidade)} (${s.nota})`,
      valor: formatCurrency(s.valor)
    })),
    ...subtotais
      .filter((s) => s.grupo === "empresa")
      .map((s) => ({
        rotulo: `Empresa: ${s.rotulo} — ${titulos(s.quantidade)} (${s.nota})`,
        valor: formatCurrency(s.valor)
      })),
    ...subtotais
      .filter((s) => s.grupo === "total")
      .map((s) => ({
        rotulo: `${s.rotulo} — ${titulos(s.quantidade)}`,
        valor: formatCurrency(s.valor),
        destaque: s.chave === "TOTAL"
      }))
  ];

  const { inicio, fim } = contexto.consulta;
  return {
    titulo: "Contas a receber",
    empresa: contexto.empresa,
    periodo: `Vencimento de ${formatDataCivil(inicio)} a ${formatDataCivil(fim)}`,
    filtros: contexto.filtros.filter((f) => !f.startsWith("Empresa:")),
    criterio:
      "Títulos em aberto pelo vencimento, como na Carteira: entram os vencidos e os a vencer; pagos e cancelados não entram, nem os títulos ainda não emitidos (status A receber). O valor é o atualizado, com multa e juros dos vencidos. Dias de atraso em branco: ainda não venceu. Vendas de teste ficam de fora.",
    secoes,
    resumo,
    geradoEm: contexto.geradoEm,
    geradoPor: contexto.geradoPor
  };
}

export const contasAReceber: RelatorioDef = {
  slug: "contas-a-receber",
  area: "financeiro",
  titulo: "Contas a receber",
  descricao:
    "Títulos vencidos e a vencer no período de vencimento, por empresa e meio de pagamento. Tem PDF para baixar e imprimir.",
  permissao: "relatorios.contas_a_receber",

  dataReferencia: {
    rotulo: "Vencimento",
    criterio:
      "Conta a data de vencimento do título. Entram os vencidos e os a vencer, pela mesma regra da Carteira: pagos e cancelados ficam de fora, e os títulos ainda não emitidos (status A receber) também. O valor é o atualizado (multa e juros dos vencidos). Os cartões da Carteira somam a carteira inteira, sem recorte de data: para igualar, escolha um período que cubra todos os vencimentos. Vendas de teste ficam de fora, e a Carteira ainda as mostra."
  },

  periodo: {
    presets: ["hoje", "mes_completo", "proximo_mes", "mes_anterior", "custom"],
    padrao: "mes_completo",
    maxDias: 366
  },

  filtros: [
    { chave: "empresa", rotulo: "Empresa", todasRotulo: "Todas as empresas", opcoes: OPCOES_EMPRESA },
    {
      chave: "meio",
      rotulo: "Meio de pagamento",
      todasRotulo: "Todos os meios",
      opcoes: [
        { valor: "BOLETO", rotulo: "Boleto" },
        { valor: "DEPOSITO", rotulo: "Depósito em conta" }
      ]
    }
  ],

  colunas: [
    { id: "vencimento", titulo: "Vencimento", tipo: "data", alinhamento: "left" },
    { id: "pedido", titulo: "Pedido", tipo: "inteiro", alinhamento: "left" },
    { id: "cliente", titulo: "Cliente", tipo: "texto" },
    { id: "empresa", titulo: "Empresa", tipo: "texto" },
    { id: "meio_rotulo", titulo: "Meio", tipo: "texto" },
    { id: "situacao", titulo: "Situação", tipo: "texto" },
    { id: "valor", titulo: "Valor", tipo: "moeda" },
    { id: "dias_atraso", titulo: "Dias de atraso", tipo: "inteiro" }
  ],
  ordenacaoPadrao: { coluna: "vencimento", direcao: "asc" },

  rpc: {
    nome: "rpc_relatorio_contas_a_receber",
    argumentos: ({ inicio, fim, filtros }) => ({
      p_data_inicio: inicio,
      p_data_fim: fim,
      p_empresas: filtros.empresa ? [Number(filtros.empresa)] : null,
      p_meios: filtros.meio ? [filtros.meio] : null
    })
  },
  normalizar,

  pdf: {
    nomeArquivo: ({ inicio, fim }) => `contas-a-receber_${inicio}_a_${fim}.pdf`,
    montar: montarPdf
  }
};
