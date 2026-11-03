import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDataCivil } from "@/lib/formatters/date";
import {
  ehBaseComissao,
  percentualDaComissao,
  ROTULO_BASE,
  textoDasFaixas,
  valorDaComissao,
  type BaseComissao
} from "../lib/comissao";
import type { ConsultaRelatorio, LinhaRelatorio, ModeloPdf, RelatorioDef, ResultadoRelatorio } from "../types";

/**
 * Pagamento de comissão (03/11/2026) — uma linha por vendedor, com o total vendido no período
 * (com e sem frete) e a comissão pela tabela de faixas (`lib/comissao.ts`).
 *
 * Critério de venda: o do relatório Vendas, sem nada novo. Os números vêm da MESMA função do
 * banco (`rpc_relatorio_vendas_json`), chamada uma vez sem filtro (para achar os vendedores do
 * período) e uma vez por vendedor com o filtro Vendedor, exatamente como o card Vendas faz
 * quando se escolhe um vendedor. Por isso o total de cada linha é o do card Vendas filtrado pelo
 * mesmo período e vendedor, inclusive no pedido com dois vendedores (cada um entra com os
 * pagamentos que lançou). A função confere a permissão `relatorios.vendas_pagas`.
 *
 * A base (com ou sem frete) é escolha de quem paga: enquanto não escolhida, %, ticket médio e
 * comissão ficam em branco. Nada é gravado; o recibo sai da rota `/api/relatorios/[slug]/recibo`.
 */

export const SLUG_PAGAMENTO_COMISSAO = "pagamento-comissao";

/** Pedido sem vendedor: a função do banco devolve este nome, e o filtro Vendedor não o acha. */
const SEM_VENDEDOR = "Não informado";
/** Teto de vendedores por período (cada um é uma chamada à função). */
const MAX_VENDEDORES = 60;

type Totais = { quantidade_vendas?: number; total_com_frete?: number | string; total_sem_frete?: number | string };
type VendaApi = { vendedor?: string | null; valor_com_frete?: number | string | null; valor_sem_frete?: number | string | null };
type RespostaVendas = { totais?: Totais; vendas?: VendaApi[] };

type DadosConsulta = {
  inicio: string;
  fim: string;
  base: string;
  geral: Totais;
  pedidosComMaisDeUmVendedor: number;
  vendedores: { nome: string; totais: Totais }[];
};

const numero = (v: number | string | null | undefined) => Number(v ?? 0);
const somar = (a: number, b: number) => Math.round((a + b) * 100) / 100;

function argumentos(consulta: ConsultaRelatorio, vendedores: string[] | null) {
  return {
    p_data_inicio: consulta.inicio,
    p_data_fim: consulta.fim,
    p_empresas: null,
    p_formas_pagamento: null,
    p_vendedores: vendedores,
    p_incluir_frete: true,
    p_situacao: null
  };
}

