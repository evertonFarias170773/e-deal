/**
 * maestro-agent-medicao.ts
 *
 * Medição de um turno do Maestro (09/10/2026): modelo, tokens de entrada e de
 * saída, tokens servidos do cache, idas ao modelo e tempo. Vai para o payload
 * do `agent_turn` em maestro_acoes. Nunca guarda texto da pergunta nem da
 * resposta.
 *
 * Soma TODAS as chamadas do turno: as do agente, a de resposta parcial e a da
 * conferência de assunto.
 *
 * DESLIGAR: MAESTRO_MEDICAO_TURNO=off. Ausente = ligado.
 *
 * Funções puras, sem banco e sem modelo.
 */

export interface MedicaoDoTurno {
  idas: number;
  entrada: number;
  saida: number;
  cache: number;
}

export function medicaoDoTurnoLigada(): boolean {
  return (process.env.MAESTRO_MEDICAO_TURNO ?? '').trim().toLowerCase() !== 'off';
}

export function novaMedicao(): MedicaoDoTurno {
  return { idas: 0, entrada: 0, saida: 0, cache: 0 };
}

const inteiro = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/**
 * Conta uma ida ao modelo e soma o `usage` que a OpenAI devolveu. Resposta sem
 * `usage` conta a ida e zero tokens. Nunca lança.
 */
export function somarUso(medicao: MedicaoDoTurno, usage: unknown): void {
  medicao.idas++;
  if (!usage || typeof usage !== 'object') return;
  const u = usage as { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } | null };
  medicao.entrada += inteiro(u.prompt_tokens);
  medicao.saida += inteiro(u.completion_tokens);
  medicao.cache += inteiro(u.prompt_tokens_details?.cached_tokens);
}

/** Os campos que entram no payload do `agent_turn`. */
export function camposDeMedicao(medicao: MedicaoDoTurno, modelo: string, ms: number): Record<string, unknown> {
  return {
    modelo,
    tokens_entrada: medicao.entrada,
    tokens_saida: medicao.saida,
    tokens_cache: medicao.cache,
    idas_ao_modelo: medicao.idas,
    tempo_ms: Math.max(0, Math.round(ms)),
  };
}
