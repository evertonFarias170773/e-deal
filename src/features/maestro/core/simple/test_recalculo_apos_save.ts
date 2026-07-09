import { getEmptyV2Context } from './maestro-v2-context-manager';
import { routeToolSimple } from './maestro-v2-router';
import { processarOrcamentoAvulso } from './maestro-orcamento-engine';

async function test() {
  console.log("=== Teste de Recálculo Após Save ===");

  const ctx = getEmptyV2Context();
  ctx.domain = 'orcamento_avulso';
  ctx.orcamentoItens = [{ quantidade: 15600, termo: 'triband' }];
  ctx.pendingSaveQuotation = {
    clientInternalId: 8469,
    clientName: 'Lisiton',
    enderecoId: 'fake',
    cep: 'fake',
    cidade: 'fake',
    uf: 'fake',
    enderecoFull: 'fake',
    itens: [],
    freteEscolhido: { id: 'sedex', servico: 'sedex', transportadora: 'correios', valor: 20, prazo: '1 dia', pesoUsado: 1 },
    subtotal: 100,
    total: 120,
    pesoTotalGramas: 1000,
    timestamp: new Date().toISOString(),
    savedIdInt: 9999,
  };

  const query = 'recalcule para 60000 und';

  console.log("Contexto preenchido. Enviando query:", query);
  
  const engineResult = processarOrcamentoAvulso(query, { itens: ctx.orcamentoItens || [], pendingAmbiguity: false });
  console.log("Engine Result:", JSON.stringify(engineResult, null, 2));

  if (engineResult.action === 'UPDATE_QTD' && engineResult.items[0].quantidade === 60000) {
    console.log("✅ OK - Item único atualizado ignorando termo vazio.");
  } else {
    console.log("❌ FALHOU - Não atualizou item único.");
    process.exit(1);
  }

  // Em maestro-simple-engine.ts, interceptaríamos isso e resetariamos o savedIdInt
  if (['ADD', 'UPDATE_QTD', 'REMOVE', 'REPLACE', 'RESTORE'].includes(engineResult.action) && ctx.pendingSaveQuotation?.savedIdInt) {
    console.log("✅ OK - Ação identificada mudaria o orçamento. savedIdInt seria limpo no engine.");
  } else {
    console.log("❌ FALHOU - Condição não simulada corretamente.");
    process.exit(1);
  }
}

test().catch(console.error);
