/**
 * maestro-simple-pagamentos.server.ts
 *
 * Adapter server-side read-only para consultas de faturamento/recebimento real.
 * Fase 2 — Inteligência Comercial e Financeira por id_cliente.
 *
 * REGRA FUNDAMENTAL DE RECEBIMENTO:
 *   confirmado = true
 *   status = 'PAID'
 *   paid_at is not null
 *
 * Fonte: public.pagamentos_v2
 * Modo: somente leitura — nunca INSERT, UPDATE, DELETE ou UPSERT.
 *
 * ⚠️  Roda exclusivamente no servidor (via API route) — preserva RLS com auth.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { contaNoFaturamento } from '@/features/cobrancas/cobrancas-utils';
import { CRITERIO_VENDA_DE_TESTE, lerPropostasDeTeste } from './maestro-venda-de-teste';
import type { MaestroPeriodo } from './maestro-simple-intents';
import { exigirClienteNoEscopo, soLinhasDoVendedor } from '../agent/maestro-agent-escopo.server';

// Colunas seguras — sem dados sensíveis de token, url ou pix
const PAGAMENTOS_COLS = 'id_int, status, valor, paid_at, criado_em:created_at';

// ─── Tipos Exportados ──────────────────────────────────────────────────────

export interface RecebimentoSimples {
  id_int: number | null;
  status: string | null;
  valor: number | null;
  paid_at: string;
}

export interface RecebimentosResult {
  found: boolean;
  items: RecebimentoSimples[];
  count: number;
  totalValor?: number;
  periodo?: string;
  source: string;
  authError?: boolean;
  error?: string;
}

// ─── Helpers Internos ─────────────────────────────────────────────────────

function mapPagamento(row: Record<string, unknown>): RecebimentoSimples {
  return {
    id_int:         row.id_int != null ? Number(row.id_int) : null,
    status:         typeof row.status === 'string' ? row.status : null,
    valor:          row.valor != null ? Number(row.valor) : null,
    paid_at:        String(row.paid_at),
  };
}

function isAuthError(err: unknown): boolean {
  const e = err as Record<string, unknown>;
  const msg = String(e?.message ?? '').toLowerCase();
  return e?.code === 'PGRST301' || e?.code === '42501' || msg.includes('jwt') || msg.includes('permission');
}

// ─── Helpers de Data (UTC para consistência com Supabase) ─────────────────

function primeiroDiaMesAtual(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString();
}

function menosNDias(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

function primeiroDiaMesPassado(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1)).toISOString();
}

// ─── FATURAMENTO OFICIAL (regra de negócio, 2026-07-26) ───────────────────
// Faturamento, vendas, comissão e metas vêm de public.pagamentos_v2:
//   confirmado = true AND status IN ('PAID','A_VENCER'), período por
//   data_confirmacao; soma por id_int; propostas = count distinct id_int.
// public.propostas é usada APENAS como dimensão (vendedor, cliente).
// ⚠️ NUNCA usar propostas.created_at/status_interno/valor_total como fonte
//    de faturamento mensal.
// Validado em 26/07/2026: André Toniazzo julho/2026 = 256 propostas,
// R$ 177.803,45 (gabarito do negócio).

export interface FaturamentoVendedorAgregado {
  vendedor: string;
  /** Cobranças confirmadas — uma proposta pode ter mais de uma */
  cobrancas: number;
  propostas: number;
  faturamento: number;
}

export interface FaturamentoEmpresaAgregado {
  /** null = pagamentos SEM id_empresa (sinalizados, nunca descartados) */
  id_empresa: number | null;
  empresa: string | null;
  /** Cobranças confirmadas da empresa no período */
  cobrancas: number;
  propostas: number;
  faturamento: number;
  vendedores: FaturamentoVendedorAgregado[];
}

