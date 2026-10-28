import { addDays } from "@/lib/period";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDataCivil } from "@/lib/formatters/date";
import type { ColunaPdf, LinhaRelatorio, ModeloPdf, RelatorioDef, ResultadoRelatorio } from "../types";

/**
 * Frete cobrado por transportadora — o frete que os pedidos despachados no período COBRARAM do
 * cliente, agrupado pela transportadora e pela modalidade do despacho.
 *
 * Não é o custo pago à transportadora: esse custo não é gravado no ERP.
 *
 * Fontes (só leitura, com a sessão do usuário, lidas na rota): `expedicoes` (data_despacho,
 * transportadora_nome, modalidade_frete — o despacho vence o orçamento) e `propostas.valor_frete`
 * (o frete que a proposta cobra, o mesmo que a Expedição mostra como "frete cobrado"; sem
 * recalcular). Conferido em 27/10/2026: em 953 de 957 despachos o valor_frete é igual à cotação
 * escolhida. Sem função no banco: a soma é feita na rota, no servidor; o navegador só exibe.
 */

const TAMANHO_PAGINA = 1000;
const MAX_PAGINAS = 10;

/**
 * GRUPOS DE TRANSPORTADORA (28/10/2026, decisão do dono).
 *
 * `expedicoes.transportadora_nome` varia conforme o cadastro que a tela tinha na hora do despacho:
 * os Correios saem como "SEDEX", "Correios" ou "CORREIOS SEDE", o motoboy como "Motoboy" ou
 * "B M EXPRESS". O relatório junta esses nomes NA LEITURA; nada gravado muda.
 *
 * Prioridade: `tipo_frete`, depois `id_transportadora_cliente`, depois o nome gravado como apelido
 * (comparado sem maiúsculas, acento nem espaços sobrando). Nome que não bate em nenhum grupo segue
 * como está, para um nome novo nunca sumir nem cair num grupo em silêncio.
 *
 * Para incluir um apelido, um tipo ou um cadastro, edite SÓ esta lista. Um apelido não pode estar
 * em dois grupos.
 */
const GRUPOS_TRANSPORTADORA: ReadonlyArray<{
  nome: string;
  tipos: readonly string[];
  idsCadastro: readonly number[];
  apelidos: readonly string[];
}> = [
  { nome: "Correios", tipos: ["CORREIOS"], idsCadastro: [39975, 663], apelidos: ["SEDEX", "PAC", "Correios", "CORREIOS SEDE"] },
  { nome: "Motoboy", tipos: ["MOTOBOY"], idsCadastro: [997], apelidos: ["Motoboy", "B M EXPRESS"] },
  // 120018: VEPPO CIA LIMITADA, fantasia ESTACAO RODOVIARIA CENTRAL DE PORTO ALEGRE (um cadastro só).
  { nome: "VEPPO", tipos: [], idsCadastro: [120018], apelidos: ["VEPPO", "ESTACAO RODOVIARIA CENTRAL DE PORTO ALEGRE"] }
];

const normalizarApelido = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** O grupo do despacho, ou `null` quando nenhum grupo reconhece (segue pelo nome gravado). */
export function grupoDaTransportadora(d: {
  transportadora_nome: string | null;
  tipo_frete: string | null;
  id_transportadora_cliente: number | null;
}): string | null {
  const tipo = (d.tipo_frete ?? "").trim().toUpperCase();
  if (tipo) {
    const g = GRUPOS_TRANSPORTADORA.find((x) => x.tipos.includes(tipo));
    if (g) return g.nome;
  }
  if (d.id_transportadora_cliente !== null && d.id_transportadora_cliente !== undefined) {
    const id = Number(d.id_transportadora_cliente);
    const g = GRUPOS_TRANSPORTADORA.find((x) => x.idsCadastro.includes(id));
    if (g) return g.nome;
  }
  const nome = normalizarApelido(d.transportadora_nome ?? "");
  if (!nome) return null;
  return GRUPOS_TRANSPORTADORA.find((x) => x.apelidos.some((a) => normalizarApelido(a) === nome))?.nome ?? null;
}

