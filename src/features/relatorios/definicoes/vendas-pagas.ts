import { formatCurrency } from "@/lib/formatters/currency";
import { carregarVendedores, OPCOES_EMPRESA } from "../lib/opcoes";
import type { LinhaRelatorio, RelatorioDef, ResultadoRelatorio } from "../types";

/**
 * Vendas — uma linha por proposta com pagamento fechado no período.
 *
 * A venda entra pela data de fechamento do pedido (data da confirmação), seja paga
 * (PAID) ou faturado a vencer confirmado: o mesmo critério do Dashboard. O que conta
 * como "pago" segue `cc__valor_pago`. O nome do arquivo, o endereço e a chave de
 * permissão (`relatorios.vendas_pagas`) ficam como nasceram, para não quebrar link
 * nem perfil; só o título mudou, porque o relatório não é mais só de pagas.
 *
 * Dados: `rpc_relatorio_vendas_json` (agrega no banco; devolve as linhas e os totais).
 * A forma `_json` também evita o corte de 1000 linhas que o PostgREST aplica a funções
 * que devolvem tabela. A RPC confere a permissão e exclui as vendas de teste.
 */

type VendaApi = {
  numero_proposta: number;
  os_ideal: number | null;
  cliente: string | null;
  vendedor: string | null;
  primeira_data_fechamento: string | null;
  ultima_data_fechamento: string | null;
  formas_pagamento: string | null;
  situacao: string | null;
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
    total_pago?: number | string;
    total_faturado_a_vencer?: number | string;
  };
  vendas?: VendaApi[];
};

const numero = (valor: number | string | null | undefined) => Number(valor ?? 0);

function normalizar(resposta: unknown): ResultadoRelatorio {
  const r = (resposta ?? {}) as RespostaApi;
  const t = r.totais ?? {};
  const quantidade = numero(t.quantidade_vendas);
  const comFrete = numero(t.total_com_frete);
  const frete = numero(t.total_frete);
  const semFrete = numero(t.total_sem_frete);
  const pago = numero(t.total_pago);
  const faturado = numero(t.total_faturado_a_vencer);

  const linhas: LinhaRelatorio[] = (r.vendas ?? []).map((v) => ({
    numero_proposta: v.numero_proposta,
    os_ideal: v.os_ideal ?? null,
    cliente: v.cliente ?? "",
    vendedor: v.vendedor ?? "",
    formas_pagamento: v.formas_pagamento ?? "",
    situacao: v.situacao ?? "",
    empresa: v.empresa ?? "",
    primeira_data_fechamento: v.primeira_data_fechamento ?? null,
    ultima_data_fechamento: v.ultima_data_fechamento ?? null,
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
        titulo: "Vendas",
        valor: String(quantidade),
        descricao: "Propostas com pagamento fechado no período.",
        tom: "info"
      },
      {
        titulo: "Total com frete",
        valor: formatCurrency(comFrete),
        descricao: "Pago mais faturado a vencer, pela data de fechamento.",
        tom: "success"
      },
      {
        titulo: "Pago",
        valor: formatCurrency(pago),
        descricao: "Pagamentos já recebidos.",
        tom: "success"
      },
      {
        titulo: "Faturado a vencer",
        valor: formatCurrency(faturado),
        descricao: "Faturado confirmado, ainda a receber.",
        tom: "warning"
      },
      {
        titulo: "Ticket médio",
        valor: formatCurrency(quantidade > 0 ? comFrete / quantidade : 0),
        descricao: "Total com frete por venda.",
        tom: "neutral"
      }
    ]
  };
}

export const vendasPagas: RelatorioDef = {
  slug: "vendas-pagas",
  area: "vendas",
  titulo: "Vendas",
  descricao:
    "Propostas com pagamento fechado no período, pagas ou faturadas a vencer, com vendedor, forma de pagamento, situação e frete.",
  permissao: "relatorios.vendas_pagas",

  dataReferencia: {
    rotulo: "Data de fechamento do pedido",
    criterio:
      "A venda entra no período pelo dia em que o pedido foi fechado (data da confirmação), seja paga ou faturada a vencer já confirmada. É a mesma data do Dashboard, e os totais batem com ele no mesmo período e empresa. Ficam de fora vendas de teste, amostra e retrabalho, e pagamentos sem data de confirmação (só os de abril e maio de 2026)."
  },

  periodo: { presets: ["hoje", "mes", "mes_anterior", "custom"], padrao: "mes", maxDias: 366 },

  filtros: [
    { chave: "empresa", rotulo: "Empresa", todasRotulo: "Todas as empresas", opcoes: OPCOES_EMPRESA },
    { chave: "vendedor", rotulo: "Vendedor", todasRotulo: "Todos os vendedores", carregarOpcoes: carregarVendedores },
    {
      chave: "situacao",
      rotulo: "Situação",
      todasRotulo: "Todas as situações",
      opcoes: [
        { valor: "PAGO", rotulo: "Pago" },
        { valor: "FATURADO_A_VENCER", rotulo: "Faturado a vencer" }
      ]
    },
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
        { valor: "E-PERMUTA", rotulo: "Permuta" }
      ]
    }
  ],

  colunas: [
    { id: "numero_proposta", titulo: "Proposta", tipo: "inteiro", alinhamento: "left" },
    { id: "os_ideal", titulo: "OS Ideal", tipo: "inteiro", alinhamento: "left" },
    { id: "cliente", titulo: "Cliente", tipo: "texto" },
    { id: "vendedor", titulo: "Vendedor", tipo: "texto" },
    { id: "situacao", titulo: "Situação", tipo: "texto" },
    { id: "formas_pagamento", titulo: "Forma de pagamento", tipo: "texto" },
    { id: "empresa", titulo: "Empresa", tipo: "texto" },
    { id: "primeira_data_fechamento", titulo: "1º fechamento", tipo: "data" },
    { id: "ultima_data_fechamento", titulo: "Último fechamento", tipo: "data" },
    { id: "valor_com_frete", titulo: "Valor com frete", tipo: "moeda" },
    { id: "valor_frete", titulo: "Frete", tipo: "moeda" },
    { id: "valor_sem_frete", titulo: "Valor sem frete", tipo: "moeda" },
    { id: "qtd_pagamentos", titulo: "Pagamentos", tipo: "inteiro" }
  ],
  ordenacaoPadrao: { coluna: "ultima_data_fechamento", direcao: "desc" },

  rpc: {
    nome: "rpc_relatorio_vendas_json",
    argumentos: ({ inicio, fim, filtros }) => ({
      p_data_inicio: inicio,
      p_data_fim: fim,
      p_empresas: filtros.empresa ? [Number(filtros.empresa)] : null,
      p_formas_pagamento: filtros.forma ? [filtros.forma] : null,
      p_vendedores: filtros.vendedor ? [filtros.vendedor] : null,
      p_incluir_frete: true,
      p_situacao: filtros.situacao || null
    })
  },
  normalizar
};
