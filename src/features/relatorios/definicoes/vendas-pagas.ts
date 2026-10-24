import { formatCurrency } from "@/lib/formatters/currency";
import { carregarVendedores, OPCOES_EMPRESA } from "../lib/opcoes";
import type { LinhaRelatorio, RelatorioDef, ResultadoRelatorio } from "../types";

/**
 * Vendas pagas — uma linha por proposta com pagamento no período.
 *
 * Dados: `rpc_relatorio_vendas_pagas_json` (agrega no banco; devolve as linhas e
 * os totais). A forma `_json` também evita o corte de 1000 linhas que o PostgREST
 * aplica a funções que devolvem tabela. A RPC confere a permissão
 * `relatorios.vendas_pagas` e exclui as vendas de teste.
 */

type VendaPagaApi = {
  numero_proposta: number;
  os_ideal: number | null;
  cliente: string | null;
  vendedor: string | null;
  primeira_data_pagamento: string | null;
  ultima_data_pagamento: string | null;
  formas_pagamento: string | null;
  empresa: string | null;
  valor_com_frete: number | string | null;
  valor_frete: number | string | null;
  valor_sem_frete: number | string | null;
  qtd_pagamentos: number | null;
};

type RespostaApi = {
  totais?: {
    quantidade_vendas?: number;
    total_com_frete?: number | string;
    total_frete?: number | string;
    total_sem_frete?: number | string;
  };
  vendas?: VendaPagaApi[];
};

const numero = (valor: number | string | null | undefined) => Number(valor ?? 0);

function normalizar(resposta: unknown): ResultadoRelatorio {
  const r = (resposta ?? {}) as RespostaApi;
  const t = r.totais ?? {};
  const quantidade = numero(t.quantidade_vendas);
  const comFrete = numero(t.total_com_frete);
  const frete = numero(t.total_frete);
  const semFrete = numero(t.total_sem_frete);

  const linhas: LinhaRelatorio[] = (r.vendas ?? []).map((v) => ({
    numero_proposta: v.numero_proposta,
    os_ideal: v.os_ideal ?? null,
    cliente: v.cliente ?? "",
    vendedor: v.vendedor ?? "",
    formas_pagamento: v.formas_pagamento ?? "",
    empresa: v.empresa ?? "",
    primeira_data_pagamento: v.primeira_data_pagamento ?? null,
    ultima_data_pagamento: v.ultima_data_pagamento ?? null,
    valor_com_frete: numero(v.valor_com_frete),
    valor_frete: numero(v.valor_frete),
    valor_sem_frete: numero(v.valor_sem_frete),
    qtd_pagamentos: numero(v.qtd_pagamentos)
  }));

  return {
    linhas,
    total: {
      numero_proposta: `${quantidade} ${quantidade === 1 ? "venda" : "vendas"}`,
      valor_com_frete: comFrete,
      valor_frete: frete,
      valor_sem_frete: semFrete
    },
    cards: [
      {
        titulo: "Vendas pagas",
        valor: String(quantidade),
        descricao: "Propostas com pagamento no período.",
        tom: "info"
      },
      {
        titulo: "Total com frete",
        valor: formatCurrency(comFrete),
        descricao: "Soma dos pagamentos confirmados no período.",
        tom: "success"
      },
      {
        titulo: "Frete",
        valor: formatCurrency(frete),
        descricao: "Frete das propostas pagas.",
        tom: "neutral"
      },
      {
        titulo: "Total sem frete",
        valor: formatCurrency(semFrete),
        descricao: "Total com frete menos o frete.",
        tom: "success"
      },
      {
        titulo: "Ticket médio",
        valor: formatCurrency(quantidade > 0 ? comFrete / quantidade : 0),
        descricao: "Total com frete por venda paga.",
        tom: "neutral"
      }
    ]
  };
}

export const vendasPagas: RelatorioDef = {
  slug: "vendas-pagas",
  area: "vendas",
  titulo: "Vendas pagas",
  descricao: "Propostas que tiveram pagamento confirmado no período, com vendedor, forma de pagamento e frete.",
  permissao: "relatorios.vendas_pagas",

  dataReferencia: {
    rotulo: "Data do pagamento",
    criterio:
      "Conta o dia em que o pagamento foi registrado (dia de São Paulo). Entram pagamentos confirmados, sem vendas de teste. Pode diferir do Dashboard e da Conferência, que usam a data da confirmação."
  },

  periodo: { presets: ["hoje", "mes", "mes_anterior", "custom"], padrao: "mes", maxDias: 366 },

  filtros: [
    { chave: "empresa", rotulo: "Empresa", todasRotulo: "Todas as empresas", opcoes: OPCOES_EMPRESA },
    { chave: "vendedor", rotulo: "Vendedor", todasRotulo: "Todos os vendedores", carregarOpcoes: carregarVendedores },
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
        { valor: "E-PERMUTA", rotulo: "Permuta" },
        { valor: "E-RETRABALHO", rotulo: "Retrabalho" }
      ]
    }
  ],

  colunas: [
    { id: "numero_proposta", titulo: "Proposta", tipo: "inteiro", alinhamento: "left" },
    { id: "os_ideal", titulo: "OS Ideal", tipo: "inteiro", alinhamento: "left" },
    { id: "cliente", titulo: "Cliente", tipo: "texto" },
    { id: "vendedor", titulo: "Vendedor", tipo: "texto" },
    { id: "formas_pagamento", titulo: "Forma de pagamento", tipo: "texto" },
    { id: "empresa", titulo: "Empresa", tipo: "texto" },
    { id: "primeira_data_pagamento", titulo: "1º pagamento", tipo: "data" },
    { id: "ultima_data_pagamento", titulo: "Último pagamento", tipo: "data" },
    { id: "valor_com_frete", titulo: "Valor com frete", tipo: "moeda" },
    { id: "valor_frete", titulo: "Frete", tipo: "moeda" },
    { id: "valor_sem_frete", titulo: "Valor sem frete", tipo: "moeda" },
    { id: "qtd_pagamentos", titulo: "Pagamentos", tipo: "inteiro" }
  ],
  ordenacaoPadrao: { coluna: "ultima_data_pagamento", direcao: "desc" },

  rpc: {
    nome: "rpc_relatorio_vendas_pagas_json",
    argumentos: ({ inicio, fim, filtros }) => ({
      p_data_inicio: inicio,
      p_data_fim: fim,
      p_empresas: filtros.empresa ? [Number(filtros.empresa)] : null,
      p_formas_pagamento: filtros.forma ? [filtros.forma] : null,
      p_vendedores: filtros.vendedor ? [filtros.vendedor] : null,
      p_incluir_frete: true
    })
  },
  normalizar
};