type Despacho = {
  id_int: number;
  transportadora_nome: string | null;
  tipo_frete: string | null;
  id_transportadora_cliente: number | null;
  modalidade_frete: string | null;
  data_despacho: string;
};

type Dados = { despachos: Despacho[]; fretes: Record<string, number | null> };

const ROTULO_MODALIDADE: Record<string, string> = { CIF: "CIF", FOB: "FOB", RETIRA: "Retira" };
const rotuloModalidade = (m: string | null) => (m ? ROTULO_MODALIDADE[m] ?? m : "Sem modalidade");
const plural = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;
const arred = (n: number) => Math.round(n * 100) / 100;

async function consultar(
  supabase: Parameters<NonNullable<RelatorioDef["consultar"]>>[0],
  { inicio, fim, filtros }: Parameters<NonNullable<RelatorioDef["consultar"]>>[1]
) {
  // Dia de São Paulo (UTC-3, sem horário de verão), extremos inclusos.
  const de = `${inicio}T00:00:00-03:00`;
  const ate = `${addDays(fim, 1)}T00:00:00-03:00`;

  const despachos: Despacho[] = [];
  for (let pagina = 0; ; pagina++) {
    if (pagina >= MAX_PAGINAS) {
      return { data: null, error: { code: "LIMITE", message: "Muitos despachos no período." } };
    }
    let consulta = supabase
      .from("expedicoes")
      .select("id_int,transportadora_nome,tipo_frete,id_transportadora_cliente,modalidade_frete,data_despacho")
      .not("data_despacho", "is", null)
      .gte("data_despacho", de)
      .lt("data_despacho", ate);
    if (filtros.modalidade === "SEM") consulta = consulta.is("modalidade_frete", null);
    else if (filtros.modalidade) consulta = consulta.eq("modalidade_frete", filtros.modalidade);

    const { data, error } = await consulta
      .order("data_despacho", { ascending: true })
      .order("id_int", { ascending: true })
      .range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1);
    if (error) return { data: null, error };
    despachos.push(...((data ?? []) as Despacho[]));
    if ((data ?? []).length < TAMANHO_PAGINA) break;
  }

  // Frete cobrado de cada pedido, como gravado na proposta.
  const ids = [...new Set(despachos.map((d) => d.id_int))];
  const fretes: Record<string, number | null> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("propostas")
      .select("id_int,valor_frete")
      .in("id_int", ids.slice(i, i + 200));
    if (error) return { data: null, error };
    for (const p of (data ?? []) as Array<{ id_int: number; valor_frete: number | string | null }>) {
      fretes[String(p.id_int)] = p.valor_frete === null ? null : Number(p.valor_frete);
    }
  }

  return { data: { despachos, fretes } satisfies Dados, error: null };
}

type Grupo = {
  transportadora: string;
  modalidade: string;
  pedidos: number;
  frete_zero: number;
  frete: number;
};

