import { formatCurrency } from "@/lib/formatters/currency";
import { formatDataCivil } from "@/lib/formatters/date";
import { OPCOES_EMPRESA } from "../lib/opcoes";
import type { ColunaPdf, LinhaRelatorio, ModeloPdf, RelatorioDef, ResultadoRelatorio, Subtotal } from "../types";

/**
 * Conferência de pagamentos — dinheiro que entrou no período, para conferir com o extrato.
 *
 * Dados: `rpc_relatorio_conferencia_pagamentos` (agrega no banco; devolve linhas, subtotais por
 * forma e por empresa e os totais). Data do pagamento (`paid_at`), só PAID, sem vendas de teste.
 * A função confere a permissão `relatorios.conferencia_pagamentos` e recusa períodos com mais de
 * 5.000 pagamentos (o PDF e a tela não aguentam mais que isso com conforto).
 *
 * "Passa pelo banco" = PIX, boleto e cartão (decisão de 25/10/2026). Faturado, crédito do
 * cliente, amostra, retrabalho e permuta ficam em "sem movimento no banco". A marcação vem do
 * banco (campo `banco` de cada forma), então a tela e o PDF só repetem o que a função devolve.
 */

const ROTULO_FORMA: Record<string, string> = {
  PIX: "PIX",
  BOLETO: "Boleto",
  CREDIT_CARD: "Cartão de crédito",
  CARD_PARCELADO: "Cartão parcelado",
  "E-FATURADO": "Faturado",
  "E-CREDITO": "Crédito do cliente",
  "E-AMOSTRA": "Amostra",
  "E-RETRABALHO": "Retrabalho",
  "E-PERMUTA": "Permuta",
  "SEM FORMA": "Sem forma"
};
const NOTA_SEM_BANCO = "Não passa pelo banco";

const rotuloForma = (f: string) => ROTULO_FORMA[f] ?? f;
const rotuloEmpresa = (id: number | null) =>
  OPCOES_EMPRESA.find((o) => o.valor === String(id))?.rotulo ?? (id === null ? "Sem empresa" : `Empresa ${id}`);

type LinhaApi = {
  id: string;
  data: string;
  hora: string;
  pedido: number | null;
  cliente: string;
  forma: string;
  banco: boolean;
  id_empresa: number | null;
  valor: number | string;
};

type RespostaApi = {
  totais?: {
    quantidade?: number;
    total?: number | string;
    quantidade_banco?: number;
    total_banco?: number | string;
    quantidade_sem_banco?: number;
    total_sem_banco?: number | string;
  };
  por_forma?: Array<{ forma: string; banco: boolean; quantidade: number; total: number | string }>;
  por_empresa?: Array<{ id_empresa: number | null; quantidade: number; total: number | string }>;
  linhas?: LinhaApi[];
};

const n = (v: number | string | null | undefined) => Number(v ?? 0);
const plural = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;

