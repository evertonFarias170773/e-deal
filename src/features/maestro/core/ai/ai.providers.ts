import { fetchComSessao } from '@/lib/supabase/sessao';
import type { AIProvider, AIRequest, AIResponse, AIProviderCapabilities } from './ai.types';

// ---------------------------------------------------------------------------
// MockProvider — Fallback sempre disponível
// ---------------------------------------------------------------------------

export class MockProvider implements AIProvider {
  id = 'mock-provider';
  name = 'Maestro Mock LLM';
  capabilities: AIProviderCapabilities = {
    chat: true,
    vision: false,
    embeddings: false,
    toolCalling: false,
    jsonMode: false,
    streaming: true,
  };

  async generate(request: AIRequest): Promise<AIResponse> {
    const start = Date.now();
    await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
    const latency = Date.now() - start;

    let content = 'Esta é uma transcrição natural gerada pelo AI Gateway.';
    if (request.responseModel) {
      content = request.responseModel.summary;
    }

    return {
      content,
      reasoningSummary: 'Prompt mascarado validado. Contexto e ToolResults ingeridos. Geração concluída.',
      confidence: 0.98,
      provider: this.id,
      model: 'mock-turbo',
      tokens: { prompt: 210, completion: 35, total: 245 },
      latency,
      finishReason: 'stop',
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAIProvider — Chama a rota server-side /api/maestro/generate
//
// SEGURANÇA: este provider NUNCA carrega a OPENAI_API_KEY.
// A chave fica exclusivamente em src/app/api/maestro/generate/route.ts (server).
// Este provider é um relay client→server que envia apenas o prompt sanitizado.
// ---------------------------------------------------------------------------

export class OpenAIProvider implements AIProvider {
  id = 'openai-provider';
  name = 'OpenAI via API Route';
  capabilities: AIProviderCapabilities = {
    chat: true,
    vision: false,
    embeddings: false,
    toolCalling: false,
    jsonMode: false,
    streaming: false,
  };

  private readonly _mock = new MockProvider();

  async generate(request: AIRequest): Promise<AIResponse> {
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 9_000); // 9s > 8s do server

      const response = await fetchComSessao('/api/maestro/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: request.systemPrompt,
          userPrompt:   request.userPrompt,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[OpenAIProvider] Rota retornou ${response.status} — usando MockProvider.`);
        return this._mock.generate(request);
      }

      const data = await response.json() as {
        content?: string;
        model?: string;
        tokens?: { prompt: number; completion: number; total: number };
        latency?: number;
        finishReason?: string;
        fallback?: boolean;
        reason?: string;
      };

      // Se a rota sinalizou fallback (timeout, erro OpenAI, etc.) — usa mock
      if (data.fallback) {
        console.warn(`[OpenAIProvider] Fallback sinalizado (${data.reason ?? 'desconhecido'}) — usando MockProvider.`);
        return this._mock.generate(request);
      }

      // Validação mínima da resposta
      if (!data.content || data.content.trim().length < 5) {
        console.warn('[OpenAIProvider] Conteúdo inválido ou vazio — usando MockProvider.');
        return this._mock.generate(request);
      }

      return {
        content:         data.content.trim(),
        reasoningSummary: 'Resposta gerada via OpenAI (gpt-4o-mini) através de rota server-side segura.',
        confidence:      0.92,
        provider:        this.id,
        model:           data.model ?? 'gpt-4o-mini',
        tokens:          data.tokens ?? { prompt: 0, completion: 0, total: 0 },
        latency:         data.latency ?? (Date.now() - start),
        finishReason:    (data.finishReason as AIResponse['finishReason']) ?? 'stop',
      };

    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      console.warn(`[OpenAIProvider] ${isTimeout ? 'Timeout' : 'Erro'} na chamada — usando MockProvider.`);
      return this._mock.generate(request);
    }
  }
}