async function consultar(
  supabase: SupabaseClient,
  consulta: ConsultaRelatorio
): Promise<{ data: unknown; error: { code?: string; message: string } | null }> {
  const geral = await supabase.rpc("rpc_relatorio_vendas_json", argumentos(consulta, null));
  if (geral.error) return { data: null, error: geral.error };
  const vendas = ((geral.data ?? {}) as RespostaVendas).vendas ?? [];

  // A função junta os vendedores do pedido com " / " (ex.: "Everton Farias / Lisiane Colbeich").
  const nomes = new Set<string>();
  let pedidosComMaisDeUmVendedor = 0;
  for (const v of vendas) {
    const partes = String(v.vendedor ?? "").split(" / ").map((p) => p.trim()).filter(Boolean);
    if (partes.length > 1) pedidosComMaisDeUmVendedor++;
    partes.forEach((p) => nomes.add(p));
  }
  if (nomes.size > MAX_VENDEDORES) return { data: null, error: { code: "LIMITE", message: "vendedores demais" } };

  const lista = [...nomes].filter((n) => n !== SEM_VENDEDOR);
  const respostas = await Promise.all(
    lista.map((nome) => supabase.rpc("rpc_relatorio_vendas_json", argumentos(consulta, [nome])))
  );
  const falha = respostas.find((r) => r.error);
  if (falha?.error) return { data: null, error: falha.error };

  const vendedores = lista.map((nome, i) => ({ nome, totais: ((respostas[i].data ?? {}) as RespostaVendas).totais ?? {} }));

  // Sem vendedor: o filtro do banco não acha, então soma as linhas da consulta geral.
  const semVendedor = vendas.filter((v) => String(v.vendedor ?? "").trim() === SEM_VENDEDOR);
  if (semVendedor.length > 0) {
    vendedores.push({
      nome: SEM_VENDEDOR,
      totais: {
        quantidade_vendas: semVendedor.length,
        total_com_frete: semVendedor.reduce((s, v) => somar(s, numero(v.valor_com_frete)), 0),
        total_sem_frete: semVendedor.reduce((s, v) => somar(s, numero(v.valor_sem_frete)), 0)
      }
    });
  }

  const dados: DadosConsulta = {
    inicio: consulta.inicio,
    fim: consulta.fim,
    base: consulta.filtros.base ?? "",
    geral: ((geral.data ?? {}) as RespostaVendas).totais ?? {},
    pedidosComMaisDeUmVendedor,
    vendedores
  };
  return { data: dados, error: null };
}

/** Linha do relatório já com a base aplicada (a mesma conta da tela, do PDF e do recibo). */
export type LinhaComissao = {
  vendedor: string;
  periodo: string;
  com_frete: number;
  sem_frete: number;
  percentual: number | null;
  qtd_pedidos: number;
  ticket_medio: number | null;
  comissao: number | null;
};

export function calcularLinha(nome: string, periodo: string, totais: Totais, base: BaseComissao | null): LinhaComissao {
  const comFrete = numero(totais.total_com_frete);
  const semFrete = numero(totais.total_sem_frete);
  const qtd = numero(totais.quantidade_vendas);
  const total = base === "COM_FRETE" ? comFrete : base === "SEM_FRETE" ? semFrete : null;
  return {
    vendedor: nome,
    periodo,
    com_frete: comFrete,
    sem_frete: semFrete,
    percentual: total === null ? null : percentualDaComissao(total),
    qtd_pedidos: qtd,
    ticket_medio: total === null || qtd === 0 ? null : Math.round((total / qtd) * 100) / 100,
    comissao: total === null ? null : valorDaComissao(total)
  };
}

