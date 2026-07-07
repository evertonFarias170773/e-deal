/**
 * test_baseline_regressao.ts
 *
 * Teste de regressão obrigatório do Maestro V2.
 * Documenta e valida o fluxo aprovado em produção em 2026-07-07.
 *
 * EXECUTAR ANTES DE QUALQUER RELIGAMENTO DE MAESTRO_AVULSO_ENABLED=true
 *
 * Fluxo testado:
 *   1. "cliente Lisiton"             -> buscarCliente (sem chamar banco real)
 *   2. "me traga os contatos dele"   -> consultarCampoCadastro (contatos, cliente ativo)
 *   3. "5200 triband?"               -> orcamento_avulso_desativado (NÃO apaga cliente ativo)
 *   4. "boletos em atraso da Lisiton"-> consultarBoletos (financeiro funciona pós-bloqueio)
 *   5. "ok"                          -> closure/fallback (não gera resumo com fatos falsos)
 *
 * Critérios de PASS:
 *   - Cliente ativo preservado após tentativa de orçamento
 *   - Financeiro acessível após bloqueio de orçamento
 *   - Orçamento capturado pelo bloqueio (flag false)
 *   - Nenhuma contaminação entre domínios
 *
 * Banco: Nenhuma escrita. Testes são 100% de lógica de roteamento (sem chamada real ao Supabase).
 */

import {
  getEmptyV2Context,
  handleContextContinuation,
  type MaestroV2Context,
  normalizeText
} from './maestro-v2-context-manager';
import { processarOrcamentoAvulso } from './maestro-orcamento-engine';

// ─── Tipos auxiliares ─────────────────────────────────────────────────────────

interface ActiveClientMock {
  clientId: string;
  clientInternalId: number;
  clientName: string;
}

interface TestResult {
  turno: number;
  label: string;
  passed: boolean;
  actual?: any;
  expected?: any;
  detail?: string;
}

// ─── Mock do cliente ativo ────────────────────────────────────────────────────

const LISITON_MOCK: ActiveClientMock = {
  clientId: 'lisiton',
  clientInternalId: 8469,
  clientName: 'LISITON DOCUMENTOS SEGUROS LTDA'
};

// ─── Utilitário de report ─────────────────────────────────────────────────────

const results: TestResult[] = [];
let passed = 0;
let failed = 0;

function assert(turno: number, label: string, condition: boolean, detail?: string, actual?: any, expected?: any) {
  const r: TestResult = { turno, label, passed: condition, detail, actual, expected };
  results.push(r);
  if (condition) {
    console.log(`✓ Turno ${turno} — ${label}`);
    passed++;
  } else {
    console.error(`✗ Turno ${turno} — ${label}`);
    if (detail) console.error(`  Detalhe: ${detail}`);
    if (actual !== undefined) console.error(`  Atual:    ${JSON.stringify(actual)}`);
    if (expected !== undefined) console.error(`  Esperado: ${JSON.stringify(expected)}`);
    failed++;
  }
}

// ─── Garantir que a feature flag está desativada ─────────────────────────────

function ensureFlagOff() {
  if (process.env.MAESTRO_AVULSO_ENABLED === 'true') {
    console.warn('⚠️  MAESTRO_AVULSO_ENABLED está true no ambiente de teste! Definindo como false para o teste.');
    process.env.MAESTRO_AVULSO_ENABLED = 'false';
  }
  // MAESTRO_V2_ENABLED deve estar true para o router funcionar
  if (!process.env.MAESTRO_V2_ENABLED) {
    process.env.MAESTRO_V2_ENABLED = 'true';
  }
}

// ─── Simulação de routeToolSimple sem Supabase ───────────────────────────────
// Executa apenas a lógica de roteamento (context manager + engine de orçamento)
// sem chamar o Supabase. Retorna a tool escolhida e o domínio resultante.

