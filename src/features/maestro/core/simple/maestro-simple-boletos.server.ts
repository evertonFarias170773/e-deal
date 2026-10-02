/**
 * maestro-simple-boletos.server.ts
 *
 * Adapter server-side read-only para consultas de boletos.
 * Fase 2 — Inteligência Financeira por id_cliente.
 *
 * Fonte: public.boletos
 * NÃO usa: pagamentos_v2 (sistema de pagamentos — diferente de cobrança)
 *
 * Campos NUNCA retornados (dados sensíveis de cobrança):
 *   linha_digitavel, codigo_barras, id_boleto_c6, url_pdf, pdf_storage,
 *   nosso_numero, ext_reference, msg_whats, texto_whatsapp
 *
 * REGRA ÚNICA (02/10/2026 — maestro-regra-titulos.ts), para as três consultas:
 *   em aberto      = sem pagamento e não cancelado, em qualquer status
 *                    (o "Substituído" do Refazer boleto é cancelado e não entra);
 *   em atraso      = em aberto com vencimento antes de hoje, em Brasília;
 *   não liquidado  = o mesmo que em aberto.
 * Uma leitura só busca os títulos em aberto do cliente; "em atraso" é um
 * recorte dela. Os totais (resumo) saem prontos, sobre TODOS os títulos em
 * aberto, e não só sobre os listados.
 *
 * Modo: somente leitura — nunca INSERT, UPDATE, DELETE ou UPSERT.
 * ⚠️  Roda exclusivamente no servidor (via API route) — preserva RLS com auth.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { exigirClienteNoEscopo, soLinhasDoVendedor } from '../agent/maestro-agent-escopo.server';
import {
  CRITERIO_TITULOS,
  diasDeAtraso,
  FILTRO_TITULO_NAO_CANCELADO,
  hojeEmBrasilia,
  tituloEmAberto,
} from './maestro-regra-titulos';

// Colunas seguras — sem linha digitável, código de barras ou URLs de pagamento
const BOLETOS_COLS = 'id_int, vencimento, valor, valor_atualizado, status, n_nf, paid_at';

/** Teto de uma leitura do PostgREST deste projeto. */
const MAX_LEITURA = 1000;
/** Quantos títulos vão listados; os totais do resumo cobrem todos. */
const MAX_ITENS = 30;

// ─── Tipos Exportados ──────────────────────────────────────────────────────

export interface BoletoSimples {
  id_int: number;
  vencimento: string | null;
  valor: number | null;
  valor_atualizado: number | null;
  status: string | null;
  /** Dias corridos depois do vencimento, pelo calendário de Brasília (0 = não venceu) */
  dias_atraso: number;
  em_atraso: boolean;
  n_nf: string | null;
  paid_at: string | null;
}

export interface ResumoDeTitulos {
  em_aberto: { quantidade: number; soma_valor: number };
  em_atraso: { quantidade: number; soma_valor: number };
}

export interface BoletosResult {
  found: boolean;
  items: BoletoSimples[];
  /** Quantos títulos atendem ao filtro pedido (todos, não só os listados) */
  count: number;
  /** Descrição do filtro aplicado para exibição */
  filtro: string;
  /** Totais prontos de TODOS os títulos em aberto do cliente */
  resumo?: ResumoDeTitulos;
  criterio?: string;
  /** true = há mais títulos do que os listados em `items` */
  lista_parcial?: boolean;
  /** Fonte da consulta — sempre 'public.boletos' */
  source: string;
  authError?: boolean;
  error?: string;
}

// ─── Helpers Internos ─────────────────────────────────────────────────────

function mapBoleto(row: Record<string, unknown>, hoje: string): BoletoSimples {
  const dias = diasDeAtraso(row, hoje);
  return {
    id_int:          Number(row.id_int),
    vencimento:      typeof row.vencimento === 'string' ? row.vencimento : null,
    valor:           row.valor != null ? Number(row.valor) : null,
    valor_atualizado: row.valor_atualizado != null ? Number(row.valor_atualizado) : null,
    status:          typeof row.status === 'string' ? row.status : null,
    dias_atraso:     dias,
    em_atraso:       dias > 0,
    n_nf:            typeof row.n_nf === 'string' ? row.n_nf : null,
    paid_at:         typeof row.paid_at === 'string' ? row.paid_at : null,
  };
}

function isAuthError(err: unknown): boolean {
  const e = err as Record<string, unknown>;
  const msg = String(e?.message ?? '').toLowerCase();
  return e?.code === 'PGRST301' || e?.code === '42501' || msg.includes('jwt') || msg.includes('permission');
}

function somar(titulos: BoletoSimples[], valor: (t: BoletoSimples) => number | null): number {
  return Math.round(titulos.reduce((total, t) => total + (valor(t) ?? 0), 0) * 100) / 100;
}