function normalizar(resposta: unknown): ResultadoRelatorio {
  const d = (resposta ?? {}) as Partial<DadosConsulta>;
  const base = ehBaseComissao(d.base) ? d.base : null;
  const periodo = d.inicio && d.fim ? `${formatDataCivil(d.inicio)} a ${formatDataCivil(d.fim)}` : "";

  const linhas = (d.vendedores ?? [])
    .map((v) => calcularLinha(v.nome, periodo, v.totais, base))
    .filter((l) => l.qtd_pedidos > 0)
    .sort((a, b) => b.com_frete - a.com_frete || a.vendedor.localeCompare(b.vendedor, "pt-BR"));

  const somaCom = linhas.reduce((s, l) => somar(s, l.com_frete), 0);
  const somaSem = linhas.reduce((s, l) => somar(s, l.sem_frete), 0);
  const somaComissao = base ? linhas.reduce((s, l) => somar(s, l.comissao ?? 0), 0) : null;
  const geral = d.geral ?? {};

  const avisos: string[] = [];
  if (!base) avisos.push("Escolha a Base da comissão (com frete ou sem frete) para ver o %, o ticket médio e o valor da comissão.");
  if ((d.pedidosComMaisDeUmVendedor ?? 0) > 0) {
    const n = d.pedidosComMaisDeUmVendedor ?? 0;
    avisos.push(
      `${n} ${n === 1 ? "pedido tem" : "pedidos têm"} mais de um vendedor: cada um entra com os pagamentos que lançou, como no relatório Vendas filtrado por vendedor. Por isso a soma das linhas pode passar do total do período em pedidos e no valor sem frete (o frete do pedido sai na linha de cada vendedor).`
    );
  }
  // O filtro Vendedor do banco procura o nome por trecho: um nome dentro de outro traz os dois.
  const nomes = linhas.map((l) => l.vendedor);
  for (const a of nomes) {
    const contem = nomes.filter((b) => b !== a && b.toLowerCase().includes(a.toLowerCase()));
    if (contem.length > 0) {
      avisos.push(`O nome "${a}" está dentro de ${contem.map((c) => `"${c}"`).join(", ")}: a linha de "${a}" pode somar pedidos de outro vendedor. Confira antes de pagar.`);
    }
  }
  if (linhas.some((l) => l.vendedor === SEM_VENDEDOR)) {
    avisos.push(`"${SEM_VENDEDOR}" são pedidos sem vendedor no pagamento; não há a quem pagar essa comissão sem conferir o pedido.`);
  }

  const linhasRelatorio: LinhaRelatorio[] = linhas.map((l) => ({ ...l }));

  return {
    linhas: linhasRelatorio,
    total: {
      vendedor: `${linhas.length} ${linhas.length === 1 ? "vendedor" : "vendedores"}`,
      com_frete: somaCom,
      sem_frete: somaSem,
      qtd_pedidos: linhas.reduce((s, l) => s + l.qtd_pedidos, 0),
      comissao: somaComissao
    },
    cards: [
      { titulo: "Vendedores", valor: String(linhas.length), descricao: "Com venda fechada no período.", tom: "info" },
      {
        titulo: "Vendas com frete",
        valor: formatCurrency(numero(geral.total_com_frete)),
        descricao: "Total do período, igual ao relatório Vendas com frete.",
        tom: "success"
      },
      {
        titulo: "Vendas sem frete",
        valor: formatCurrency(numero(geral.total_sem_frete)),
        descricao: "Total do período, igual ao relatório Vendas sem frete.",
        tom: "neutral"
      },
      {
        titulo: "Comissão a pagar",
        valor: somaComissao === null ? "—" : formatCurrency(somaComissao),
        descricao: base ? `Soma das comissões, base ${ROTULO_BASE[base].toLowerCase()}.` : "Escolha a base da comissão.",
        tom: base ? "warning" : "neutral"
      }
    ],
    avisos,
    extras: { base }
  };
}