function normalizar(resposta: unknown): ResultadoRelatorio {
  const r = (resposta ?? {}) as RespostaApi;
  const t = r.totais ?? {};
  const quantidade = n(t.quantidade);
  const total = n(t.total);
  const totalBanco = n(t.total_banco);
  const totalSemBanco = n(t.total_sem_banco);

  const linhas: LinhaRelatorio[] = (r.linhas ?? []).map((l) => ({
    id: l.id,
    data: l.data,
    hora: l.hora,
    pedido: l.pedido,
    cliente: l.cliente,
    empresa: rotuloEmpresa(l.id_empresa),
    forma: l.forma,
    forma_rotulo: rotuloForma(l.forma),
    banco: l.banco ? "Sim" : "Não",
    valor: n(l.valor)
  }));

  const subtotais: Subtotal[] = [
    ...(r.por_forma ?? []).map((f) => ({
      grupo: "forma" as const,
      chave: f.forma,
      rotulo: rotuloForma(f.forma),
      quantidade: n(f.quantidade),
      valor: n(f.total),
      nota: f.banco ? undefined : NOTA_SEM_BANCO
    })),
    ...(r.por_empresa ?? []).map((e) => ({
      grupo: "empresa" as const,
      chave: String(e.id_empresa),
      rotulo: rotuloEmpresa(e.id_empresa),
      quantidade: n(e.quantidade),
      valor: n(e.total)
    })),
    {
      grupo: "total",
      chave: "TOTAL_BANCO",
      rotulo: "Total que passa pelo banco",
      quantidade: n(t.quantidade_banco),
      valor: totalBanco,
      nota: "PIX, boleto e cartão"
    },
    {
      grupo: "total",
      chave: "TOTAL_SEM_BANCO",
      rotulo: "Total sem movimento no banco",
      quantidade: n(t.quantidade_sem_banco),
      valor: totalSemBanco,
      nota: "Faturado, crédito do cliente, amostra, retrabalho e permuta"
    },
    { grupo: "total", chave: "TOTAL", rotulo: "Total geral", quantidade, valor: total }
  ];

  return {
    linhas,
    total: { cliente: plural(quantidade, "pagamento", "pagamentos"), valor: total },
    subtotais,
    cards: [
      {
        titulo: "Pagamentos",
        valor: String(quantidade),
        descricao: "Pagamentos recebidos no período.",
        tom: "info"
      },
      {
        titulo: "Total geral",
        valor: formatCurrency(total),
        descricao: "Tudo que foi pago no período (PAID).",
        tom: "success"
      },
      {
        titulo: "Passa pelo banco",
        valor: formatCurrency(totalBanco),
        descricao: `${plural(n(t.quantidade_banco), "pagamento", "pagamentos")}: PIX, boleto e cartão. É o que se confere com o extrato.`,
        tom: "success"
      },
      {
        titulo: "Sem movimento no banco",
        valor: formatCurrency(totalSemBanco),
        descricao: `${plural(n(t.quantidade_sem_banco), "pagamento", "pagamentos")}: faturado, crédito do cliente, amostra, retrabalho e permuta.`,
        tom: "warning"
      }
    ]
  };
}

const COLUNAS_PDF: ColunaPdf[] = [
  { titulo: "Data e hora", largura: 11 },
  { titulo: "Pedido", largura: 7 },
  { titulo: "Cliente", largura: 29 },
  { titulo: "Empresa", largura: 15 },
  { titulo: "Forma", largura: 14 },
  { titulo: "Valor", largura: 12, alinhamento: "right" }
];

function montarPdf(resultado: ResultadoRelatorio, contexto: Parameters<NonNullable<RelatorioDef["pdf"]>["montar"]>[1]): ModeloPdf {
  const subtotais = resultado.subtotais ?? [];
  const porForma = subtotais.filter((s) => s.grupo === "forma");

  const secoes = porForma.map((forma) => {
    const linhas = resultado.linhas.filter((l) => l.forma === forma.chave);
    return {
      titulo: `${forma.rotulo} — ${plural(forma.quantidade, "pagamento", "pagamentos")}`,
      nota: forma.nota,
      colunas: COLUNAS_PDF,
      linhas: linhas.map((l) => [
        `${formatDataCivil(String(l.data))} ${l.hora ?? ""}`.trim(),
        l.pedido === null ? "—" : String(l.pedido),
        String(l.cliente || "—"),
        String(l.empresa),
        String(l.forma_rotulo),
        formatCurrency(Number(l.valor))
      ]),
      subtotal: { rotulo: `Subtotal ${forma.rotulo}`, valor: formatCurrency(forma.valor) }
    };
  });

  const resumo = [
    ...porForma.map((s) => ({
      rotulo: `${s.rotulo}${s.nota ? ` (${s.nota.toLowerCase()})` : ""} — ${plural(s.quantidade, "pagamento", "pagamentos")}`,
      valor: formatCurrency(s.valor)
    })),
    ...subtotais
      .filter((s) => s.grupo === "empresa")
      .map((s) => ({ rotulo: `Empresa: ${s.rotulo} — ${plural(s.quantidade, "pagamento", "pagamentos")}`, valor: formatCurrency(s.valor) })),
    ...subtotais
      .filter((s) => s.grupo === "total")
      .map((s) => ({
        rotulo: `${s.rotulo} — ${plural(s.quantidade, "pagamento", "pagamentos")}`,
        valor: formatCurrency(s.valor),
        destaque: s.chave === "TOTAL"
      }))
  ];

  const { inicio, fim } = contexto.consulta;
  return {
    titulo: "Conferência de pagamentos",
    empresa: contexto.empresa,
    periodo: inicio === fim ? formatDataCivil(inicio) : `${formatDataCivil(inicio)} a ${formatDataCivil(fim)}`,
    filtros: contexto.filtros.filter((f) => !f.startsWith("Empresa:")),
    criterio:
      "Pagamentos recebidos (status PAID) pela data do pagamento, no dia de São Paulo, para conferir com o extrato bancário. Faturado a vencer não entra. Vendas de teste ficam de fora. Faturado, crédito do cliente, amostra, retrabalho e permuta aparecem, mas não passam pelo banco: o total que se confere com o extrato é o \"Total que passa pelo banco\" (PIX, boleto e cartão).",
    secoes,
    resumo,
    geradoEm: contexto.geradoEm,
    geradoPor: contexto.geradoPor
  };
}