function normalizar(resposta: unknown): ResultadoRelatorio {
  const { despachos = [], fretes = {} } = (resposta ?? {}) as Partial<Dados>;

  const grupos = new Map<string, Grupo>();
  const cifZero: number[] = [];
  const retiraFobComFrete: string[] = [];
  let totalFrete = 0;
  let totalZero = 0;

  // Nomes gravados que cada grupo juntou, com a contagem, para o aviso de conferência.
  const nomesPorGrupo = new Map<string, Map<string, number>>();

  for (const d of despachos) {
    const gravado = (d.transportadora_nome ?? "").trim() || "(sem transportadora)";
    const grupo = grupoDaTransportadora(d);
    if (grupo) {
      const nomes = nomesPorGrupo.get(grupo) ?? new Map<string, number>();
      nomes.set(gravado, (nomes.get(gravado) ?? 0) + 1);
      nomesPorGrupo.set(grupo, nomes);
    }
    const nome = grupo ?? gravado;
    const modalidade = rotuloModalidade(d.modalidade_frete);
    const chave = `${nome.toUpperCase()}|${modalidade}`;
    const frete = Number(fretes[String(d.id_int)] ?? 0);

    const g = grupos.get(chave) ?? { transportadora: nome, modalidade, pedidos: 0, frete_zero: 0, frete: 0 };
    g.pedidos += 1;
    g.frete += frete;
    if (frete <= 0) {
      g.frete_zero += 1;
      totalZero += 1;
      if (d.modalidade_frete === "CIF") cifZero.push(d.id_int);
    } else if (d.modalidade_frete === "RETIRA" || d.modalidade_frete === "FOB") {
      retiraFobComFrete.push(`${d.id_int} (${modalidade}, ${formatCurrency(frete)})`);
    }
    grupos.set(chave, g);
    totalFrete += frete;
  }

  totalFrete = arred(totalFrete);
  const linhas: LinhaRelatorio[] = [...grupos.values()]
    .map((g) => ({
      transportadora: g.transportadora,
      modalidade: g.modalidade,
      pedidos: g.pedidos,
      frete_zero: g.frete_zero,
      frete: arred(g.frete),
      pct: totalFrete > 0 ? arred((g.frete / totalFrete) * 100) : 0
    }))
    .sort((a, b) => Number(b.frete) - Number(a.frete) || Number(b.pedidos) - Number(a.pedidos));

  const avisos: string[] = [];
  if (cifZero.length > 0) {
    avisos.push(
      `Pedidos CIF com frete zero (parte pode ser frete subsidiado): ${cifZero.length} — ${cifZero.slice(0, 40).join(", ")}${cifZero.length > 40 ? "…" : ""}.`
    );
  }
  if (retiraFobComFrete.length > 0) {
    avisos.push(`Pedidos Retira ou FOB com frete cobrado na proposta: ${retiraFobComFrete.join("; ")}.`);
  }
  for (const g of GRUPOS_TRANSPORTADORA) {
    const nomes = nomesPorGrupo.get(g.nome);
    if (!nomes) continue;
    const lista = [...nomes]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([n, q]) => `${n} (${plural(q, "despacho", "despachos")})`)
      .join(", ");
    avisos.push(`Grupo ${g.nome} juntou os nomes gravados: ${lista}.`);
  }

  const pedidos = despachos.length;
  return {
    linhas,
    total: {
      transportadora: plural(linhas.length, "linha", "linhas"),
      pedidos,
      frete_zero: totalZero,
      frete: totalFrete,
      pct: totalFrete > 0 ? 100 : 0
    },
    avisos,
    extras: { cif_zero: cifZero.length },
    cards: [
      {
        titulo: "Pedidos despachados",
        valor: String(pedidos),
        descricao: "Despachos com data no período.",
        tom: "info"
      },
      {
        titulo: "Frete cobrado",
        valor: formatCurrency(totalFrete),
        descricao: "Soma do frete das propostas despachadas.",
        tom: "success"
      },
      {
        titulo: "Com frete zero",
        valor: String(totalZero),
        descricao: `${plural(cifZero.length, "é CIF", "são CIF")} (possível subsídio); o resto é Retira ou FOB.`,
        tom: "warning"
      },
      {
        titulo: "Frete médio",
        valor: formatCurrency(pedidos - totalZero > 0 ? totalFrete / (pedidos - totalZero) : 0),
        descricao: "Por pedido com frete cobrado.",
        tom: "neutral"
      }
    ]
  };
}

const COLUNAS_PDF: ColunaPdf[] = [
  { titulo: "Transportadora", largura: 38 },
  { titulo: "Modalidade", largura: 14 },
  { titulo: "Pedidos", largura: 10, alinhamento: "right" },
  { titulo: "Frete zero", largura: 11, alinhamento: "right" },
  { titulo: "Frete cobrado", largura: 15, alinhamento: "right" },
  { titulo: "% do total", largura: 12, alinhamento: "right" }
];

