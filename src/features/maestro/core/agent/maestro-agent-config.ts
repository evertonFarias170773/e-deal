/**
 * maestro-agent-config.ts
 *
 * Flags e limites do Maestro Agent Loop (v1 — somente leitura).
 *
 * Envs:
 *   MAESTRO_AGENT_LOOP_ENABLED    → master switch (false = motor legado 100%)
 *   MAESTRO_AGENT_LOOP_MODEL      → modelo OpenAI (prioridade; padrão: gpt-4.1)
 *   MAESTRO_AGENT_MODEL           → fallback de modelo — ⚠️ variável compartilhada
 *                                   com o POC External Intent (maestro-external-intent.server.ts)
 *   MAESTRO_AGENT_MAX_ITERATIONS  → máximo de idas ao modelo por turno (padrão: 5)
 *   MAESTRO_AGENT_MAX_TOOL_CALLS  → máximo de tool-calls por turno (padrão: 8)
 *   MAESTRO_AGENT_TIMEOUT_MS      → orçamento total de tempo por turno (padrão: 25000)
 *
 * Reversão = MAESTRO_AGENT_LOOP_ENABLED=false (nenhum outro efeito colateral).
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { MaestroV2Context } from '../simple/maestro-v2-context-manager';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Master switch do loop agêntico. */
export function isAgentLoopEnabled(): boolean {
  return process.env.MAESTRO_AGENT_LOOP_ENABLED === 'true';
}

/**
 * Modelo OpenAI usado pelo loop (forte, configurável por env).
 * MAESTRO_AGENT_LOOP_MODEL tem prioridade para evitar colisão com o
 * MAESTRO_AGENT_MODEL do POC de External Intent (default gpt-4o-mini).
 */
export function getAgentModel(): string {
  return process.env.MAESTRO_AGENT_LOOP_MODEL || process.env.MAESTRO_AGENT_MODEL || 'gpt-4.1';
}

/** Máximo de iterações (idas ao modelo) por turno. */
export function getAgentMaxIterations(): number {
  return envInt('MAESTRO_AGENT_MAX_ITERATIONS', 5);
}

/** Máximo de tool-calls executadas por turno. */
export function getAgentMaxToolCalls(): number {
  return envInt('MAESTRO_AGENT_MAX_TOOL_CALLS', 8);
}

/** Orçamento total de tempo do turno (ms). Estouro → resposta parcial segura. */
export function getAgentTimeoutMs(): number {
  return envInt('MAESTRO_AGENT_TIMEOUT_MS', 25_000);
}

// ─── Escrita assistida (Trilha B — MATRIZ-PERMISSOES-ESCRITA-MAESTRO.md) ─────
// Camada 1 do modelo de decisão (§3): flag global de escrita, default OFF.
// Camada 3: flag específica por ação, default OFF. Ausente = negado.

/** Camada 1 — master switch da escrita assistida do agente. */
export function isAgentWriteEnabled(): boolean {
  return process.env.MAESTRO_AGENT_WRITE_ENABLED === 'true';
}

/** Camada 3 — flag específica da ação salvar_cotacao_como_proposta (§2.1). */
export function isWriteSalvarCotacaoEnabled(): boolean {
  return process.env.MAESTRO_WRITE_SALVAR_COTACAO_ENABLED === 'true';
}

/**
 * Estado de cotação/escrita ativo no contexto V2?
 * Quando true, o turno DEVE permanecer no motor legado — o fluxo de criar/
 * salvar orçamento (escrita) fica intacto no v1 do agent loop.
 */
export function temEstadoDeEscritaAtivo(v2Ctx: MaestroV2Context): boolean {
  return !!(
    v2Ctx.activeQuote ||
    v2Ctx.pendingSaveQuotation ||
    (v2Ctx.domain === 'orcamento_avulso' && (v2Ctx.orcamentoItens?.length ?? 0) > 0) ||
    (v2Ctx.pendingGoal && v2Ctx.pendingGoal.itens.length > 0) ||
    v2Ctx.pendingAddressChoice ||
    v2Ctx.pendingFreightChoice ||
    v2Ctx.pendingProductResolution ||
    v2Ctx.pendingAmbiguousItem ||
    v2Ctx.pendingClientCandidate ||
    (v2Ctx.pendingClientCandidates?.length ?? 0) > 0 ||
    (v2Ctx.pendingBudgetForCandidate?.length ?? 0) > 0
  );
}

/**
 * Decide se o turno atual deve usar o agent loop.
 *   - flag OFF → legado;
 *   - flag ON com estado de cotação/escrita ativo → legado (preserva UX de escrita);
 *   - flag ON e pergunta livre de leitura → agent loop.
 */
export function deveUsarAgentLoop(v2Ctx: MaestroV2Context): boolean {
  if (!isAgentLoopEnabled()) return false;
  return !temEstadoDeEscritaAtivo(v2Ctx);
}
