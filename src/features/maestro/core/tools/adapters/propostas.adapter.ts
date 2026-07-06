/**
 * propostas.adapter.ts
 * Adapter read-only exclusivo do Maestro para consultar public.propostas.
 *
 * REGRAS DE USO:
 * - Apenas SELECT — nunca INSERT, UPDATE, DELETE ou UPSERT.
 * - Filtrar sempre por id_cliente (inteiro interno) ou id_int.
 * - Para orçamento/proposta: sem filtro de is_prd_aprovado (pode estar aberto).
 * - Para pedido real: usar is_prd_aprovado = true.
 * - Nunca acessar propostas_os, pedidos_modelos ou fiscal aqui.
 * - Nunca retornar campos sensíveis: token_publico, payload_envio, etc.
 * - Sempre citar fonte: 'public.propostas'.
 */

import { getSupabaseClient } from '@/lib/supabase/client';
import type { ToolResult } from '../tools.types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface PropostaMaestroItem {
  id: string;
  id_int: number;
  id_cliente: number;
  cliente: string;
  vendedor: string | null;
  empresa: string | null;
  status_interno: string | null;
  valor_total: number | null;
  /** Campo alternativo de valor — usar se valor_total for null */
  valor: number | null;
  created_at: string;
  is_prd_aprovado: boolean;
  is_avulso: boolean | null;
  em_arte: boolean | null;
  libera_nf: boolean | null;
}

export interface ConsultarPropostasParams {
  /** ID inteiro interno do cliente (propostas.id_cliente) */
  clientInternalId: number;
  /** Quantidade de registros a retornar (padrão: 5) */
  limit?: number;
  /** Se true: filtra is_prd_aprovado = true (pedido real). Se false/omitido: todos os status. */
  apenasAprovados?: boolean;
  /** Status interno específico para filtrar (ex: "APROVADO") */
  statusFiltro?: string;
}

// Colunas seguras para leitura — sem dados sensíveis
// Inclui 'valor' como fallback quando valor_total é null
const PROPOSTAS_SELECT_COLUMNS = [
  'id',
  'id_int',
  'id_cliente',
  'cliente',
  'vendedor',
  'empresa',
  'status_interno',
  'valor_total',
  'valor',
  'created_at',
  'is_prd_aprovado',
  'is_avulso',
  'em_arte',
  'libera_nf',
].join(', ');

// ---------------------------------------------------------------------------
// consultarPropostasPorCliente
// ---------------------------------------------------------------------------

/**
 * Busca as últimas propostas/orçamentos de um cliente no ERP.
 *
 * @param params.clientInternalId - Inteiro interno do banco (propostas.id_cliente)
 * @param params.limit - Número de registros (padrão: 5, máx: 20)
 * @param params.apenasAprovados - Se true, usa is_prd_aprovado=true (pedidos reais)
 * @param params.statusFiltro - Filtro opcional por status_interno
 */
export async function consultarPropostasPorCliente(
  params: ConsultarPropostasParams
): Promise<ToolResult> {
  const startTime = Date.now();
  const toolId = 'propostas.consultar_por_cliente';
  const limit = Math.min(params.limit ?? 5, 20);

  try {
    const supabase = getSupabaseClient();

    if (!supabase) {
      return {
        toolId,
        success: false,
        data: [],
        source: 'system',
        count: 0,
        executionTime: Date.now() - startTime,
        warnings: [],
        errors: ['Supabase client não disponível. Verifique as variáveis de ambiente.'],
      };
    }

    // Monta a query base
    let query = supabase
      .from('propostas')
      .select(PROPOSTAS_SELECT_COLUMNS)
      .eq('id_cliente', params.clientInternalId)
      .order('created_at', { ascending: false })
      .limit(limit);

    // Filtro de pedido real (apenas aprovados/produção)
    if (params.apenasAprovados === true) {
      query = query.eq('is_prd_aprovado', true);
    }

    // Filtro opcional por status_interno
    if (params.statusFiltro) {
      query = query.eq('status_interno', params.statusFiltro);
    }

    // Não inclui CANCELADO por padrão quando buscando propostas ativas
    // (não filtramos aqui para não perder histórico — o presenter decide o que exibir)

    const { data, error } = await query;

    if (error) {
      // Trata erro de permissão separadamente
      const isPolicyError =
        error.code === '42501' ||
        error.message?.toLowerCase().includes('permission') ||
        error.message?.toLowerCase().includes('rls');

      return {
        toolId,
        success: false,
        data: [],
        source: 'supabase',
        count: 0,
        executionTime: Date.now() - startTime,
        warnings: isPolicyError
          ? ['Acesso negado pela política de segurança (RLS) do Supabase.']
          : [],
        errors: [
          isPolicyError
            ? `Permissão insuficiente para consultar propostas deste cliente.`
            : `Erro ao consultar public.propostas: ${error.message}`,
        ],
      };
    }

    const propostas: PropostaMaestroItem[] = (data || []).map((row: any) => ({
      id: row.id,
      id_int: row.id_int,
      id_cliente: row.id_cliente,
      cliente: row.cliente || '',
      vendedor: row.vendedor ?? null,
      empresa: row.empresa ?? null,
      status_interno: row.status_interno ?? null,
      valor_total: row.valor_total ?? null,
      valor: row.valor ?? null,
      created_at: row.created_at,
      is_prd_aprovado: row.is_prd_aprovado === true,
      is_avulso: row.is_avulso ?? null,
      em_arte: row.em_arte ?? null,
      libera_nf: row.libera_nf ?? null,
    }));

    return {
      toolId,
      success: true,
      data: propostas,
      source: 'supabase',
      count: propostas.length,
      executionTime: Date.now() - startTime,
      warnings: propostas.length === 0
        ? [`Nenhuma proposta encontrada para id_cliente=${params.clientInternalId}.`]
        : [],
      errors: [],
    };
  } catch (err: any) {
    return {
      toolId,
      success: false,
      data: [],
      source: 'system',
      count: 0,
      executionTime: Date.now() - startTime,
      warnings: [],
      errors: [err?.message || 'Erro inesperado ao consultar propostas no ERP.'],
    };
  }
}

