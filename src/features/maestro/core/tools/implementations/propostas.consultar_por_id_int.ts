/**
 * propostas.consultar_por_id_int.ts
 * Implementação da tool propostas.consultar_por_id_int para o Maestro.
 *
 * Regras:
 * - Apenas leitura em public.propostas (SELECT WHERE id_int = N).
 * - Entidade explícita na query → tem prioridade sobre contexto de cliente anterior.
 * - Regra de valor: valor_total ?? valor ?? null (nunca inventa).
 * - Fonte sempre citada: 'public.propostas · filtro: id_int = N'.
 * - Não consulta propostas_os, fiscal, pagamentos_v2 ou boletos.
 */

import { consultarPropostaPorIdInt } from '../adapters/propostas.adapter';
import type { ToolResult } from '../tools.types';

export async function executePropostasConsultarPorIdInt(
  params: Record<string, any>
): Promise<ToolResult> {
  const toolId = 'propostas.consultar_por_id_int';

  // Aceita activeIdInt (número) ou proposalIdInt (número) ou id_int (número)
  const raw = params.activeIdInt ?? params.proposalIdInt ?? params.idInt ?? params.id_int;
  const idInt = typeof raw === 'number' ? raw : Number(raw);

  if (!idInt || isNaN(idInt) || idInt <= 0) {
    return {
      toolId,
      success: false,
      data: [],
      source: 'system',
      count: 0,
      executionTime: 0,
      warnings: [],
      errors: [
        'Não identifiquei o número da proposta para esta consulta. ' +
        'Informe o número explicitamente (ex: "proposta 18555" ou "#18555").',
      ],
    };
  }

  return consultarPropostaPorIdInt(idInt);
}
