/**
 * maestro-simple-performance.server.ts
 *
 * Performance comercial de UM vendedor (Maestro Vendedor, fase 1).
 *
 * Fonte ÚNICA: calcularFaturamentoOficial (pagamentos_v2 confirmados com
 * status PAID/A_VENCER, período por data_confirmacao; public.propostas
 * apenas como dimensão vendedor). Este módulo NÃO consulta o banco
 * diretamente — apenas deriva agregados prontos para o modelo:
 *   - ticket médio  = faturamento / pedidos_pagos (null quando 0 pedidos —
 *     nunca zero fabricado);
 *   - variação vs período anterior (percentual null quando a base é 0);
 *   - empresa que mais faturou (1º dos subtotais por empresa).
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  calcularFaturamentoOficial,
  CRITERIO_FATURAMENTO_OFICIAL,
} from './maestro-simple-pagamentos.server';

export interface PerformancePeriodo {
  periodo: string;
  /** Soma dos pagamentos confirmados (PAID/A_VENCER) por data_confirmacao */
  faturamento: number;
  /** id_int distintos com pagamento confirmado no período */
  pedidos_pagos: number;
  /** faturamento / pedidos_pagos — null quando não há pedidos pagos */
  ticket_medio: number | null;
}

export interface PerformanceEmpresa {
  id_empresa: number | null;
  empresa: string | null;
  faturamento: number;
  pedidos_pagos: number;
}

export interface PerformanceVendedorResult {
  found: boolean;
  /** Nome comercial usado no match (propostas.vendedor) */
  vendedor: string;
  escopo: 'proprio';
  criterio: string;
  atual: PerformancePeriodo;
  comparacao?: PerformancePeriodo & {
    variacao_absoluta: number;
    /** null quando a base (período anterior) é 0 — nunca "Infinity" */
    variacao_percentual: number | null;
  };
  por_empresa: PerformanceEmpresa[];
  /** 1º do por_empresa (maior faturamento) — null sem dados */
  empresa_top: { id_empresa: number | null; empresa: string | null; faturamento: number } | null;
  truncado: boolean;
  source: string;
  aviso?: string;
  authError?: boolean;
  error?: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function calcularPerformanceVendedor(
  supabase: SupabaseClient,
  opts: {
    vendedorNome: string;
    desde: string;
    ate?: string;
    periodoLabel: string;
    comparar?: { desde: string; ate: string; label: string };
  },
): Promise<PerformanceVendedorResult> {
  const base = {
    vendedor: opts.vendedorNome,
    escopo: 'proprio' as const,
    criterio:
      CRITERIO_FATURAMENTO_OFICIAL +
      ' ticket_medio = faturamento / pedidos_pagos do período (por pedido pago, não por item).',
  };

  const atualRes = await calcularFaturamentoOficial(supabase, {
    desde: opts.desde,
    ate: opts.ate,
    periodoLabel: opts.periodoLabel,
    vendedorNome: opts.vendedorNome,
    agruparPorEmpresa: true,
  });

  if (!atualRes.found && atualRes.error) {
    return {
      ...base,
      found: false,
      atual: { periodo: opts.periodoLabel, faturamento: 0, pedidos_pagos: 0, ticket_medio: null },
      por_empresa: [],
      empresa_top: null,
      truncado: atualRes.truncado,
      source: atualRes.source,
      authError: atualRes.authError,
      error: atualRes.error,
    };
  }

  const atual: PerformancePeriodo = {
    periodo: opts.periodoLabel,
    faturamento: atualRes.faturamento,
    pedidos_pagos: atualRes.total_propostas,
    ticket_medio:
      atualRes.total_propostas > 0 ? round2(atualRes.faturamento / atualRes.total_propostas) : null,
  };

  const porEmpresa: PerformanceEmpresa[] = (atualRes.por_empresa ?? []).map(e => ({
    id_empresa: e.id_empresa,
    empresa: e.empresa,
    faturamento: e.faturamento,
    pedidos_pagos: e.propostas,
  }));
  const empresaTop = porEmpresa.length
    ? { id_empresa: porEmpresa[0].id_empresa, empresa: porEmpresa[0].empresa, faturamento: porEmpresa[0].faturamento }
    : null;

  let comparacao: PerformanceVendedorResult['comparacao'];
  if (opts.comparar) {
    const antRes = await calcularFaturamentoOficial(supabase, {
      desde: opts.comparar.desde,
      ate: opts.comparar.ate,
      periodoLabel: opts.comparar.label,
      vendedorNome: opts.vendedorNome,
    });
    // Falha na comparação não derruba o período atual — comparacao fica ausente
    if (antRes.found || !antRes.error) {
      const variacaoAbs = round2(atual.faturamento - antRes.faturamento);
      comparacao = {
        periodo: opts.comparar.label,
        faturamento: antRes.faturamento,
        pedidos_pagos: antRes.total_propostas,
        ticket_medio:
          antRes.total_propostas > 0 ? round2(antRes.faturamento / antRes.total_propostas) : null,
        variacao_absoluta: variacaoAbs,
        variacao_percentual:
          antRes.faturamento > 0 ? round2((variacaoAbs / antRes.faturamento) * 100) : null,
      };
    }
  }

  const avisos = [atualRes.aviso, atualRes.nota_contagem].filter(Boolean).join(' ');

  return {
    ...base,
    found: true,
    atual,
    ...(comparacao ? { comparacao } : {}),
    por_empresa: porEmpresa,
    empresa_top: empresaTop,
    truncado: atualRes.truncado,
    source: atualRes.source,
    ...(avisos ? { aviso: avisos } : {}),
  };
}