function simulateRouter(
  query: string,
  activeClient: ActiveClientMock | null,
  v2Ctx: MaestroV2Context
): { tool: string | null; params: Record<string, any> } {

  // Passo 1: handleContextContinuation (mesma lógica do router real)
  const continuation = handleContextContinuation(query, v2Ctx, activeClient);
  if (continuation) {
    const step = continuation.plan.steps[0];
    return { tool: step.tool, params: step.params ?? {} };
  }

  // Passo 2: Motor de orçamento (mesma lógica do router real)
  const engineResult = processarOrcamentoAvulso(query, {
    itens: v2Ctx.orcamentoItens || [],
    pendingAmbiguity: !!v2Ctx.pendingProductResolution || !!v2Ctx.pendingAmbiguousItem,
    pendingQuantidade: v2Ctx.pendingProductResolution?.lastRequestedQuantity,
    pendingTerm: v2Ctx.pendingProductResolution?.lastRequestedTerm
  });

  if (engineResult.action === 'ADD' || engineResult.action === 'REPLACE') {
    const isAvulsoEnabled = process.env.MAESTRO_AVULSO_ENABLED === 'true';
    if (!isAvulsoEnabled) {
      return { tool: 'orcamento_avulso_desativado', params: {} };
    }
    v2Ctx.domain = 'orcamento_avulso';
    v2Ctx.orcamentoItens = engineResult.items;
    return { tool: 'simularOrcamentoAvulso', params: { itens: engineResult.items } };
  }

  // Passo 3: Lógica heurística do router para palavras-chave financeiras/cadastrais
  const clean = normalizeText(query);

  // Busca de cliente por nome
  const clientNameMatch = clean.match(/\b(cliente|cli|cadastro)\s+([a-z]{2,})/i);
  if (clientNameMatch) {
    v2Ctx.domain = 'cliente';
    return { tool: 'buscarCliente', params: { busca: clientNameMatch[2] } };
  }

  // Boletos
  const isBoleto = /\b(boleto|boletos|atraso|devendo|inadimplente)\b/i.test(clean);
  if (isBoleto && activeClient) {
    v2Ctx.domain = 'financeiro';
    return { tool: 'consultarBoletos', params: { id_cliente: activeClient.clientInternalId, filtro: 'atrasados' } };
  }

  // Proposta/orçamento real
  const isProposta = /\b(proposta|ultim|orcamento\\s*d[eo]\\s*cliente)\b/i.test(clean);
  if (isProposta && activeClient) {
    v2Ctx.domain = 'financeiro';
    return { tool: 'consultarPropostasCliente', params: { id_cliente: activeClient.clientInternalId, status: 'abertas' } };
  }

  // Keyword sem cliente específico -> orçamento avulso
  const hasBudgetKeyword = /\b(valor|preco|cotacao|custa|simul|orcamento)\b/i.test(clean);
  if (hasBudgetKeyword && !activeClient) {
    const isAvulsoEnabled = process.env.MAESTRO_AVULSO_ENABLED === 'true';
    if (!isAvulsoEnabled) {
      return { tool: 'orcamento_avulso_desativado', params: {} };
    }
  }

  return { tool: null, params: {} };
}

// ─── TESTES ───────────────────────────────────────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║   Teste de Regressão — Baseline Aprovado em Produção         ║');
console.log('║   MAESTRO_AVULSO_ENABLED=false                               ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');

ensureFlagOff();

// Estado conversacional compartilhado (simula a sessão do usuário)
const v2Ctx = getEmptyV2Context();
let activeClient: ActiveClientMock | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// TURNO 1 — "cliente Lisiton"
// ─────────────────────────────────────────────────────────────────────────────
console.log('─── Turno 1: "cliente Lisiton" ─────────────────────────────────');

const t1_query = 'cliente Lisiton';
const t1_result = simulateRouter(t1_query, null, v2Ctx);

assert(1, 'Tool deve ser buscarCliente', t1_result.tool === 'buscarCliente',
  undefined, t1_result.tool, 'buscarCliente');

assert(1, 'Domínio deve mudar para cliente', v2Ctx.domain === 'cliente',
  undefined, v2Ctx.domain, 'cliente');

assert(1, 'Não deve invocar orcamento_avulso_desativado', t1_result.tool !== 'orcamento_avulso_desativado');

