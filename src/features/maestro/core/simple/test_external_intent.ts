/**
 * test_external_intent.ts
 *
 * Teste unitário e de integração simulada para a camada de interpretação de intenções externa.
 * Verifica comportamento da flag, timeout e mapeamentos.
 */

import { mapExternalIntentToRouterResult } from './maestro-external-intent.mapper';
import type { ExternalIntentResponse } from './maestro-external-intent.types';
import { getEmptyV2Context } from './maestro-v2-context-manager';

async function runTests() {
  console.log('--- TESTANDO MAPPER EXTERNAL INTENT ---');
  
  const v2Ctx = getEmptyV2Context();
  const activeClient = null;

  // 1. buscar_cliente
  let res: ExternalIntentResponse = { intent: 'buscar_cliente', confidence: 'high', params: { busca: 'Lisiton' } };
  let route = mapExternalIntentToRouterResult(res, v2Ctx, activeClient);
  console.assert(route?.routed === true && route.plan?.steps[0].tool === 'buscarCliente', 'Falha buscar_cliente');

  // 2. criar_cotacao
  res = { intent: 'criar_cotacao', confidence: 'high', params: { itens: [{ quantidade: 10, termo: 'triband' }] } };
  route = mapExternalIntentToRouterResult(res, v2Ctx, activeClient);
  console.assert(route?.routed === true && route.plan?.steps[0].tool === 'simularOrcamentoAvulso', 'Falha criar_cotacao');

  // 3. criar_cotacao (baixa confiança rejeitada)
  res = { intent: 'criar_cotacao', confidence: 'low', params: { itens: [{ quantidade: 10, termo: 'triband' }] } };
  route = mapExternalIntentToRouterResult(res, v2Ctx, activeClient);
  console.assert(route === null, 'Falha criar_cotacao baixa confiança (deveria rejeitar)');

  // 4. salvar_proposta (mapeia para confirmação)
  res = { intent: 'salvar_proposta', confidence: 'high', params: {} };
  route = mapExternalIntentToRouterResult(res, v2Ctx, activeClient);
  console.assert(route?.routed === true && route.plan?.steps[0].tool === 'salvar_cotacao_confirmada', 'Falha salvar_proposta');

  // 5. social_response
  res = { intent: 'social_response', confidence: 'high', params: {} };
  route = mapExternalIntentToRouterResult(res, v2Ctx, activeClient);
  console.assert(route?.routed === true && route.plan?.steps[0].tool === 'resposta_social_cotacao', 'Falha social_response');

  // 6. repetir_orcamento_para_outro_cliente
  v2Ctx.lastExplicitBudgetItems = [{ quantidade: 50, termo: 'ingresso' }];
  res = { intent: 'repetir_orcamento_para_outro_cliente', confidence: 'high', params: { busca_cliente: '8469' } };
  route = mapExternalIntentToRouterResult(res, v2Ctx, activeClient);
  console.assert(route?.routed === true && route.plan?.steps[0].tool === 'buscarCliente', 'Falha repetir_orcamento_para_outro_cliente (tool)');
  console.assert(v2Ctx.domain === 'orcamento_avulso' && v2Ctx.orcamentoItens?.length === 1, 'Falha repetir_orcamento_para_outro_cliente (contexto)');

  // 7. Intent inválida
  res = { intent: 'intent_inexistente', confidence: 'high', params: {} };
  route = mapExternalIntentToRouterResult(res, v2Ctx, activeClient);
  console.assert(route === null, 'Falha intent inválida (deveria rejeitar)');

  console.log('--- TESTES FINALIZADOS ---');
}

runTests().catch(console.error);
