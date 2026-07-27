/**
 * maestro-agent-sanitize.ts
 *
 * Mascaramento de saída das tools do Agent Loop (defesa em profundidade).
 *
 * Toda saída de tool passa por aqui ANTES de ser devolvida ao modelo:
 *   - remove campos proibidos (CAMPOS_PROIBIDOS de security-rules.ts +
 *     CAMPOS_FINANCEIROS_SENSIVEIS de finance-rules.ts + observações internas);
 *   - mascara CPF/CNPJ (regra MASCARAMENTO de security-rules.ts);
 *   - redige padrões sensíveis em strings (tokens, linha digitável, JWT)
 *     reutilizando redigirConteudoSensivel de maestro-recent-turns.ts.
 *
 * Os adapters read-only já não selecionam campos sensíveis — esta camada é
 * garantia adicional caso uma tool futura vaze um campo por engano.
 *
 * ⚠️ Roda apenas no servidor.
 */

import { CAMPOS_PROIBIDOS } from '../knowledge/security-rules';
import { CAMPOS_FINANCEIROS_SENSIVEIS } from '../knowledge/finance-rules';
import { redigirConteudoSensivel } from '../simple/maestro-recent-turns';

// Campos extras nunca expostos ao modelo (observações internas, artefatos de
// integração e credenciais) — complementam as listas canônicas.
const CAMPOS_EXTRAS_PROIBIDOS = [
  'obs',
  'obsInterna',
  'obs_interna',
  'msg_whats',
  'texto_whatsapp',
  'url_pdf',
  'pdf_storage',
  'senha',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
] as const;

const CAMPOS_REMOVIDOS = new Set<string>(
  [...CAMPOS_PROIBIDOS, ...CAMPOS_FINANCEIROS_SENSIVEIS, ...CAMPOS_EXTRAS_PROIBIDOS].map(c =>
    c.toLowerCase()
  )
);

// Chaves cujo valor string é um documento a mascarar
const CHAVES_DOCUMENTO = /documento|cpf|cnpj/i;

const MAX_STRING_CHARS = 2000;
const MAX_DEPTH = 8;

/**
 * Mascara CPF/CNPJ conforme a regra MASCARAMENTO (security-rules.ts).
 * Usa "x" no lugar de "*" — asteriscos são engolidos pela renderização
 * markdown do chat (viram itálico/negrito e o documento aparece quebrado).
 */
export function maskDocumento(doc: string): string {
  const digits = doc.replace(/\D/g, '');
  if (digits.length >= 14) {
    return `${digits.slice(0, 2)}.xxx.xxx/xxxx-${digits.slice(-2)}`;
  }
  if (digits.length >= 11) {
    return `xxx.${digits.slice(3, 6)}.xxx-${digits.slice(-2)}`;
  }
  return digits.length > 0 ? 'xxx' : doc;
}

function sanitizeString(value: string): string {
  const redigido = redigirConteudoSensivel(value);
  return redigido.length > MAX_STRING_CHARS
    ? redigido.slice(0, MAX_STRING_CHARS) + '…'
    : redigido;
}

function sanitizeValue(value: unknown, keyHint: string | null, depth: number): unknown {
  if (value == null) return value;

  if (typeof value === 'string') {
    if (keyHint && CHAVES_DOCUMENTO.test(keyHint)) return maskDocumento(value);
    return sanitizeString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (depth >= MAX_DEPTH) return undefined;

  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item, keyHint, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (CAMPOS_REMOVIDOS.has(key.toLowerCase())) continue;
      const sanitized = sanitizeValue(val, key, depth + 1);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    return out;
  }

  // Funções, símbolos etc. nunca chegam ao modelo
  return undefined;
}

/**
 * Sanitiza a saída de uma tool antes de devolvê-la ao modelo.
 * Remove campos proibidos em profundidade, mascara documentos e redige
 * padrões sensíveis em qualquer string.
 */
export function sanitizeAgentToolOutput<T>(value: T): unknown {
  return sanitizeValue(value, null, 0);
}
