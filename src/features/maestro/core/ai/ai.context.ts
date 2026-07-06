import type { ToolResult } from '../tools/tools.types';
import type { AIRequest } from './ai.types';

/**
 * Motor de saneamento de contexto.
 * Evita que dados sensíveis cruzem a fronteira do AI Gateway.
 */
export function sanitizeToolResultsForAI(results?: Record<string, ToolResult>): Record<string, ToolResult> {
  if (!results) return {};
  
  const safeResults: Record<string, ToolResult> = {};

  for (const [toolId, result] of Object.entries(results)) {
    if (!result.success || !result.data) {
      safeResults[toolId] = { ...result };
      continue;
    }

    // Regras de Mascaramento Heurístico
    if (toolId.startsWith('clientes.') && Array.isArray(result.data)) {
      const sanitizedArray = result.data.map(item => {
        const safeItem = { ...item };
        // Mascara identificadores sensíveis
        if (safeItem.cpfCnpj) safeItem.cpfCnpj = '***.***.***-**';
        if (safeItem.telefone) safeItem.telefone = '(XX) XXXXX-XXXX';
        if (safeItem.whatsapp) safeItem.whatsapp = '(XX) XXXXX-XXXX';
        return safeItem;
      });
      safeResults[toolId] = { ...result, data: sanitizedArray };
    } else {
      safeResults[toolId] = { ...result };
    }
  }

  return safeResults;
}

/**
 * Constrói um payload de requisição seguro para LLMs.
 */
export function buildSafeAIRequest(rawRequest: AIRequest): AIRequest {
  return {
    ...rawRequest,
    toolResults: sanitizeToolResultsForAI(rawRequest.toolResults),
  };
}
