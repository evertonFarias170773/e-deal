/**
 * propostas.consultar.ts
 * Implementação da tool propostas.consultar_por_cliente para o Maestro.
 *
 * Regras:
 * - Apenas leitura em public.propostas.
 * - Usa clientInternalId (inteiro) — nunca clientDisplayCode (string).
 * - Para intenção de orçamento/proposta: sem filtro is_prd_aprovado.
 * - Para intenção de pedido real: usa apenasAprovados=true.
 * - Se não há clientInternalId mas há clientDisplayCode numérico: usa como fallback.
 * - Se não há código mas há nome: faz lookup de cliente via vw_cadastros_clientes_lista.
 */

import { consultarPropostasPorCliente } from '../adapters/propostas.adapter';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { ToolResult } from '../tools.types';

// ---------------------------------------------------------------------------
// Resolve clientInternalId via nome (quando o usuário pede "orçamentos da LISITON")
// ---------------------------------------------------------------------------

async function resolveClientIdByName(
  searchName: string
): Promise<{ clientInternalId: number; clientName: string } | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !searchName) return null;

  const { data, error } = await supabase
    .from('vw_cadastros_clientes_lista')
    .select('id_cliente, nome, fantasia')
    .or(`nome.ilike.%${searchName}%,fantasia.ilike.%${searchName}%`)
    .limit(1)
    .single();

  if (error || !data) return null;

  return {
    clientInternalId: data.id_cliente,
    clientName: data.nome || data.fantasia,
  };
}

// ---------------------------------------------------------------------------
// Tool principal
// ---------------------------------------------------------------------------

export async function executePropostasConsultarPorCliente(
  params: Record<string, any>
): Promise<ToolResult> {
  const toolId = 'propostas.consultar_por_cliente';

  // ── Resolver clientInternalId ────────────────────────────────────────────────
  // Prioridade: clientInternalId explícito > clientDisplayCode numérico > clientId numérico > busca por nome

  let clientInternalId: number | null = null;
  let resolvedClientName: string | undefined = params.clientName;

  // 1. Valor direto como número
  if (typeof params.clientInternalId === 'number' && params.clientInternalId > 0) {
    clientInternalId = params.clientInternalId;
  }

  // 2. clientInternalId como string numérica
  if (!clientInternalId && params.clientInternalId) {
    const parsed = Number(params.clientInternalId);
    if (!isNaN(parsed) && parsed > 0) clientInternalId = parsed;
  }

  // 3. clientDisplayCode como número (na Ideal, id_cliente = código de exibição)
  if (!clientInternalId && params.clientDisplayCode) {
    const parsed = Number(params.clientDisplayCode);
    if (!isNaN(parsed) && parsed > 0) clientInternalId = parsed;
  }

  // 4. clientId como número (retrocompat)
  if (!clientInternalId && params.clientId) {
    const parsed = Number(params.clientId);
    if (!isNaN(parsed) && parsed > 0) clientInternalId = parsed;
  }

  // 5. Busca por nome quando só texto foi fornecido
  if (!clientInternalId && params.clientSearchName) {
    const resolved = await resolveClientIdByName(params.clientSearchName);
    if (resolved) {
      clientInternalId = resolved.clientInternalId;
      resolvedClientName = resolved.clientName;
    } else {
      return {
        toolId,
        success: false,
        data: [],
        source: 'system',
        count: 0,
        executionTime: 0,
        warnings: [],
        errors: [
          `Não encontrei cliente com o nome "${params.clientSearchName}" no ERP. ` +
          'Tente informar o código do cliente (ex: 8469) ou o nome completo.',
        ],
      };
    }
  }

  // ── Validação final ──────────────────────────────────────────────────────────
  if (!clientInternalId || clientInternalId <= 0) {
    return {
      toolId,
      success: false,
      data: [],
      source: 'system',
      count: 0,
      executionTime: 0,
      warnings: [],
      errors: [
        'Não identifiquei o cliente para esta consulta. ' +
        'Informe o código do cliente (ex: "cliente 8469") ou o nome da empresa.',
      ],
    };
  }

  // ── Determina tipo de consulta ────────────────────────────────────────────────
  // intentType='pedido' → is_prd_aprovado=true (pedido real)
  // intentType='proposta'/'orcamento'/omitido → todos os status
  const isPedidoReal = params.intentType === 'pedido' || params.apenasAprovados === true;

  const result = await consultarPropostasPorCliente({
    clientInternalId,
    limit: params.limit ?? 5,
    apenasAprovados: isPedidoReal,
    statusFiltro: params.statusFiltro,
  });

  // Injeta nome resolvido por nome se não veio no resultado
  if (resolvedClientName && result.data && result.data.length === 0) {
    result.warnings = [
      ...(result.warnings || []),
      `Cliente encontrado: ${resolvedClientName} (id_cliente=${clientInternalId})`,
    ];
  }

  return result;
}