export const conferenciaPagamentos: RelatorioDef = {
  slug: "conferencia-pagamentos",
  area: "financeiro",
  titulo: "Conferência de pagamentos",
  descricao: "Pagamentos recebidos no período, por forma de pagamento, para conferir com os extratos bancários. Tem PDF para baixar e imprimir.",
  permissao: "relatorios.conferencia_pagamentos",

  dataReferencia: {
    rotulo: "Data do pagamento",
    criterio:
      "Conta o dia em que o pagamento foi registrado como pago (dia de São Paulo) e só entra o que está PAID, como no extrato. Faturado a vencer fica de fora; vendas de teste também. Pode diferir da tela de Conferência, que mostra todas as cobranças pela data da confirmação. Faturado, crédito do cliente, amostra, retrabalho e permuta aparecem, mas não passam pelo banco: o total para conferir com o extrato é o que passa pelo banco (PIX, boleto e cartão)."
  },

  periodo: { presets: ["hoje", "mes", "mes_anterior", "custom"], padrao: "mes", maxDias: 93 },

  filtros: [
    { chave: "empresa", rotulo: "Empresa", todasRotulo: "Todas as empresas", opcoes: OPCOES_EMPRESA },
    {
      chave: "forma",
      rotulo: "Forma de pagamento",
      todasRotulo: "Todas as formas",
      opcoes: [
        { valor: "PIX", rotulo: "PIX" },
        { valor: "BOLETO", rotulo: "Boleto" },
        { valor: "CREDIT_CARD", rotulo: "Cartão de crédito" },
        { valor: "CARD_PARCELADO", rotulo: "Cartão parcelado" },
        { valor: "E-FATURADO", rotulo: "Faturado" },
        { valor: "E-CREDITO", rotulo: "Crédito do cliente" },
        { valor: "E-AMOSTRA", rotulo: "Amostra" },
        { valor: "E-RETRABALHO", rotulo: "Retrabalho" },
        { valor: "E-PERMUTA", rotulo: "Permuta" }
      ]
    }
  ],

  colunas: [
    { id: "data", titulo: "Data", tipo: "data", alinhamento: "left" },
    { id: "hora", titulo: "Hora", tipo: "texto" },
    { id: "pedido", titulo: "Pedido", tipo: "inteiro", alinhamento: "left" },
    { id: "cliente", titulo: "Cliente", tipo: "texto" },
    { id: "empresa", titulo: "Empresa", tipo: "texto" },
    { id: "forma_rotulo", titulo: "Forma", tipo: "texto" },
    { id: "banco", titulo: "Passa pelo banco", tipo: "texto", alinhamento: "center" },
    { id: "valor", titulo: "Valor", tipo: "moeda" }
  ],
  ordenacaoPadrao: { coluna: "data", direcao: "asc" },

  rpc: {
    nome: "rpc_relatorio_conferencia_pagamentos",
    argumentos: ({ inicio, fim, filtros }) => ({
      p_data_inicio: inicio,
      p_data_fim: fim,
      p_empresas: filtros.empresa ? [Number(filtros.empresa)] : null,
      p_formas: filtros.forma ? [filtros.forma] : null
    })
  },
  normalizar,

  pdf: {
    nomeArquivo: ({ inicio, fim }) => `conferencia-pagamentos_${inicio}_a_${fim}.pdf`,
    montar: montarPdf
  }
};