const pct = (v: unknown) =>
  `${Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

function montarPdf(
  resultado: ResultadoRelatorio,
  contexto: Parameters<NonNullable<RelatorioDef["pdf"]>["montar"]>[1]
): ModeloPdf {
  const { inicio, fim } = contexto.consulta;
  const t = resultado.total;
  return {
    titulo: "Frete cobrado por transportadora",
    empresa: "Todas as empresas",
    periodo: `Despacho de ${formatDataCivil(inicio)} a ${formatDataCivil(fim)}`,
    filtros: contexto.filtros,
    criterio:
      "Frete COBRADO do cliente (o valor de frete gravado na proposta, sem recalcular), não o custo pago à transportadora, que o ERP não registra. Período pela data de despacho; transportadora e modalidade são as do despacho. Retira e FOB entram com o frete que a proposta tiver (normalmente zero). Nomes da mesma transportadora (Correios, Motoboy, VEPPO) são somados numa linha; os nomes juntados estão nas notas.",
    secoes: [
      {
        titulo: `Por transportadora e modalidade — ${plural(resultado.linhas.length, "linha", "linhas")}`,
        colunas: COLUNAS_PDF,
        linhas: resultado.linhas.map((l) => [
          String(l.transportadora),
          String(l.modalidade),
          String(l.pedidos),
          String(l.frete_zero),
          formatCurrency(Number(l.frete)),
          pct(l.pct)
        ]),
        linhaTotal: [
          "Total geral",
          "",
          String(t.pedidos),
          String(t.frete_zero),
          formatCurrency(Number(t.frete)),
          pct(t.pct)
        ]
      }
    ],
    resumo: [],
    notas: resultado.avisos,
    geradoEm: contexto.geradoEm,
    geradoPor: contexto.geradoPor
  };
}

export const fretePorTransportadora: RelatorioDef = {
  slug: "frete-por-transportadora",
  area: "expedicao",
  titulo: "Frete cobrado por transportadora",
  descricao:
    "Frete cobrado dos clientes nos pedidos despachados no período, por transportadora e modalidade. Não é o custo pago à transportadora.",
  permissao: "relatorios.frete_por_transportadora",

  dataReferencia: {
    rotulo: "Data de despacho",
    criterio:
      "Conta o dia em que o pedido foi despachado (dia de São Paulo). Transportadora e modalidade são as do despacho, não as do orçamento. O valor é o frete gravado na proposta (o que foi cobrado do cliente), sem recalcular — não é o custo pago à transportadora, que o ERP não registra. Retira e FOB entram com o frete da proposta, normalmente zero, e cada combinação de transportadora e modalidade aparece em linha própria. Nomes diferentes da mesma transportadora (Correios, Motoboy, VEPPO) são somados numa linha, e o aviso lista os nomes juntados."
  },

  periodo: { presets: ["mes", "mes_anterior", "custom"], padrao: "mes", maxDias: 366 },

  filtros: [
    {
      chave: "modalidade",
      rotulo: "Modalidade",
      todasRotulo: "Todas as modalidades",
      opcoes: [
        { valor: "CIF", rotulo: "CIF" },
        { valor: "FOB", rotulo: "FOB" },
        { valor: "RETIRA", rotulo: "Retira" },
        { valor: "SEM", rotulo: "Sem modalidade" }
      ]
    }
  ],

  colunas: [
    { id: "transportadora", titulo: "Transportadora", tipo: "texto" },
    { id: "modalidade", titulo: "Modalidade", tipo: "texto" },
    { id: "pedidos", titulo: "Pedidos", tipo: "inteiro" },
    { id: "frete_zero", titulo: "Com frete zero", tipo: "inteiro" },
    { id: "frete", titulo: "Frete cobrado", tipo: "moeda" },
    { id: "pct", titulo: "% do total", tipo: "percentual" }
  ],
  ordenacaoPadrao: { coluna: "frete", direcao: "desc" },

  consultar,
  normalizar,

  pdf: {
    nomeArquivo: ({ inicio, fim }) => `frete-cobrado-por-transportadora_${inicio}_a_${fim}.pdf`,
    montar: montarPdf
  }
};
