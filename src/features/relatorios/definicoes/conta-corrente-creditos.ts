import { addDays } from "@/lib/period";
import { formatCurrency } from "@/lib/formatters/currency";
import type { LinhaRelatorio, RelatorioDef, ResultadoRelatorio } from "../types";

/**
 * Conta Corrente e créditos — extrato dos lançamentos de crédito dos clientes
 * (tabela `movimento_credito`), pela data do lançamento.
 *
 * Não existe função no banco para isto: a fonte é a própria tabela, lida na rota com a
 * sessão do usuário (`consultar`). A soma é feita na rota, no servidor, sobre as linhas
 * do período; o navegador só recebe o resultado. Sem filtro de empresa: o lançamento não
 * guarda empresa. Vendas de teste, amostra e retrabalho não se aplicam: aqui não há venda,
 * só o extrato de crédito.
 */

const TAMANHO_PAGINA = 1000;
const MAX_PAGINAS = 10;

type Movimento = {
  id: number | string;
  id_cliente: number | string | null;
  id_int: number | null;
  valor: number | string | null;
  tipo: string | null;
  origem: string | null;
  tipo_evento: string | null;
  created_at: string;
  cancelado: boolean | null;
};

type Dados = { movimentos: Movimento[]; clientes: Record<string, string> };

const numero = (v: number | string | null | undefined) => Number(v ?? 0);

function diaSP(instante: string) {
  return new Date(instante).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

const ROTULO_EVENTO: Record<string, string> = {
  ABERTURA: "Abertura",
  BAIXA: "Baixa",
  BONIFICACAO: "Bonificação",
  CANCELAMENTO: "Cancelamento",
  DEVOLUCAO: "Devolução",
  ESTORNO: "Estorno",
  USO_PEDIDO: "Uso em pedido"
};

const ROTULO_ORIGEM: Record<string, string> = { AJUSTE: "Ajuste", MANUAL: "Manual", SISTEMA: "Sistema" };

async function consultar(
  supabase: Parameters<NonNullable<RelatorioDef["consultar"]>>[0],
  { inicio, fim, filtros }: Parameters<NonNullable<RelatorioDef["consultar"]>>[1]
) {
  // Dia de São Paulo (UTC-3, sem horário de verão), extremos inclusos.
  const de = `${inicio}T00:00:00-03:00`;
  const ate = `${addDays(fim, 1)}T00:00:00-03:00`;
  const cancelados = filtros.situacao === "CANCELADO";

  const movimentos: Movimento[] = [];
  for (let pagina = 0; ; pagina++) {
    if (pagina >= MAX_PAGINAS) {
      return { data: null, error: { code: "LIMITE", message: "Muitos lançamentos no período." } };
    }
    let consulta = supabase
      .from("movimento_credito")
      .select("id,id_cliente,id_int,valor,tipo,origem,tipo_evento,created_at,cancelado")
      .eq("cancelado", cancelados)
      .gte("created_at", de)
      .lt("created_at", ate);
    if (filtros.tipo) consulta = consulta.eq("tipo", filtros.tipo);
    if (filtros.origem) consulta = consulta.eq("origem", filtros.origem);
    if (filtros.evento === "SEM_EVENTO") consulta = consulta.is("tipo_evento", null);
    else if (filtros.evento) consulta = consulta.eq("tipo_evento", filtros.evento);

    const { data, error } = await consulta
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1);
    if (error) return { data: null, error };
    movimentos.push(...((data ?? []) as Movimento[]));
    if ((data ?? []).length < TAMANHO_PAGINA) break;
  }

  // Nomes dos clientes, em lotes (a tabela de clientes é grande; busca só os ids do extrato).
  const ids = [...new Set(movimentos.map((m) => m.id_cliente).filter((id) => id !== null))] as Array<number | string>;
  const clientes: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from("clientes")
      .select("id_cliente,nome,fantasia")
      .in("id_cliente", ids.slice(i, i + 150));
    if (error) return { data: null, error };
    for (const c of (data ?? []) as Array<{ id_cliente: number | string; nome: string | null; fantasia: string | null }>) {
      clientes[String(c.id_cliente)] = (c.nome ?? "").trim() || (c.fantasia ?? "").trim();
    }
  }

  return { data: { movimentos, clientes } satisfies Dados, error: null };
}

