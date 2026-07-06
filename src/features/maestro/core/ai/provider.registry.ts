import type { AIProvider } from './ai.types';
import { MockProvider, OpenAIProvider } from './ai.providers';

class ProviderRegistry {
  private providers = new Map<string, AIProvider>();
  private defaultProviderId = 'mock-provider';

  constructor() {
    this.register(new MockProvider());
    this.register(new OpenAIProvider());
  }

  register(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
  }

  setDefault(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(`Provider ${id} não está registrado.`);
    }
    this.defaultProviderId = id;
  }

  resolve(id?: string): AIProvider {
    const targetId = id || this.defaultProviderId;
    const provider = this.providers.get(targetId);

    if (!provider) {
      // Fallback de segurança garante o mock sempre disponível
      if (this.providers.has('mock-provider')) {
        return this.providers.get('mock-provider')!;
      }
      throw new Error(`Nenhum provedor de IA disponível para ${targetId}`);
    }

    return provider;
  }

  listAvailable(): AIProvider[] {
    return Array.from(this.providers.values());
  }
}

export const providerRegistry = new ProviderRegistry();

/**
 * getActiveProviderId
 *
 * Retorna o ID do provider a ser usado nesta requisição.
 * Lê a feature flag do contexto: em client-side usa o valor
 * exposto como atributo data-* no body ou via cookie/header,
 * mas como solução simples e segura, o ai.gateway.ts já decide
 * qual providerId passar com base no env injetado pelo servidor.
 *
 * Para ativar OpenAI: MAESTRO_LLM_ENABLED=true em .env.local
 */
export function getActiveProviderId(llmEnabled?: boolean): string {
  return llmEnabled === true ? 'openai-provider' : 'mock-provider';
}
