/**
 * POST /api/maestro/generate
 *
 * Rota server-side exclusiva para chamadas ao LLM no Maestro.
 * ÚNICA saída autorizada para a API da OpenAI.
 *
 * Segurança:
 * - OPENAI_API_KEY lida exclusivamente no servidor (nunca NEXT_PUBLIC_)
 * - Payload sanitizado por ai.context.ts antes de chegar aqui
 * - LLM é pós-processador: recebe dados já validados, reformula em linguagem natural
 * - Timeout conservador de 8 segundos
 * - Fallback gracioso em qualquer falha
 *
 * O LLM NUNCA:
 * - Acessa Supabase
 * - Chama tools diretamente
 * - Executa ações financeiras/fiscais
 * - Inventa dados de proposta, pedido, boleto ou cliente
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Constantes de segurança
// ---------------------------------------------------------------------------

const MAX_SYSTEM_PROMPT_CHARS = 12_000;
const MAX_USER_PROMPT_CHARS   = 4_000;
const REQUEST_TIMEOUT_MS      = 8_000;
const DEFAULT_MODEL           = 'gpt-4o-mini'; // Modelo padrão conservador e rápido

// Campos proibidos que nunca devem aparecer no prompt (dupla verificação server-side)
const FORBIDDEN_FIELDS = [
  'pix_copia_cola',
  'linha_digitavel',
  'token_publico',
  'url_cobranca',
  'boleto_pdf',
  'OPENAI_API_KEY',
  'api_key',
  'senha',
  'password',
];

// ---------------------------------------------------------------------------
// Sanitização final server-side
// ---------------------------------------------------------------------------

function sanitizeText(text: string, maxChars: number): string {
  let sanitized = text;
  for (const field of FORBIDDEN_FIELDS) {
    // Remove qualquer linha que contenha o campo proibido (case-insensitive)
    sanitized = sanitized.replace(new RegExp(`.*${field}.*\\n?`, 'gi'), '[REDACTED]\n');
  }
  return sanitized.slice(0, maxChars);
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // ── Verificação de feature flag ────────────────────────────────────────────
  if (process.env.MAESTRO_LLM_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'LLM desabilitado. Defina MAESTRO_LLM_ENABLED=true para ativar.' },
      { status: 503 }
    );
  }

  // ── Verificação de chave (server-side only) ───────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[Maestro LLM] OPENAI_API_KEY não configurada no servidor.');
    return NextResponse.json(
      { error: 'Configuração de chave ausente no servidor.' },
      { status: 500 }
    );
  }

  // ── Leitura e validação do payload ────────────────────────────────────────
  let body: { systemPrompt?: unknown; userPrompt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }

  const rawSystem = typeof body.systemPrompt === 'string' ? body.systemPrompt : '';
  const rawUser   = typeof body.userPrompt   === 'string' ? body.userPrompt   : '';

  if (!rawSystem || !rawUser) {
    return NextResponse.json(
      { error: 'systemPrompt e userPrompt são obrigatórios.' },
      { status: 400 }
    );
  }

  // ── Sanitização final server-side ─────────────────────────────────────────
  const systemPrompt = sanitizeText(rawSystem, MAX_SYSTEM_PROMPT_CHARS);
  const userPrompt   = sanitizeText(rawUser,   MAX_USER_PROMPT_CHARS);

  // ── Modelo configurável via env ───────────────────────────────────────────
  const model = process.env.MAESTRO_OPENAI_MODEL || DEFAULT_MODEL;

  // ── Chamada à OpenAI com timeout ──────────────────────────────────────────
  const openai = new OpenAI({ apiKey });

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const startTime = Date.now();

    const completion = await openai.chat.completions.create(
      {
        model,
        temperature: 0.2, // Corporativo — baixa criatividade, alta precisão
        max_tokens: 600,  // Resposta concisa
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const content = completion.choices[0]?.message?.content ?? '';
    const usage   = completion.usage;
    const latency = Date.now() - startTime;

    // Validação mínima da resposta
    if (!content || content.trim().length < 5) {
      console.warn('[Maestro LLM] Resposta vazia ou muito curta — usando fallback.');
      return NextResponse.json({ fallback: true }, { status: 200 });
    }

    return NextResponse.json({
      content:    content.trim(),
      model,
      provider:   'OpenAI',
      tokens: {
        prompt:     usage?.prompt_tokens     ?? 0,
        completion: usage?.completion_tokens ?? 0,
        total:      usage?.total_tokens      ?? 0,
      },
      latency,
      finishReason: completion.choices[0]?.finish_reason ?? 'stop',
    });

  } catch (err: unknown) {
    clearTimeout(timeoutId);

    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const message   = err instanceof Error ? err.message : 'Erro desconhecido';

    console.error(`[Maestro LLM] ${isTimeout ? 'Timeout' : 'Erro'}: ${message}`);

    // Retorna fallback gracioso — o gateway usará o MockProvider
    return NextResponse.json(
      { fallback: true, reason: isTimeout ? 'timeout' : 'error' },
      { status: 200 } // 200 para não quebrar o cliente — ele trata o campo fallback
    );
  }
}