export interface FaturamentoOficialResult {
  found: boolean;
  /** Nome da medida, para o modelo dizer o que o número é (e o que não é) */
  medida: string;
  /** Instrução de apresentação, junto do dado: o modelo tende a omitir as contagens */
  como_apresentar: string;
  periodo: string;
  /** Primeiro e último dia do período, no calendário de Brasília (dd/mm/aaaa) */
  dias?: { inicio: string; fim: string };
  criterio: string;
  /** Cobranças (pagamentos) confirmadas no período — o mesmo "N pagamentos confirmados" do Dashboard */
  total_cobrancas: number;
  /** Propostas distintas com cobrança confirmada no período */
  total_propostas: number;
  /** Soma das cobranças confirmadas (PAID/A_VENCER) no período */
  faturamento: number;
  /** Ranking — presente apenas quando agruparPorVendedor=true */
  por_vendedor?: FaturamentoVendedorAgregado[];
  /** Subtotais por empresa (id_empresa de pagamentos_v2) com vendedores dentro — quando agruparPorEmpresa=true */
  por_empresa?: FaturamentoEmpresaAgregado[];
  /** Contagens por empresa podem se sobrepor (proposta paga em 2 empresas) */
  nota_contagem?: string;
  /** Filtro de vendedor ambíguo (mais de um nome correspondente) */
  aviso?: string;
  /** Presente só quando `truncado` — texto pronto para o modelo repassar ao usuário. */
  aviso_truncamento?: string;
  /** true = a leitura linha a linha parou no teto de segurança antes do fim */
  truncado: boolean;
  /** Linhas de pagamentos_v2 lidas (antes de tirar cortesia) */
  linhas_lidas?: number;
  /** De onde saiu o total e se a soma linha a linha confere com a visão do Dashboard */
  conferencia?: { fonte_do_total: string; soma_linha_a_linha: number; confere: boolean };
  source: string;
  authError?: boolean;
  error?: string;
}

/**
 * Teto de linhas de UMA leitura do PostgREST deste projeto: ele corta em 1.000
 * por requisição e devolve HTTP 200 sem aviso (medido em produção em
 * 27/08/2026, com `.limit()` e com `Range:`).
 *
 * ATÉ 02/10/2026 a consulta fazia UMA leitura só. Todo mês desde maio/2026 tem
 * mais de 1.000 cobranças confirmadas, então o faturamento mensal saía cortado:
 * setembro/2026 respondeu R$ 780.657,05 quando o Dashboard mostra
 * R$ 1.121.100,46 (as 333 cobranças de 01/09 a 09/09 ficaram de fora). E o aviso
 * de incompleto não disparou, porque contava as linhas DEPOIS de tirar as
 * cortesias (1.000 lidas − 11 = 989 < 1.000).
 *
 * AGORA a leitura é paginada até o fim, e o total do consolidado sai da mesma
 * visão que o Dashboard usa.
 */
const PAGINA = 1000;
/** Teto de segurança: 40 páginas = 40 mil cobranças (mais de dois anos no volume atual). */
const MAX_PAGINAS = 40;
const FATURAMENTO_LOTE_PROPOSTAS = 400;

/**
 * Texto que acompanha `truncado`. Existe porque um booleano no meio de vinte
 * campos nao chega a quem le o numero: quem redige a resposta e o modelo, e ele
 * precisa de uma instrucao explicita, nao de uma flag.
 */
export const AVISO_FATURAMENTO_TRUNCADO =
  'ATENCAO — RESULTADO INCOMPLETO: o periodo tem mais cobrancas do que o teto de leitura desta consulta. ' +
  'A contagem de propostas e os numeros por vendedor estao SUBESTIMADOS. NAO os apresente como o resultado do periodo: ' +
  'diga que o periodo e grande demais para uma consulta e sugira uma janela menor (um mes, por exemplo).';

export const MEDIDA_FATURAMENTO =
  'FATURAMENTO: cobranças confirmadas pelo financeiro (pagas ou faturadas a vencer), pela data da confirmação, sem amostra, sem retrabalho e sem pedidos de teste. ' +
  'É o mesmo número do card Faturamento do Dashboard. NÃO é o dinheiro que entrou em caixa (isso é o recebimento, pela data do pagamento).';

export const CRITERIO_FATURAMENTO_OFICIAL =
  'pagamentos_v2 com confirmado=true e status PAID ou A_VENCER, período por data_confirmacao no calendário de Brasília; ' +
  'faturamento = soma das cobranças; cobranças = pagamentos confirmados; propostas = id_int distintos. propostas é só dimensão (vendedor/cliente). ' +
  'Exclui E-AMOSTRA e E-RETRABALHO (cortesia, não receita); E-PERMUTA e E-CREDITO contam. ' +
  CRITERIO_VENDA_DE_TESTE;

// ─── Período em dia de Brasília ────────────────────────────────────────────

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diaBR(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}

/**
 * Converte um limite de período (ISO) no DIA civil de Brasília.
 *
 * Os chamadores montam mês como "meia-noite UTC do dia 1" (2026-09-01T00:00Z).
 * Lido ao pé da letra, isso é 21h do dia 31/08 em Brasília — o mês começava e
 * terminava três horas antes da hora, e dois PIX de 30/09 às 23h iam para
 * outubro. Aqui meia-noite UTC significa "esse dia do calendário"; qualquer
 * outro instante (hoje, ontem, últimos N dias) vale pelo dia em que cai em
 * Brasília.
 */