// ---------------------------------------------------------------------------
// consultarPropostaPorIdInt
// ---------------------------------------------------------------------------

/**
 * Busca uma proposta específica pelo id_int (chave transversal do ERP).
 *
 * Regra de valor: valor_total ?? valor ?? null (nunca inventa)
 * Fonte: 'public.propostas · filtro: id_int = N'
 *
 * @param idInt - Número inteiro da proposta (ex: 18555)
 */
export async function consultarPropostaPorIdInt(
  idInt: number
): Promise<ToolResult> {
  const startTime = Date.now();
  const toolId    = 'propostas.consultar_por_id_int';
  const fonte     = `public.propostas · filtro: id_int = ${idInt}`;

  try {
    const supabase = getSupabaseClient();

    if (!supabase) {
      return {
        toolId,
        success: false,
        data: [],
        source: 'system',
        count: 0,
        executionTime: Date.now() - startTime,
        warnings: [],
        errors: ['Supabase client não disponível. Verifique as variáveis de ambiente.'],
      };
    }

    const { data: rawData, error } = await supabase
      .from('propostas')
      .select(PROPOSTAS_SELECT_COLUMNS)
      .eq('id_int', idInt)
      .limit(1)
      .single();

    // Cast to any — Supabase .single() infers GenericStringError without generated types
    const data = rawData as any;

    if (error) {
      // PGRST116 = 0 rows (not found) — trata como "não encontrado"
      if (error.code === 'PGRST116') {
        return {
          toolId,
          success: false,
          data: [],
          source: 'supabase',
          count: 0,
          executionTime: Date.now() - startTime,
          warnings: [`Proposta #${idInt} não encontrada em ${fonte}.`],
          errors: [],
        };
      }

      const isPolicyError =
        error.code === '42501' ||
        error.message?.toLowerCase().includes('permission') ||
        error.message?.toLowerCase().includes('rls');

      return {
        toolId,
        success: false,
        data: [],
        source: 'supabase',
        count: 0,
        executionTime: Date.now() - startTime,
        warnings: isPolicyError
          ? ['Acesso negado pela política de segurança (RLS) do Supabase.']
          : [],
        errors: [
          isPolicyError
            ? `Permissão insuficiente para consultar a proposta #${idInt}.`
            : `Erro ao consultar ${fonte}: ${error.message}`,
        ],
      };
    }

    // Regra de valor: valor_total à valor à null (nunca inventa)
    const proposta: PropostaMaestroItem = {
      id:             data.id,
      id_int:         data.id_int,
      id_cliente:     data.id_cliente,
      cliente:        data.cliente || '',
      vendedor:       data.vendedor   ?? null,
      empresa:        data.empresa    ?? null,
      status_interno: data.status_interno ?? null,
      valor_total:    data.valor_total ?? null,
      valor:          data.valor       ?? null,
      created_at:     data.created_at,
      is_prd_aprovado: data.is_prd_aprovado === true,
      is_avulso:      data.is_avulso  ?? null,
      em_arte:        data.em_arte    ?? null,
      libera_nf:      data.libera_nf  ?? null,
    };

    return {
      toolId,
      success: true,
      data: [proposta],
      source: 'supabase',
      sourceLabel: fonte,
      count: 1,
      executionTime: Date.now() - startTime,
      warnings: [],
      errors: [],
    };
  } catch (err: any) {
    return {
      toolId,
      success: false,
      data: [],
      source: 'system',
      count: 0,
      executionTime: Date.now() - startTime,
      warnings: [],
      errors: [err?.message || `Erro inesperado ao consultar proposta #${idInt}.`],
    };
  }
}
