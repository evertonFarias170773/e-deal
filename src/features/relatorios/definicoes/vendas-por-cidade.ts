import { formatCurrency } from "@/lib/formatters/currency";
import { carregarVendedores, OPCOES_EMPRESA } from "../lib/opcoes";
import { FILTRO_VALOR, incluirFrete, notaValor, rotuloValor } from "../lib/valor";
import type { LinhaRelatorio, RelatorioDef, ResultadoRelatorio } from "../types";

/**
 * Vendas por cidade — valor vendido por cidade no período.
 *
 * Dados: `rpc_relatorio_vendas_por_cidade` (agrega no banco). Mesma regra de venda, período
 * e frete do relatório Vendas. A cidade é a do cadastro do cliente (a do endereço de entrega
 * só entra quando o cliente não tem cidade), normalizada em maiúsculas e sem acento. A função
 * confere a permissão `relatorios.vendas_por_cidade`.
 */

type LinhaApi = {
  posicao: number;
  cidade: string;
  uf: string | null;
  clientes: number;
  pedidos: number;
  valor: number | string;
  pct: number | string;
};

type RespostaApi = {
  filtros?: { incluir_frete?: boolean };
  totais?: {
    cidades?: number;
    clientes?: number;
    pedidos?: number;
    valor?: number | string;
    pct?: number | string;
  };
  linhas?: LinhaApi[];
};

const n = (v: number | string | null | undefined) => Number(v ?? 0);

function normalizar(resposta: unknown): ResultadoRelatorio {
  const r = (resposta ?? {}) as RespostaApi;
  const t = r.totais ?? {};
  const rotulo = rotuloValor(Boolean(r.filtros?.incluir_frete));
  const valor = n(t.valor);

  const linhas: LinhaRelatorio[] = (r.linhas ?? []).map((l) => ({
    posicao: l.posicao,
    cidade: l.cidade,
    uf: l.uf ?? "",
    clientes: n(l.clientes),
    pedidos: n(l.pedidos),
    valor: n(l.valor),
    pct: n(l.pct)
  }));

  const maior = r.linhas?.[0];

  return {
    linhas,
    total: {
      cidade: `${n(t.cidades)} ${n(t.cidades) === 1 ? "cidade" : "cidades"}`,
      clientes: n(t.clientes),
      pedidos: n(t.pedidos),
      valor,
      pct: n(t.pct)
    },
    cards: [
      {
        titulo: `Valor total (${rotulo})`,
        valor: formatCurrency(valor),
        descricao: "Vendas fechadas no período, somadas todas as cidades.",
        tom: "success"
      },
      {
        titulo: "Cidades",
        valor: String(n(t.cidades)),
        descricao: "Cidades com venda no período.",
        tom: "info"
      },
      {
        titulo: "Clientes",
        valor: String(n(t.clientes)),
        descricao: "Clientes com venda fechada no período.",
        tom: "neutral"
      },
      {
        titulo: "Pedidos",
        valor: String(n(t.pedidos)),
        descricao: "Pedidos com venda fechada no período.",
        tom: "neutral"
      },
      {
        titulo: "Maior cidade",
        valor: maior ? `${maior.cidade}${maior.uf ? `/${maior.uf}` : ""}` : "—",
        descricao: maior
          ? `${formatCurrency(n(maior.valor))} (${n(maior.pct).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% do valor)`
          : "Sem vendas no período.",
        tom: "neutral"
      }
    ]
  };
}

export const vendasPorCidade: RelatorioDef = {
  slug: "vendas-por-cidade",
  area: "vendas",
  titulo: "Vendas por cidade",
  descricao: "Valor vendido, clientes e pedidos por cidade no período.",
  permissao: "relatorios.vendas_por_cidade",

  dataReferencia: {
    rotulo: "Data de fechamento do pedido",
    criterio:
      "A venda entra no período pelo dia em que o pedido foi fechado (data da confirmação), paga ou faturada a vencer já confirmada, como no relatório Vendas e no Dashboard. Ficam de fora vendas de teste, amostra e retrabalho. A cidade é a do cadastro do cliente; se o cliente não tiver cidade, vale a do endereço de entrega do pedido. O nome da cidade é unificado em maiúsculas e sem acento."
  },

  periodo: { presets: ["hoje", "mes", "mes_anterior", "custom"], padrao: "mes", maxDias: 366 },

  filtros: [
    { chave: "empresa", rotulo: "Empresa", todasRotulo: "Todas as empresas", opcoes: OPCOES_EMPRESA },
    { chave: "vendedor", rotulo: "Vendedor", todasRotulo: "Todos os vendedores", carregarOpcoes: carregarVendedores },
    FILTRO_VALOR
  ],
  notaDosFiltros: notaValor,

  colunas: [
    { id: "posicao", titulo: "Posição", tipo: "inteiro", alinhamento: "left" },
    { id: "cidade", titulo: "Cidade", tipo: "texto" },
    { id: "uf", titulo: "UF", tipo: "texto" },
    { id: "clientes", titulo: "Clientes", tipo: "inteiro" },
    { id: "pedidos", titulo: "Pedidos", tipo: "inteiro" },
    { id: "valor", titulo: "Valor", tipo: "moeda" },
    { id: "pct", titulo: "% do total", tipo: "percentual" }
  ],
  ordenacaoPadrao: { coluna: "posicao", direcao: "asc" },

  rpc: {
    nome: "rpc_relatorio_vendas_por_cidade",
    argumentos: ({ inicio, fim, filtros }) => ({
      p_data_inicio: inicio,
      p_data_fim: fim,
      p_empresas: filtros.empresa ? [Number(filtros.empresa)] : null,
      p_vendedores: filtros.vendedor ? [filtros.vendedor] : null,
      p_incluir_frete: incluirFrete(filtros)
    })
  },
  normalizar
};