const moeda = (v: unknown) => (v === null || v === undefined ? "—" : formatCurrency(Number(v)));
const pct = (v: unknown) =>
  v === null || v === undefined
    ? "—"
    : `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

function montarPdf(resultado: ResultadoRelatorio, contexto: Parameters<NonNullable<RelatorioDef["pdf"]>["montar"]>[1]): ModeloPdf {
  const base = ehBaseComissao(resultado.extras?.base) ? (resultado.extras?.base as BaseComissao) : null;
  const t = resultado.total;
  return {
    titulo: "Pagamento de comissão",
    empresa: "Todas as empresas",
    periodo: `${formatDataCivil(contexto.consulta.inicio)} a ${formatDataCivil(contexto.consulta.fim)}`,
    filtros: [`Base da comissão: ${base ? ROTULO_BASE[base] : "não escolhida"}`],
    criterio: `${pagamentoComissao.dataReferencia.criterio} Faixas: ${textoDasFaixas()}.`,
    secoes: [
      {
        titulo: "Comissão por vendedor",
        colunas: [
          { titulo: "Vendedor", largura: 2.4 },
          { titulo: "Vendas com frete", largura: 1.4, alinhamento: "right" },
          { titulo: "Vendas sem frete", largura: 1.4, alinhamento: "right" },
          { titulo: "% comissão", largura: 0.9, alinhamento: "right" },
          { titulo: "Pedidos", largura: 0.8, alinhamento: "right" },
          { titulo: "Ticket médio", largura: 1.2, alinhamento: "right" },
          { titulo: "Comissão", largura: 1.3, alinhamento: "right" }
        ],
        linhas: resultado.linhas.map((l) => [
          String(l.vendedor ?? ""),
          moeda(l.com_frete),
          moeda(l.sem_frete),
          pct(l.percentual),
          String(l.qtd_pedidos ?? 0),
          moeda(l.ticket_medio),
          moeda(l.comissao)
        ]),
        linhaTotal: [String(t.vendedor ?? "Total"), moeda(t.com_frete), moeda(t.sem_frete), "", String(t.qtd_pedidos ?? ""), "", moeda(t.comissao)]
      }
    ],
    resumo: resultado.cards.map((c) => ({ rotulo: c.titulo, valor: c.valor, destaque: c.titulo === "Comissão a pagar" })),
    notas: resultado.avisos,
    geradoEm: contexto.geradoEm,
    geradoPor: contexto.geradoPor
  };
}

export const pagamentoComissao: RelatorioDef = {
  slug: SLUG_PAGAMENTO_COMISSAO,
  area: "vendas",
  titulo: "Pagamento de comissão",
  descricao: "Total vendido por vendedor no período, com e sem frete, a comissão pela faixa e o recibo em A4 de cada um.",
  // A mesma permissão do relatório Vendas: mostra a venda de todos os vendedores.
  permissao: "relatorios.vendas_pagas",

  dataReferencia: {
    rotulo: "Data de fechamento do pedido",
    criterio:
      "O que conta como venda é exatamente o do relatório Vendas: propostas com pagamento fechado no período, pagas ou faturadas a vencer, pelo dia do fechamento do pedido; ficam de fora vendas de teste, amostra e retrabalho. O total de cada vendedor é o do relatório Vendas filtrado pelo mesmo vendedor. A faixa de % sai do total do vendedor na base escolhida e vale sobre o total inteiro."
  },

  periodo: { presets: ["mes", "mes_anterior", "custom"], padrao: "mes_anterior", maxDias: 366 },

  filtros: [
    {
      chave: "base",
      rotulo: "Base da comissão",
      todasRotulo: "Escolha a base",
      opcoes: [
        { valor: "COM_FRETE", rotulo: ROTULO_BASE.COM_FRETE },
        { valor: "SEM_FRETE", rotulo: ROTULO_BASE.SEM_FRETE }
      ]
    }
  ],
  notaDosFiltros: (f) =>
    ehBaseComissao(f.base)
      ? `Comissão calculada sobre as vendas ${ROTULO_BASE[f.base].toLowerCase()}.`
      : "Base da comissão ainda não escolhida.",

  colunas: [
    { id: "vendedor", titulo: "Vendedor", tipo: "texto" },
    { id: "periodo", titulo: "Período", tipo: "texto" },
    { id: "com_frete", titulo: "Vendas com frete", tipo: "moeda" },
    { id: "sem_frete", titulo: "Vendas sem frete", tipo: "moeda" },
    { id: "percentual", titulo: "% da comissão", tipo: "percentual" },
    { id: "qtd_pedidos", titulo: "Qtd de pedidos", tipo: "inteiro" },
    { id: "ticket_medio", titulo: "Ticket médio", tipo: "moeda" },
    { id: "comissao", titulo: "Valor da comissão", tipo: "moeda" }
  ],
  ordenacaoPadrao: { coluna: "com_frete", direcao: "desc" },

  consultar,
  normalizar,
  pdf: {
    nomeArquivo: ({ inicio, fim }) => `pagamento-comissao_${inicio}_a_${fim}.pdf`,
    montar: montarPdf
  }
};