export function diaCivilDoLimite(iso: string): string {
  const meiaNoiteUtc = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?Z$/.exec(iso.trim());
  if (meiaNoiteUtc) return meiaNoiteUtc[1];
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(instante);
}

/** [desde, ate) em ISO → primeiro e último dia (inclusive) no calendário de Brasília. */
export function diasCivisDoIntervalo(desde: string, ate?: string, agora: Date = new Date()): { diaInicio: string; diaFim: string } {
  const diaInicio = diaCivilDoLimite(desde);
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
  const diaFim = ate ? somarDias(diaCivilDoLimite(ate), -1) : hoje;
  return { diaInicio, diaFim: diaFim < diaInicio ? diaInicio : diaFim };
}

// ─── Leituras ──────────────────────────────────────────────────────────────

interface LinhaPagamento {
  id_int: number | null;
  valor: number;
  id_empresa: number | null;
  empresaLabel: string | null;
}

/** Todas as cobranças confirmadas do período, página a página, até acabar. */
async function lerCobrancasConfirmadas(
  supabase: SupabaseClient,
  filtro: { diaInicio: string; diaFim: string; idCliente?: number; idEmpresa?: number; maxPaginas: number },
): Promise<{ linhas: Record<string, unknown>[]; truncado: boolean; error?: { message: string } }> {
  // O Brasil não tem horário de verão desde 2019: Brasília é UTC-3 o ano todo.
  const inicio = `${filtro.diaInicio}T00:00:00-03:00`;
  const fim = `${somarDias(filtro.diaFim, 1)}T00:00:00-03:00`;
  const linhas: Record<string, unknown>[] = [];

  for (let pagina = 0; pagina < filtro.maxPaginas; pagina++) {
    // `tipo_cobranca` entra no SELECT só para a exclusão de cortesia, em memória.
    let query = supabase
      .from('pagamentos_v2')
      .select('id, id_int, id_cliente, valor, data_confirmacao, id_empresa, empresa, tipo_cobranca')
      .eq('confirmado', true)
      .in('status', ['PAID', 'A_VENCER'])
      .not('data_confirmacao', 'is', null)
      .gte('data_confirmacao', inicio)
      .lt('data_confirmacao', fim);
    if (filtro.idCliente != null) query = query.eq('id_cliente', filtro.idCliente);
    if (filtro.idEmpresa != null) query = query.eq('id_empresa', filtro.idEmpresa);

    const { data, error } = await query
      .order('data_confirmacao', { ascending: false })
      .order('id', { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error) return { linhas, truncado: false, error };

    const lote = (data ?? []) as unknown as Record<string, unknown>[];
    linhas.push(...lote);
    if (lote.length < PAGINA) return { linhas, truncado: false };
  }
  // Saiu pelo teto com a última página cheia: pode haver mais.
  return { linhas, truncado: true };
}

/**
 * Total do período pela visão que o Dashboard usa (view_pagamentos_pagos_v2):
 * a mesma regra, somada pelo banco, por dia de Brasília e por empresa.
 */
async function lerVisaoDoDashboard(
  supabase: SupabaseClient,
  filtro: { diaInicio: string; diaFim: string; idEmpresa?: number },
): Promise<{ total: number; cobrancas: number; porEmpresa: Map<number | null, { total: number; cobrancas: number }>; error?: string }> {
  const porEmpresa = new Map<number | null, { total: number; cobrancas: number }>();
  let total = 0;
  let cobrancas = 0;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    let query = supabase
      .from('view_pagamentos_pagos_v2')
      .select('data, id_empresa, status, total, quantidade')
      .gte('data', filtro.diaInicio)
      .lte('data', filtro.diaFim);
    if (filtro.idEmpresa != null) query = query.eq('id_empresa', filtro.idEmpresa);

    const { data, error } = await query
      .order('data', { ascending: true })
      .order('id_empresa', { ascending: true })
      .order('status', { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error) return { total: 0, cobrancas: 0, porEmpresa, error: error.message };

    const lote = (data ?? []) as unknown as Record<string, unknown>[];
    for (const r of lote) {
      const valor = r.total != null ? Number(r.total) : 0;
      const qtd = r.quantidade != null ? Number(r.quantidade) : 0;
      const empresa = r.id_empresa != null && Number.isFinite(Number(r.id_empresa)) ? Number(r.id_empresa) : null;
      total += valor;
      cobrancas += qtd;
      const agg = porEmpresa.get(empresa) ?? { total: 0, cobrancas: 0 };
      agg.total += valor;
      agg.cobrancas += qtd;
      porEmpresa.set(empresa, agg);
    }
    if (lote.length < PAGINA) break;
  }

  return { total, cobrancas, porEmpresa };
}

function centavos(n: number): number {
  return Number(n.toFixed(2));
}

export async function calcularFaturamentoOficial(
  supabase: SupabaseClient,
  opts: {
    /** Início do período (ISO). Vale o DIA de Brasília — ver diaCivilDoLimite. */
    desde: string;
    /** Fim exclusivo do período (ISO). Ausente = até hoje. */
    ate?: string;
    periodoLabel: string;
    idCliente?: number;
    /** Filtra um vendedor pelo nome (via propostas — match parcial, case-insensitive) */
    vendedorNome?: string;
    /** Devolve o ranking por vendedor */
    agruparPorVendedor?: boolean;
    /** Filtra uma empresa (pagamentos_v2.id_empresa — NUNCA a empresa do cadastro do cliente) */
    idEmpresa?: number;
    /** Subtotais por empresa com vendedores dentro de cada uma */
    agruparPorEmpresa?: boolean;
    /** Teto de páginas de 1.000 linhas. Só para teste; o padrão é MAX_PAGINAS. */
    maxPaginas?: number;
  },
): Promise<FaturamentoOficialResult> {
  const { diaInicio, diaFim } = diasCivisDoIntervalo(opts.desde, opts.ate);
  const base = {
    medida: MEDIDA_FATURAMENTO,
    como_apresentar:
      'Mostre SEMPRE três números: o valor (faturamento), as cobranças (total_cobrancas) e as propostas (total_propostas) — no total e, quando houver, em cada empresa e em cada vendedor listado (campos cobrancas e propostas). ' +
      'Diga o período pelos dias (campo dias) e nomeie a medida em uma linha. Não some nem conte: os números já vêm prontos.',
    periodo: opts.periodoLabel,
    dias: { inicio: diaBR(diaInicio), fim: diaBR(diaFim) },
    criterio: CRITERIO_FATURAMENTO_OFICIAL,
    source: 'public.pagamentos_v2 (fonte; empresa = id_empresa) + public.propostas (dimensão vendedor) + view_pagamentos_pagos_v2 (total, a mesma do Dashboard)',
  };
  const falha = (error: { message: string }): FaturamentoOficialResult => ({
    ...base, found: false, total_cobrancas: 0, total_propostas: 0, faturamento: 0, truncado: false,
    authError: isAuthError(error), error: error.message,
  });

  // Consulta POR CLIENTE passa pela trava de vendedor; a consulta por vendedor
  // ou ranking (sem cliente) tem o seu próprio recorte, em quem chama.
  const escopo = opts.idCliente != null ? await exigirClienteNoEscopo(supabase, opts.idCliente) : null;

  const leitura = await lerCobrancasConfirmadas(supabase, {
    diaInicio,
    diaFim,
    idCliente: opts.idCliente,
    idEmpresa: opts.idEmpresa,
    maxPaginas: Math.max(1, opts.maxPaginas ?? MAX_PAGINAS),
  });
  if (leitura.error) return falha(leitura.error);

  // Cortesia não é receita. A exclusão é feita AQUI, em memória, e não como
  // `.not('tipo_cobranca','in',...)` na consulta: no PostgREST um NOT IN sobre
  // coluna nula devolve NULL e a linha some — e linha sem tipo TEM de contar,
  // como em `public.fn_conta_no_faturamento`. Filtrar depois é o único jeito
  // de as duas pontas darem o mesmo número.
  const doEscopo = escopo ? await soLinhasDoVendedor(supabase, escopo, leitura.linhas) : leitura.linhas;

  // Venda de teste não é faturamento (decisão do dono, 02/10/2026). A visão do
  // Dashboard já as tira; aqui sai a mesma lista, para o detalhe por vendedor e
  // por empresa fechar com o total. Sem a lista não há número confiável: falha.
  const deTeste = await lerPropostasDeTeste(supabase);
  if (deTeste.error) return falha(deTeste.error);
  const ehDeTeste = (r: Record<string, unknown>) =>
    r.id_int != null && deTeste.ids.has(Number(r.id_int));

  const pagamentos: LinhaPagamento[] = doEscopo
    .filter(r => contaNoFaturamento(r.tipo_cobranca as string | null | undefined) && !ehDeTeste(r))
    .map(r => ({
      id_int: r.id_int != null && Number.isFinite(Number(r.id_int)) ? Number(r.id_int) : null,
      valor: r.valor != null ? Number(r.valor) : 0,
      id_empresa: r.id_empresa != null && Number.isFinite(Number(r.id_empresa)) ? Number(r.id_empresa) : null,
      empresaLabel: typeof r.empresa === 'string' && r.empresa.trim() ? r.empresa.trim() : null,
    }));

  // Dimensão vendedor (propostas), somente quando necessária
  // (na separação por empresa os vendedores aparecem dentro de cada empresa)
  const precisaVendedor =
    Boolean(opts.vendedorNome) || opts.agruparPorVendedor === true || opts.agruparPorEmpresa === true;
  const vendedorPorProposta = new Map<number, string>();
  if (precisaVendedor && pagamentos.length > 0) {
    const ids = [...new Set(pagamentos.map(p => p.id_int).filter((id): id is number => id !== null))];
    for (let i = 0; i < ids.length; i += FATURAMENTO_LOTE_PROPOSTAS) {
      const lote = ids.slice(i, i + FATURAMENTO_LOTE_PROPOSTAS);
      const { data: props, error: perr } = await supabase
        .from('propostas')
        .select('id_int, vendedor')
        .in('id_int', lote);
      if (perr) return falha(perr);
      for (const raw of props ?? []) {
        const r = raw as Record<string, unknown>;
        const nome = typeof r.vendedor === 'string' && r.vendedor.trim() ? r.vendedor.trim() : 'SEM_VENDEDOR';
        vendedorPorProposta.set(Number(r.id_int), nome);
      }
    }
  }

  // Match de nome sem acento; preferência por igualdade exata ("Andre" não
  // pode agregar Alexandre junto com André silenciosamente)
  const normalizar = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filtroNome = opts.vendedorNome?.trim() ? normalizar(opts.vendedorNome) : undefined;
  let vendedoresFiltrados: Set<string> | null = null;
  if (filtroNome) {
    const nomes = [...new Set(vendedorPorProposta.values())];
    const exatos = nomes.filter(n => normalizar(n) === filtroNome);
    const parciais = nomes.filter(n => normalizar(n).includes(filtroNome));
    vendedoresFiltrados = new Set(exatos.length > 0 ? exatos : parciais);
  }
  // Filtro ambíguo (mais de um vendedor) → devolve separado por vendedor,
  // nunca uma soma mesclada sem aviso
  const agrupar = opts.agruparPorVendedor === true || (vendedoresFiltrados?.size ?? 0) > 1;

  interface Agg { cobrancas: number; propostasSet: Set<number>; faturamento: number }
  const novoAgg = (): Agg => ({ cobrancas: 0, propostasSet: new Set<number>(), faturamento: 0 });
  const somarEm = (agg: Agg, pg: LinhaPagamento) => {
    agg.cobrancas++;
    if (pg.id_int !== null) agg.propostasSet.add(pg.id_int);
    agg.faturamento += pg.valor;
  };

  const geral = novoAgg();
  const porVendedor = new Map<string, Agg>();
  interface EmpresaAgg extends Agg {
    id_empresa: number | null;
    empresa: string | null;
    vendedores: Map<string, Agg>;
  }
  const porEmpresa = new Map<string, EmpresaAgg>();

  for (const pg of pagamentos) {
    const vendedor = precisaVendedor
      ? (pg.id_int !== null ? vendedorPorProposta.get(pg.id_int) : undefined) ?? 'SEM_VENDEDOR'
      : null;
    if (vendedoresFiltrados && !vendedoresFiltrados.has(vendedor ?? '')) continue;

    somarEm(geral, pg);

    if (agrupar && vendedor !== null) {
      const agg = porVendedor.get(vendedor) ?? novoAgg();
      somarEm(agg, pg);
      porVendedor.set(vendedor, agg);
    }

    if (opts.agruparPorEmpresa === true) {
      // Pagamentos SEM id_empresa entram no grupo próprio — nunca descartados
      const chave = pg.id_empresa != null ? `emp:${pg.id_empresa}` : 'emp:sem';
      const emp = porEmpresa.get(chave) ?? {
        ...novoAgg(),
        id_empresa: pg.id_empresa,
        empresa: pg.id_empresa != null ? pg.empresaLabel : 'SEM id_empresa (pagamentos sem empresa atribuída)',
        vendedores: new Map<string, Agg>(),
      };
      if (!emp.empresa && pg.empresaLabel) emp.empresa = pg.empresaLabel;
      somarEm(emp, pg);
      if (vendedor !== null) {
        const ve = emp.vendedores.get(vendedor) ?? novoAgg();
        somarEm(ve, pg);
        emp.vendedores.set(vendedor, ve);
      }
      porEmpresa.set(chave, emp);
    }
  }

  const vendedorAgregado = (vendedor: string, v: Agg): FaturamentoVendedorAgregado => ({
    vendedor, cobrancas: v.cobrancas, propostas: v.propostasSet.size, faturamento: centavos(v.faturamento),
  });

  let empresas: FaturamentoEmpresaAgregado[] | undefined = opts.agruparPorEmpresa
    ? [...porEmpresa.values()].map(e => ({
        id_empresa: e.id_empresa,
        empresa: e.empresa,
        cobrancas: e.cobrancas,
        propostas: e.propostasSet.size,
        faturamento: centavos(e.faturamento),
        vendedores: [...e.vendedores.entries()]
          .map(([vendedor, v]) => vendedorAgregado(vendedor, v))
          .sort((a, b) => b.faturamento - a.faturamento),
      }))
    : undefined;

  // ── Total pela visão do Dashboard ──────────────────────────────────────────
  // Só no consolidado (sem cliente e sem filtro de vendedor): a visão não tem
  // essas duas dimensões. O valor e a contagem de cobranças passam a ser os
  // dela, por construção iguais aos do card Faturamento; a soma linha a linha
  // fica como conferência.
  const somaLinhas = centavos(geral.faturamento);
  let faturamento = somaLinhas;
  let totalCobrancas = geral.cobrancas;
  let conferencia: FaturamentoOficialResult['conferencia'];
  if (opts.idCliente == null && !vendedoresFiltrados) {
    const visao = await lerVisaoDoDashboard(supabase, { diaInicio, diaFim, idEmpresa: opts.idEmpresa });
    if (!visao.error) {
      faturamento = centavos(visao.total);
      totalCobrancas = visao.cobrancas;
      conferencia = {
        fonte_do_total: 'view_pagamentos_pagos_v2 (a mesma do card Faturamento do Dashboard)',
        soma_linha_a_linha: somaLinhas,
        confere: Math.abs(somaLinhas - faturamento) < 0.005 && geral.cobrancas === visao.cobrancas,
      };
      if (empresas) {
        const vistas = new Set<number | null>();
        empresas = empresas.map(e => {
          vistas.add(e.id_empresa);
          const v = visao.porEmpresa.get(e.id_empresa);
          return v ? { ...e, faturamento: centavos(v.total), cobrancas: v.cobrancas } : e;
        });
        // Empresa que a visão tem e a leitura linha a linha não alcançou (teto).
        for (const [idEmpresa, v] of visao.porEmpresa) {
          if (!vistas.has(idEmpresa)) {
            empresas.push({ id_empresa: idEmpresa, empresa: null, cobrancas: v.cobrancas, propostas: 0, faturamento: centavos(v.total), vendedores: [] });
          }
        }
      }
    } else {
      conferencia = { fonte_do_total: `soma linha a linha (visão do Dashboard indisponível: ${visao.error.slice(0, 80)})`, soma_linha_a_linha: somaLinhas, confere: true };
    }
  }

  // sem-empresa por último; demais por faturamento desc
  empresas?.sort((a, b) => (a.id_empresa === null ? 1 : b.id_empresa === null ? -1 : b.faturamento - a.faturamento));

  // Uma proposta com pagamentos em mais de uma empresa conta em cada grupo,
  // mas uma única vez no consolidado — sinalize quando as contagens divergirem
  const somaPropostasEmpresas = empresas?.reduce((acc, e) => acc + e.propostas, 0);

  return {
    ...base,
    found: totalCobrancas > 0,
    total_cobrancas: totalCobrancas,
    total_propostas: geral.propostasSet.size,
    faturamento,
    por_vendedor: agrupar
      ? [...porVendedor.entries()]
          .map(([vendedor, v]) => vendedorAgregado(vendedor, v))
          .sort((a, b) => b.faturamento - a.faturamento)
      : undefined,
    por_empresa: empresas,
    ...(empresas && somaPropostasEmpresas !== geral.propostasSet.size
      ? { nota_contagem: 'Proposta com pagamentos em mais de uma empresa conta em cada empresa, mas UMA única vez no total consolidado — por isso a soma das contagens difere do total.' }
      : {}),
    ...((vendedoresFiltrados?.size ?? 0) > 1
      ? { aviso: 'O nome informado corresponde a mais de um vendedor — números apresentados SEPARADOS por vendedor; o total soma todos os correspondentes.' }
      : {}),
    // O aviso conta as linhas LIDAS, antes de tirar cortesia e de aplicar
    // filtros: é a leitura que fica incompleta, não o resultado filtrado.
    ...(leitura.truncado ? { aviso_truncamento: AVISO_FATURAMENTO_TRUNCADO } : {}),
    truncado: leitura.truncado,
    linhas_lidas: leitura.linhas.length,
    ...(conferencia ? { conferencia } : {}),
  };
}

// ─── Perfil de pagamento (comportamento real) ─────────────────────────────

export interface PerfilPagamentoResult {
  found: boolean;
  /** Agregado por tipo_cobranca (PIX, BOLETO, CREDIT_CARD, CARD_PARCELADO...) */
  por_tipo_cobranca: Record<string, { quantidade: number; somaValor: number; ultimo_em: string | null }>;
  /** Condições a prazo registradas em forma_pgto (ex.: "Prazo 14 dias") */
  condicoes_prazo: Record<string, number>;
  total_pagamentos: number;
  totalValor: number;
  periodo: string;
  truncado: boolean;
  source: string;
  authError?: boolean;
  error?: string;
}

const PERFIL_MAX_ROWS = 1000;

/**
 * Como o cliente REALMENTE paga: agrega os pagamentos confirmados (PAID,
 * confirmado=true, por paid_at) por tipo_cobranca. Servidor agrega — o
 * consumidor nunca conta nem soma.
 */
export async function calcularPerfilPagamento(
  supabase: SupabaseClient,
  idCliente: number,
  dias = 365,
  /** Recorte por empresa (pagamentos_v2.id_empresa) — princípio permanente §1.0 */
  idEmpresa?: number,
): Promise<PerfilPagamentoResult> {
  const diasSeguro = Number.isFinite(dias) && dias > 0 && dias <= 1830 ? Math.floor(dias) : 365;
  const periodo = `últimos ${diasSeguro} dias`;

  const escopo = await exigirClienteNoEscopo(supabase, idCliente);
  let query = supabase
    .from('pagamentos_v2')
    .select('id_int, tipo_cobranca, forma_pgto, valor, paid_at')
    .eq('id_cliente', idCliente)
    .eq('confirmado', true)
    .eq('status', 'PAID')
    .not('paid_at', 'is', null)
    .gte('paid_at', menosNDias(diasSeguro));
  if (idEmpresa != null) query = query.eq('id_empresa', idEmpresa);

  const { data, error } = await query
    .order('paid_at', { ascending: false })
    .limit(PERFIL_MAX_ROWS);

  if (error) {
    return {
      found: false, por_tipo_cobranca: {}, condicoes_prazo: {}, total_pagamentos: 0,
      totalValor: 0, periodo, truncado: false, source: 'public.pagamentos_v2',
      authError: isAuthError(error), error: error.message,
    };
  }

  const porTipo: PerfilPagamentoResult['por_tipo_cobranca'] = {};
  const condicoesPrazo: Record<string, number> = {};
  let totalValor = 0;

  const linhasDoPerfil = await soLinhasDoVendedor(supabase, escopo, data ?? []);
  for (const raw of linhasDoPerfil) {
    const r = raw as Record<string, unknown>;
    const tipo = typeof r.tipo_cobranca === 'string' && r.tipo_cobranca.trim() ? r.tipo_cobranca.trim() : 'NAO_INFORMADO';
    const valor = r.valor != null ? Number(r.valor) : 0;
    const paidAt = typeof r.paid_at === 'string' ? r.paid_at : null;

    const agg = porTipo[tipo] ?? { quantidade: 0, somaValor: 0, ultimo_em: null };
    agg.quantidade++;
    agg.somaValor = Number((agg.somaValor + valor).toFixed(2));
    if (paidAt && (!agg.ultimo_em || paidAt > agg.ultimo_em)) agg.ultimo_em = paidAt;
    porTipo[tipo] = agg;
    totalValor += valor;

    const forma = typeof r.forma_pgto === 'string' ? r.forma_pgto.trim() : '';
    if (forma) condicoesPrazo[forma] = (condicoesPrazo[forma] ?? 0) + 1;
  }

  const total = linhasDoPerfil.length;
  return {
    found: total > 0,
    por_tipo_cobranca: porTipo,
    condicoes_prazo: condicoesPrazo,
    total_pagamentos: total,
    totalValor: Number(totalValor.toFixed(2)),
    periodo,
    truncado: (data ?? []).length >= PERFIL_MAX_ROWS,
    source: 'public.pagamentos_v2',
  };
}

// ─── Consultas Read-Only ──────────────────────────────────────────────────

/**
 * Calcula faturamento financeiro recebido do cliente em um período.
 * Usa paid_at como referência de data, confirmado = true e status = 'PAID'.
 */
export async function calcularRecebimentoPeriodo(
  supabase: SupabaseClient,
  idCliente: number,
  periodo: MaestroPeriodo,
  /** Recorte por empresa (pagamentos_v2.id_empresa) — princípio permanente §1.0 */
  idEmpresa?: number,
): Promise<RecebimentosResult> {
  let desde: string;
  let ate: string | null = null;
  const periodoLabel: string = periodo.label;

  if (periodo.tipo === 'dinamico' && periodo.start) {
    desde = periodo.start;
    if (periodo.end) ate = periodo.end;
  } else {
    switch (periodo.tipo) {
      case 'mes_atual':
        desde = primeiroDiaMesAtual();
        break;
      case 'mes_passado':
        desde = primeiroDiaMesPassado();
        ate   = primeiroDiaMesAtual();
        break;
      case 'ultimos_30_dias':
      default:
        desde = menosNDias(30);
    }
  }

  const escopo = await exigirClienteNoEscopo(supabase, idCliente);

  // `tipo_cobranca` só para a exclusão de cortesia; o critério de status desta
  // consulta (PAID puro) fica como estava.
  let query = supabase
    .from('pagamentos_v2')
    .select(`${PAGAMENTOS_COLS}, tipo_cobranca`)
    .eq('id_cliente', idCliente)
    .eq('confirmado', true)
    .eq('status', 'PAID')
    .not('paid_at', 'is', null)
    .gte('paid_at', desde);

  if (ate) {
    query = query.lt('paid_at', ate);
  }
  if (idEmpresa != null) {
    query = query.eq('id_empresa', idEmpresa);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[calcularRecebimentoPeriodo] Erro:', error);
    return {
      found: false,
      items: [],
      count: 0,
      periodo: periodoLabel,
      source: 'public.pagamentos_v2',
      authError: isAuthError(error),
      error: error.message,
    };
  }

  // Mesma exclusão de cortesia do faturamento oficial, e pelo mesmo motivo de
  // ser em memória (ver o comentário em calcularFaturamentoOficial).
  const linhas = (await soLinhasDoVendedor(supabase, escopo, data ?? [])).filter(raw =>
    contaNoFaturamento((raw as Record<string, unknown>).tipo_cobranca as string | null | undefined)
  );

  if (linhas.length === 0) {
    return {
      found: false,
      items: [],
      count: 0,
      totalValor: 0,
      periodo: periodoLabel,
      source: 'public.pagamentos_v2',
    };
  }

  const items = linhas.map(mapPagamento);
  const totalValor = items.reduce((sum, item) => sum + (item.valor ?? 0), 0);

  return {
    found: true,
    items,
    count: items.length,
    totalValor,
    periodo: periodoLabel,
    source: 'public.pagamentos_v2',
  };
}

export interface ComparacaoItem {
  label: string;
  startDate: string;
  endDate: string;
  count: number;
  totalValor: number;
}

export interface ComparacaoRecebimentosResult {
  found: boolean;
  idCliente: number;
  items: ComparacaoItem[];
  source: string;
  error?: string;
}

/**
 * Compara recebimentos financeiros do cliente em múltiplos meses/períodos.
 * Executa em paralelo as consultas para cada período.
 */
export async function compararRecebimentoClienteMeses(
  supabase: SupabaseClient,
  idCliente: number,
  meses: Array<{ startDate: string; endDate: string; label: string }>,
  /** Recorte por empresa (pagamentos_v2.id_empresa) — princípio permanente §1.0 */
  idEmpresa?: number,
): Promise<ComparacaoRecebimentosResult> {
  // Fora do try: a recusa de escopo tem de subir, e não virar um "erro" genérico.
  await exigirClienteNoEscopo(supabase, idCliente);
  try {
    const promises = meses.map(async (m) => {
      const res = await calcularRecebimentoPeriodo(supabase, idCliente, {
        tipo: 'dinamico',
        start: m.startDate,
        end: m.endDate,
        label: m.label,
      }, idEmpresa);
      return {
        label: m.label,
        startDate: m.startDate,
        endDate: m.endDate,
        count: res.count,
        totalValor: res.totalValor ?? 0,
      };
    });

    const items = await Promise.all(promises);
    return {
      found: true,
      idCliente,
      items,
      source: 'public.pagamentos_v2',
    };
  } catch (err) {
    console.error('[compararRecebimentoClienteMeses] Erro:', err);
    return {
      found: false,
      idCliente,
      items: [],
      source: 'public.pagamentos_v2',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

