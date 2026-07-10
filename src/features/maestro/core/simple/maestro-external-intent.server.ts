/**
 * maestro-external-intent.server.ts
 *
 * Cliente server-side para a camada de interpretação de intenções externa.
 * Executa somente no servidor (Node.js/Edge).
 */

import type { ExternalIntentPayload, ExternalIntentResponse } from './maestro-external-intent.types';

const TIMEOUT_MS = 3000;

export async function callExternalAgent(payload: ExternalIntentPayload): Promise<ExternalIntentResponse | null> {
  if (process.env.MAESTRO_EXTERNAL_INTENT_ENABLED !== 'true') {
    return null;
  }

  const provider = process.env.MAESTRO_AGENT_PROVIDER || 'openai';
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`[MaestroExternalIntent] Chamando agente externo (Provider: ${provider})...`);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let result: ExternalIntentResponse | null = null;

    if (provider === 'openai') {
      result = await callOpenAIDirectly(payload, controller.signal);
    } else if (provider === 'webhook') {
      result = await callWebhook(payload, controller.signal);
    } else {
      console.warn(`[MaestroExternalIntent] Provider desconhecido: ${provider}`);
    }

    clearTimeout(timeout);
    
    if (process.env.NODE_ENV === 'development' && result) {
       console.log(`[MaestroExternalIntent] Resposta recebida: Intent=${result.intent}, Confidence=${result.confidence}`);
    }

    return result;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn(`[MaestroExternalIntent] Timeout ao chamar agente externo (${TIMEOUT_MS}ms). Usando fallback.`);
    } else {
      console.error(`[MaestroExternalIntent] Erro ao chamar agente externo:`, err.message);
    }
    return null;
  }
}

async function callWebhook(payload: ExternalIntentPayload, signal: AbortSignal): Promise<ExternalIntentResponse | null> {
  const url = process.env.MAESTRO_EXTERNAL_INTENT_URL;
  if (!url) return null;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MAESTRO_EXTERNAL_INTENT_SECRET || ''}`
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

async function callOpenAIDirectly(payload: ExternalIntentPayload, signal: AbortSignal): Promise<ExternalIntentResponse | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada para o provider openai.');
  }

  const model = process.env.MAESTRO_AGENT_MODEL || 'gpt-4o-mini';
  const temperature = parseFloat(process.env.MAESTRO_AGENT_TEMPERATURE || '0.2');

  const systemPrompt = `
Você é a Camada de Interpretação Externa (Agent Service) do ERP Ideal.
Seu papel é analisar a requisição do usuário baseada no estado atual e retornar um JSON rígido estruturado.
NÃO execute ações, APENAS classifique a intenção do usuário.

REGRAS:
1. Retorne APENAS um JSON válido.
2. Não invente IDs, clientes ou produtos. Se for ambíguo, use a intenção adequada.
3. Não decida executar escrita real. Exemplo: se o usuário pedir para salvar, retorne "salvar_proposta" e o Maestro pedirá a confirmação.
4. Intenções válidas:
  - social_response
  - buscar_cliente
  - criar_cotacao
  - repetir_orcamento_para_outro_cliente
  - selecionar_endereco
  - selecionar_frete
  - trocar_frete
  - consultar_cotacao_ativa
  - cancelar_cotacao
  - salvar_proposta
  - consultar_campo_cliente
  - consultar_financeiro
  - mensagem_frustracao
  - fallback_clarificacao

FORMATO DE RETORNO (JSON):
{
  "intent": "string (uma das opções acima)",
  "confidence": "high" | "medium" | "low",
  "params": {
    // Parâmetros extraídos, ex: {"busca": "Lisiton"}, {"itens": [{"quantidade": 10, "termo": "produto"}]}
  },
  "reasoning": "string (explicação curta opcional)"
}
  `.trim();

  const userPrompt = JSON.stringify(payload, null, 2);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error! status: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content?.trim();
  
  if (!content) return null;

  return JSON.parse(content) as ExternalIntentResponse;
}