// ─── Leitura única ─────────────────────────────────────────────────────────

/**
 * Todos os títulos EM ABERTO do cliente, do vencimento mais antigo ao mais
 * novo, já passados pela trava de vendedor.
 */
async function lerTitulosEmAberto(
  supabase: SupabaseClient,
  idCliente: number,
): Promise<{ titulos: BoletoSimples[]; error?: { message: string } }> {
  const escopo = await exigirClienteNoEscopo(supabase, idCliente);
  const { data, error } = await supabase
    .from('boletos')
    .select(BOLETOS_COLS)
    .eq('id_cliente', idCliente)
    .is('paid_at', null)
    .or(FILTRO_TITULO_NAO_CANCELADO)
    .order('vencimento', { ascending: true })
    .limit(MAX_LEITURA);

  if (error) return { titulos: [], error };

  const hoje = hojeEmBrasilia();
  // O filtro da consulta já tira o cancelado; a regra é reaplicada aqui para
  // valer também para grafias fora do padrão (minúsculas, espaços).
  const emAberto = ((data ?? []) as unknown as Record<string, unknown>[]).filter(tituloEmAberto);
  const doVendedor = await soLinhasDoVendedor(supabase, escopo, emAberto);
  return { titulos: doVendedor.map(linha => mapBoleto(linha, hoje)) };
}

function resumir(titulos: BoletoSimples[]): ResumoDeTitulos {
  const atrasados = titulos.filter(t => t.em_atraso);
  return {
    // Em aberto soma o valor original; em atraso, o valor atualizado (com
    // encargos) — o mesmo critério do resumo de boletos da visão do cliente.
    em_aberto: { quantidade: titulos.length, soma_valor: somar(titulos, t => t.valor) },
    em_atraso: { quantidade: atrasados.length, soma_valor: somar(atrasados, t => t.valor_atualizado ?? t.valor) },
  };
}

async function consultar(
  supabase: SupabaseClient,
  idCliente: number,
  recorte: 'aberto' | 'atraso',
): Promise<BoletosResult> {
  const filtro = recorte === 'atraso' ? 'em atraso' : 'em aberto';
  const { titulos, error } = await lerTitulosEmAberto(supabase, idCliente);
  if (error) {
    return { found: false, items: [], count: 0, filtro, source: 'public.boletos', authError: isAuthError(error), error: error.message };
  }

  const doRecorte = recorte === 'atraso' ? titulos.filter(t => t.em_atraso) : titulos;
  return {
    found: doRecorte.length > 0,
    items: doRecorte.slice(0, MAX_ITENS),
    count: doRecorte.length,
    filtro,
    resumo: resumir(titulos),
    criterio: CRITERIO_TITULOS,
    lista_parcial: doRecorte.length > MAX_ITENS,
    source: 'public.boletos',
  };
}

// ─── Consultas Read-Only ──────────────────────────────────────────────────

/** Títulos em aberto: sem pagamento e não cancelados, em qualquer status. */
export async function buscarBoletosEmAberto(supabase: SupabaseClient, idCliente: number): Promise<BoletosResult> {
  return consultar(supabase, idCliente, 'aberto');
}

/** Títulos em atraso: em aberto com vencimento antes de hoje (Brasília). */
export async function buscarBoletosEmAtraso(supabase: SupabaseClient, idCliente: number): Promise<BoletosResult> {
  return consultar(supabase, idCliente, 'atraso');
}

/** Não liquidados = em aberto. Mantida pelo nome que o motor legado usa. */
export async function buscarBoletosNaoLiquidados(supabase: SupabaseClient, idCliente: number): Promise<BoletosResult> {
  return consultar(supabase, idCliente, 'aberto');
}

/**
 * Resumo de boletos do cliente pela regra única — usado pela visão geral, no
 * lugar dos quatro números da view (que mede atraso pela rotina diária).
 */
export async function resumoDeTitulosDoCliente(
  supabase: SupabaseClient,
  idCliente: number,
): Promise<{ resumo: ResumoDeTitulos | null; error?: string }> {
  const { titulos, error } = await lerTitulosEmAberto(supabase, idCliente);
  return error ? { resumo: null, error: error.message } : { resumo: resumir(titulos) };
}

/**
 * Facade: despacha para a consulta correta baseada no filtro detectado.
 */
export async function buscarBoletosCliente(
  supabase: SupabaseClient,
  idCliente: number,
  filtro: 'aberto' | 'atraso' | 'nao_liquidado' | 'todos',
): Promise<BoletosResult> {
  switch (filtro) {
    case 'aberto':       return buscarBoletosEmAberto(supabase, idCliente);
    case 'atraso':       return buscarBoletosEmAtraso(supabase, idCliente);
    case 'nao_liquidado':
    case 'todos':
    default:             return buscarBoletosNaoLiquidados(supabase, idCliente);
  }
}