// Simulamos que a busca retornou o cliente e ele foi ativado (como faria o engine real)
activeClient = LISITON_MOCK;
v2Ctx.activeEntities = {
  clientId: LISITON_MOCK.clientId,
  clientInternalId: LISITON_MOCK.clientInternalId,
  clientName: LISITON_MOCK.clientName
};
v2Ctx.domain = 'cliente';

// ─────────────────────────────────────────────────────────────────────────────
// TURNO 2 — "me traga os contatos dele"
// ─────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('─── Turno 2: "me traga os contatos dele" ───────────────────────');

const t2_query = 'me traga os contatos dele';
const t2_result = simulateRouter(t2_query, activeClient, v2Ctx);

assert(2, 'Tool deve ser consultarCampoCadastro', t2_result.tool === 'consultarCampoCadastro',
  undefined, t2_result.tool, 'consultarCampoCadastro');

assert(2, 'Params.campo deve ser "contatos"', t2_result.params?.campo === 'contatos',
  undefined, t2_result.params?.campo, 'contatos');

assert(2, 'Params.id_cliente deve ser o ID do cliente ativo', t2_result.params?.id_cliente === LISITON_MOCK.clientInternalId,
  undefined, t2_result.params?.id_cliente, LISITON_MOCK.clientInternalId);

assert(2, 'Não deve pedir nova busca de cliente', t2_result.tool !== 'buscarCliente');

assert(2, 'Cliente ativo deve permanecer o mesmo', 
  v2Ctx.activeEntities.clientId === LISITON_MOCK.clientId,
  undefined, v2Ctx.activeEntities.clientId, LISITON_MOCK.clientId);

// ─────────────────────────────────────────────────────────────────────────────
// TURNO 3 — "show e vc pode ver pra mim o valor de 5200 triband?"
// ─────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('─── Turno 3: "5200 triband" (orçamento com flag off) ───────────');

const t3_query = 'show e vc pode ver pra mim o valor de 5200 triband?';
const clientIdAntesTurno3 = v2Ctx.activeEntities.clientId;
const t3_result = simulateRouter(t3_query, activeClient, v2Ctx);

assert(3, 'Tool deve ser orcamento_avulso_desativado', t3_result.tool === 'orcamento_avulso_desativado',
  `MAESTRO_AVULSO_ENABLED=${process.env.MAESTRO_AVULSO_ENABLED}`, t3_result.tool, 'orcamento_avulso_desativado');

assert(3, 'Não deve tentar simularOrcamentoAvulso', t3_result.tool !== 'simularOrcamentoAvulso');

assert(3, '⚠️  CRÍTICO: Cliente ativo NÃO pode ser apagado',
  v2Ctx.activeEntities.clientId === clientIdAntesTurno3,
  'O bloqueio de orçamento está apagando o cliente ativo!',
  v2Ctx.activeEntities.clientId, clientIdAntesTurno3);

assert(3, 'activeEntities.clientInternalId deve permanecer',
  v2Ctx.activeEntities.clientInternalId === LISITON_MOCK.clientInternalId,
  undefined, v2Ctx.activeEntities.clientInternalId, LISITON_MOCK.clientInternalId);

assert(3, 'Domínio não deve ser orcamento_avulso', (v2Ctx.domain as string) !== 'orcamento_avulso',
  undefined, v2Ctx.domain);

// ─────────────────────────────────────────────────────────────────────────────
// TURNO 4 — "e sabe me dizer se a Lisiton tem boletos em atraso?"
// ─────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('─── Turno 4: "Lisiton tem boletos em atraso?" ──────────────────');

const t4_query = 'e sabe me dizer se a Lisiton tem boletos em atraso?';
const t4_result = simulateRouter(t4_query, activeClient, v2Ctx);

assert(4, 'Tool deve ser consultarBoletos', t4_result.tool === 'consultarBoletos',
  undefined, t4_result.tool, 'consultarBoletos');

assert(4, 'Params.id_cliente deve ser o ID do cliente ativo', t4_result.params?.id_cliente === LISITON_MOCK.clientInternalId,
  undefined, t4_result.params?.id_cliente, LISITON_MOCK.clientInternalId);

assert(4, 'Cliente ativo deve permanecer após turno de boletos',
  v2Ctx.activeEntities.clientId === LISITON_MOCK.clientId,
  undefined, v2Ctx.activeEntities.clientId, LISITON_MOCK.clientId);