function normalizar(resposta: unknown): ResultadoRelatorio {
  const { movimentos = [], clientes = {} } = (resposta ?? {}) as Partial<Dados>;

  let creditos = 0;
  let debitos = 0;
  const clientesEnvolvidos = new Set<string>();
  const linhas: LinhaRelatorio[] = movimentos.map((m) => {
    const valor = numero(m.valor);
    const credito = String(m.tipo).toUpperCase() === "CREDITO";
    if (credito) creditos += valor;
    else debitos += valor;
    clientesEnvolvidos.add(String(m.id_cliente));
    return {
      data: diaSP(m.created_at),
      id_cliente: m.id_cliente === null ? null : Number(m.id_cliente),
      cliente: clientes[String(m.id_cliente)] ?? "",
      pedido: m.id_int,
      evento: m.tipo_evento ? (ROTULO_EVENTO[m.tipo_evento] ?? m.tipo_evento) : "Lançamento",
      origem: m.origem ? (ROTULO_ORIGEM[m.origem] ?? m.origem) : "",
      credito: credito ? valor : null,
      debito: credito ? null : valor
    };
  });

  const arredondar = (n: number) => Math.round(n * 100) / 100;
  creditos = arredondar(creditos);
  debitos = arredondar(debitos);

  return {
    linhas,
    total: { cliente: `${linhas.length} ${linhas.length === 1 ? "lançamento" : "lançamentos"}`, credito: creditos, debito: debitos },
    cards: [
      {
        titulo: "Créditos",
        valor: formatCurrency(creditos),
        descricao: "Crédito lançado aos clientes no período.",
        tom: "success"
      },
      {
        titulo: "Débitos",
        valor: formatCurrency(debitos),
        descricao: "Uso, estorno e baixa de crédito no período.",
        tom: "warning"
      },
      {
        titulo: "Saldo do período",
        valor: formatCurrency(arredondar(creditos - debitos)),
        descricao: "Créditos menos débitos lançados no período.",
        tom: creditos - debitos < 0 ? "danger" : "info"
      },
      {
        titulo: "Lançamentos",
        valor: String(linhas.length),
        descricao: "Quantidade de lançamentos listados.",
        tom: "neutral"
      },
      {
        titulo: "Clientes",
        valor: String(clientesEnvolvidos.size),
        descricao: "Clientes com lançamento no período.",
        tom: "neutral"
      }
    ]
  };
}

export const contaCorrenteCreditos: RelatorioDef = {
  slug: "conta-corrente-creditos",
  area: "financeiro",
  titulo: "Conta Corrente e créditos",
  descricao: "Extrato dos lançamentos de crédito dos clientes: créditos, usos em pedido, estornos e ajustes.",
  permissao: "relatorios.conta_corrente_creditos",

  dataReferencia: {
    rotulo: "Data do lançamento",
    criterio:
      "Conta o dia em que o lançamento foi registrado (dia de São Paulo). Por padrão só entram lançamentos válidos; os cancelados ficam no filtro Situação. Não há filtro de empresa, porque o lançamento de crédito não guarda empresa. É o movimento do período, não o saldo atual do cliente."
  },

  periodo: { presets: ["hoje", "mes", "mes_anterior", "custom"], padrao: "mes", maxDias: 366 },

  filtros: [
    {
      chave: "tipo",
      rotulo: "Tipo",
      todasRotulo: "Crédito e débito",
      opcoes: [
        { valor: "CREDITO", rotulo: "Crédito" },
        { valor: "DEBITO", rotulo: "Débito" }
      ]
    },
    {
      chave: "evento",
      rotulo: "Evento",
      todasRotulo: "Todos os eventos",
      opcoes: [
        ...Object.entries(ROTULO_EVENTO).map(([valor, rotulo]) => ({ valor, rotulo })),
        { valor: "SEM_EVENTO", rotulo: "Lançamento (sem evento)" }
      ]
    },
    {
      chave: "origem",
      rotulo: "Origem",
      todasRotulo: "Todas as origens",
      opcoes: Object.entries(ROTULO_ORIGEM).map(([valor, rotulo]) => ({ valor, rotulo }))
    },
    {
      chave: "situacao",
      rotulo: "Situação",
      todasRotulo: "Válidos",
      opcoes: [{ valor: "CANCELADO", rotulo: "Cancelados" }]
    }
  ],

  colunas: [
    { id: "data", titulo: "Data", tipo: "data", alinhamento: "left" },
    { id: "id_cliente", titulo: "Cód. cliente", tipo: "inteiro", alinhamento: "left" },
    { id: "cliente", titulo: "Cliente", tipo: "texto" },
    { id: "pedido", titulo: "Pedido", tipo: "inteiro", alinhamento: "left" },
    { id: "evento", titulo: "Evento", tipo: "texto" },
    { id: "origem", titulo: "Origem", tipo: "texto" },
    { id: "credito", titulo: "Crédito", tipo: "moeda" },
    { id: "debito", titulo: "Débito", tipo: "moeda" }
  ],
  ordenacaoPadrao: { coluna: "data", direcao: "desc" },

  consultar,
  normalizar
};
