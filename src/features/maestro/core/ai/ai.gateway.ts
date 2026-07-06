/**
 * ai.gateway.ts
 *
 * Ponto de entrada único e exclusivo para qualquer inteligência artificial no Maestro.
 *
 * Fluxo:
 *  1. buildAIPromptPayload → monta prompt estruturado (KB + contexto + dados das tools)
 *  2. buildSafeAIRequest  → firewall interno (mascara CPF, CNPJ, dados sensíveis)
 *  3. providerRegistry.resolve(activeProviderId) → seleciona MockProvider ou OpenAIProvider
 *  4. provider.generate(safeRequest) → executa (mock ou relay para /api/maestro/generate)
 *  5. Fallback gracioso em qualquer erro
 *
 * Feature Flag:
 *  - MAESTRO_LLM_ENABLED=true  → OpenAIProvider (chama /api/maestro/generate server-side)
 *  - MAESTRO_LLM_ENABLED!=true → MockProvider (padrão, sem chamada externa)
 *
 * SEGURANÇA:
 *  - Este arquivo NÃO lê OPENAI_API_KEY.
 *  - A chave fica exclusivamente em /api/maestro/generate/route.ts (server-side).
 *  - O LLM é pós-processador: recebe dados já validados pelo pipeline determinístico.
 *  - Tool Registry e Policy Engine rodam ANTES — o LLM não decide qual tool usar.
 */

import { providerRegistry, getActiveProviderId } from './provider.registry';
import { buildAIPromptPayload } from './ai.prompt.builder';
import { buildSafeAIRequest } from './ai.context';
import type { ConversationContext } from '../../types';
import type { ResponseModel, ResponseMetadata } from '../response/response.types';
import type { AIResponse } from './ai.types';

// ---------------------------------------------------------------------------
// Feature flag lida client-side via atributo injetado pelo servidor.
// O Next.js injeta variáveis de ambiente não-NEXT_PUBLIC_ apenas no servidor.
// Para passar a flag ao client sem expor chaves, usamos um endpoint dedicado
// ou o padrão de injetar o valor como data attribute no HTML via Server Component.
//
// Aqui usamos a abordagem mais simples e segura:
// A flag é resolvida pela função getActiveProviderId() no provider.registry.ts,
// que recebe o valor como parâmetro (injetado pelo MaestroProvider ou conversation.manager).
// ---------------------------------------------------------------------------

export async function generateAIResponse(
  userPrompt: string,
  context: ConversationContext,
  responseModel?: ResponseModel,
  responseMetadata?: ResponseMetadata,
  llmEnabled?: boolean
): Promise<AIResponse> {
  // 1. Constrói a requisição bruta a partir do Contexto e da Engine de Respostas
  const rawRequest = buildAIPromptPayload(userPrompt, context, responseModel, responseMetadata);

  // 2. Passa pelo firewall interno (oculta CPFs/CNPJs e dados confidenciais)
  const safeRequest = buildSafeAIRequest(rawRequest);

  // 3. Resolve o provider ativo (OpenAI se llmEnabled=true, Mock caso contrário)
  const activeProviderId = getActiveProviderId(llmEnabled);
  const provider = providerRegistry.resolve(activeProviderId);

  try {
    // 4. Despacha para o provider homologado
    const response = await provider.generate(safeRequest);
    return response;
  } catch (error: unknown) {
    // Fallback gracioso — nunca quebra a conversa
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error(`[AI Gateway] Erro no provider ${provider.id}: ${msg}`);

    return {
      content: responseModel?.summary ?? 'Não foi possível processar a resposta no momento. Por favor, tente novamente.',
      reasoningSummary: `Fallback ativado: ${msg}`,
      confidence: 0,
      provider: 'mock-provider',
      model: 'fallback-offline',
      tokens: { prompt: 0, completion: 0, total: 0 },
      latency: 0,
      finishReason: 'error',
    };
  }
}
