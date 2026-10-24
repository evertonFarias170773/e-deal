import { formatCurrency } from "@/lib/formatters/currency";
import { carregarVendedores, OPCOES_EMPRESA } from "../lib/opcoes";
import { FILTRO_VALOR, incluirFrete, notaValor, rotuloValor } from "../lib/valor";
import type { LinhaRelatorio, RelatorioDef, ResultadoRelatorio } from "../types";

/**
 * Curva ABC de clientes — valor vendido por cliente no período, do maior para o menor.
 *
 * Dados: `rpc_relatorio_curva_abc_clientes` (agrega e classifica no banco). A venda entra
 * pela data de fechamento do pedido, com os mesmos cortes do relatório Vendas. A função
 * confere a permissão `relatorios.curva_abc_clientes`.
 */

type LinhaApi = {
  posicao: number;
  id_cliente: number | null;
  cliente: string | null;
  pedidos: number;
  valor: number | string;
  pct: number | string;
  pct_acumulado: number | string;
  classe: string;
};

type RespostaApi = {
  filtros?: { incluir_frete?: boolean };
  totais?: {
    clientes?: number;
    pedidos?: number;
    valor?: number | string;
    pct?: number | string;
    clientes_a?: number;
    clientes_b?: number;
    clientes_c?: number;
    valor_a?: number | string;
    valor_b?: number | string;
    valor_c?: number | string;
  };
  linhas?: LinhaApi[];
};

const n = (v: number | string | null | undefined) => Number(v ?? 0);

function normalizar(resposta: unknown): ResultadoRelatorio {
  const r = (resposta ?? {}) as RespostaApi;
  const t = r.totais ?? {};
  const rotulo = rotuloValor(Boolean(r.filtros?.incluir_frete));
  const valor = n(t.valor);
  const parte = (v: number) => (valor > 0 ? `${((v / valor) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "0%");

  const linhas: LinhaRelatorio[] = (r.linhas ?? []).map((l) => ({
    posicao: l.posicao,
    cliente: l.cliente ?? "",
    pedidos: n(l.pedidos),
    valor: n(l.valor),
    pct: n(l.pct),
    pct_acumulado: n(l.pct_acumulado),
    classe: l.classe
  }));

  const classe = (letra: "a" | "b" | "c") => {
    const clientes = n(t[`clientes_${letra}`]);
    const v = n(t[`valor_${letra}`]);
    return {
      titulo: `Classe ${letra.toUpperCase()}`,
      valor: `${clientes} ${clientes === 1 ? "cliente" : "clientes"}`,
      descricao: `${formatCurrency(v)} (${parte(v)} do valor)`,
      tom: letra === "a" ? ("success" as const) : letra === "b" ? ("info" as const) : ("neutral" as const)
    };
  };

  return {
    linhas,
    total: {
      cliente: `${n(t.clientes)} ${n(t.clientes) === 1 ? "cliente" : "clientes"}`,
      pedidos: n(t.pedidos),
      valor,
      pct: n(t.pct)
    },
    cards: [
      {
        titulo: `Valor total (${rotulo})`,
        valor: formatCurrency(valor),
        descricao: `${n(t.pedidos)} pedidos de ${n(t.clientes)} clientes no período.`,
        tom: "success"
      },
      classe("a"),
      classe("b"),
      classe("c"),
      {
        titulo: "Clientes",
        valor: String(n(t.clientes)),
        descricao: "Clientes com venda fechada no período.",
        tom: "neutral"
      }
    ]
  };
}

export const curvaAbcClientes: RelatorioDef = {
  slug: "curva-abc-clientes",
  area: "vendas",
  titulo: "Curva ABC de clientes",
  descricao: "Ranking dos clientes por valor vendido no período, com a participação de cada um e a classe A, B ou C.",
  permissao: "relatorios.curva_abc_clientes",

  dataReferencia: {
    rotulo: "Data de fechamento do pedido",
    criterio:
      "A venda entra no período pelo dia em que o pedido foi fechado (data da confirmação), paga ou faturada a vencer já confirmada, como no relatório Vendas e no Dashboard. Ficam de fora vendas de teste, amostra e retrabalho. A classe A reúne os clientes que completam os primeiros 80% do valor (o que cruza os 80% ainda é A), a B vai até 95% e a C é o restante."
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
    { id: "cliente", titulo: "Cliente", tipo: "texto" },
    { id: "pedidos", titulo: "Pedidos", tipo: "inteiro" },
    { id: "valor", titulo: "Valor", tipo: "moeda" },
    { id: "pct", titulo: "% do total", tipo: "percentual" },
    { id: "pct_acumulado", titulo: "% acumulado", tipo: "percentual" },
    { id: "classe", titulo: "Classe", tipo: "texto", alinhamento: "center" }
  ],
  ordenacaoPadrao: { coluna: "posicao", direcao: "asc" },

  rpc: {
    nome: "rpc_relatorio_curva_abc_clientes",
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