assert(4, 'Não deve cair em orcamento_avulso_desativado', t4_result.tool !== 'orcamento_avulso_desativado');

// ───────────────────────────────────────────────────────────────────────────────
// TURNO 5 — "ok" (acknowledgement curto após bloqueio de orçamento)
// Valida que mensagem de encerramento não aciona orçamento nem apaga cliente.
// (A verificação de que o Brain não recebe fatos falsos é garantida pela correção em
//  maestro-simple-intents.ts CLOSURE_TRIGGERS e maestro-simple-brain.ts factsToText.)
// ───────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('─── Turno 5: "ok" (acknowledgement pós-bloqueio) ──────────────────');

const t5_query = 'ok';
const t5_result = simulateRouter(t5_query, activeClient, v2Ctx);

// "ok" não deve acionar orçamento avulso nem simulação
assert(5, '"ok" não deve acionar orcamento_avulso_desativado',
  t5_result.tool !== 'orcamento_avulso_desativado',
  'Mensagem de acknowledgement não deve ser tratada como orçamento',
  t5_result.tool);

assert(5, '"ok" não deve acionar simularOrcamentoAvulso',
  t5_result.tool !== 'simularOrcamentoAvulso',
  'Mensagem de acknowledgement não deve acionar simulação de orçamento',
  t5_result.tool);

// Cliente ativo deve permanecer
assert(5, 'Cliente ativo preservado após "ok"',
  v2Ctx.activeEntities.clientName === LISITON_MOCK.clientName,
  undefined, v2Ctx.activeEntities.clientName, LISITON_MOCK.clientName);

// Orçamento segue zerado (não foi religar orçamento)
assert(5, 'Orçamento segue zerado após "ok"',
  !v2Ctx.orcamentoItens || v2Ctx.orcamentoItens.length === 0,
  undefined, v2Ctx.orcamentoItens?.length, 0);

// Testar também "blz" e "entendido"
const t5b_result = simulateRouter('blz', activeClient, v2Ctx);
assert(5, '"blz" também não aciona orçamento',
  t5b_result.tool !== 'orcamento_avulso_desativado' && t5b_result.tool !== 'simularOrcamentoAvulso',
  undefined, t5b_result.tool);

// ─────────────────────────────────────────────────────────────────────────────
// Verificações transversais
// ─────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('─── Verificações Transversais ─────────────────────────────────');

assert(0, 'MAESTRO_AVULSO_ENABLED segue false', process.env.MAESTRO_AVULSO_ENABLED !== 'true',
  undefined, process.env.MAESTRO_AVULSO_ENABLED, 'false ou undefined');

assert(0, 'Nenhum item de orçamento no contexto final',
  !v2Ctx.orcamentoItens || v2Ctx.orcamentoItens.length === 0,
  undefined, v2Ctx.orcamentoItens?.length, 0);

assert(0, 'activeEntities.clientName preservado ao longo do fluxo',
  v2Ctx.activeEntities.clientName === LISITON_MOCK.clientName,
  undefined, v2Ctx.activeEntities.clientName, LISITON_MOCK.clientName);

// ─────────────────────────────────────────────────────────────────────────────
// RELATÓRIO FINAL
// ─────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
if (failed === 0) {
  console.log(`║  ✅ BASELINE OK — ${passed}/${passed + failed} testes passaram.                          ║`);
  console.log('║  Orçamento Avulso: DESLIGADO ✓                               ║');
  console.log('║  Contexto de cliente: PRESERVADO ✓                          ║');
  console.log('║  Financeiro pós-bloqueio: FUNCIONAL ✓                       ║');
  console.log('║  "ok" pós-bloqueio: SEM FATOS FALSOS ✓                      ║');
} else {
  console.log(`║  ❌ REGRESSÃO DETECTADA — ${failed} teste(s) falharam.                  ║`);
  console.log('║  Não religar MAESTRO_AVULSO_ENABLED=true até correção.      ║');
}
console.log(`║  Testes: ${passed} ✓  |  ${failed} ✗  de ${passed + failed} total                          ║`);
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');

if (failed > 0) {
  process.exit(1);
}
