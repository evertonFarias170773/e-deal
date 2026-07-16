import { processarOrcamentoAvulso } from './src/features/maestro/core/simple/maestro-orcamento-engine';
import { handleContextContinuation } from './src/features/maestro/core/simple/maestro-v2-context-manager';
import type { MaestroV2Context } from './src/features/maestro/core/simple/maestro-v2-context-manager';
import type { PostgrestClient } from '@supabase/postgrest-js';

// Mocks
const mockSupabase = {
  rpc: async () => ({ data: [{ id: 1, nomeComercial: 'Cordão 20mm Mock', valor_venda: 10 }] }),
  from: () => ({ select: () => ({ match: () => ({ single: async () => ({ data: { id: 1 } }) }) }) })
} as any;

let v2Ctx: MaestroV2Context = {
  version: 2,
  updatedAt: new Date().toISOString(),
  domain: 'orcamento_avulso',
  activeEntities: {},
  pendingActions: []
};

async function runSim(input: string) {
  console.log(`\n============================`);
  console.log(`[USER]: ${input}`);
  
  // 1. Context Manager intercept?
  const ctxResult = handleContextContinuation(input, v2Ctx, null);
  if (ctxResult && ctxResult.routed) {
    console.log(`[Context Manager] Interceptou: `, JSON.stringify(ctxResult.plan));
    // Simulate what the service does for UPDATE_QTD
    if (ctxResult.plan.steps[0].tool === 'simularOrcamentoAvulso') {
        const engineResult = processarOrcamentoAvulso(input, {
          itens: [],
          pendingAmbiguity: !!v2Ctx.pendingProductResolution || !!v2Ctx.pendingAmbiguousItem,
          pendingQuantidade: v2Ctx.pendingProductResolution?.lastRequestedQuantity || v2Ctx.pendingAmbiguousItem?.lastRequestedQuantity,
          pendingTerm: v2Ctx.pendingProductResolution?.lastRequestedTerm || v2Ctx.pendingAmbiguousItem?.lastRequestedTerm,
          pendingOptions: v2Ctx.pendingAmbiguousItem?.options,
          previousItens: v2Ctx.orcamentoItens || [],
        });
        console.log(`[Engine] Result: `, JSON.stringify(engineResult, null, 2));
    }
  } else {
    const engineResult = processarOrcamentoAvulso(input, {
      itens: [],
      pendingAmbiguity: !!v2Ctx.pendingProductResolution || !!v2Ctx.pendingAmbiguousItem,
      pendingQuantidade: v2Ctx.pendingProductResolution?.lastRequestedQuantity || v2Ctx.pendingAmbiguousItem?.lastRequestedQuantity,
      pendingTerm: v2Ctx.pendingProductResolution?.lastRequestedTerm || v2Ctx.pendingAmbiguousItem?.lastRequestedTerm,
      pendingOptions: v2Ctx.pendingAmbiguousItem?.options,
      previousItens: v2Ctx.orcamentoItens || [],
    });
    console.log(`[Engine] Result: `, JSON.stringify(engineResult, null, 2));
    
    // Update context
    if (engineResult.nextState?.pendingAmbiguity) {
        v2Ctx.pendingAmbiguousItem = {
            options: engineResult.nextState.pendingOptions as any,
            lastRequestedQuantity: engineResult.nextState.pendingQuantidade ?? 1,
            lastRequestedTerm: engineResult.nextState.pendingTerm ?? "",
        };
    } else {
        v2Ctx.pendingAmbiguousItem = null;
    }
  }
}

async function testSuite() {
  console.log(`\n\n--- TESTE 1: "cotação de 200 cordão" -> "opção 1" ---`);
  v2Ctx.pendingAmbiguousItem = null;
  await runSim("cotação de 200 cordão");
  // The engine returns AMBIGUOUS because cordão matches multiple (mocked as multiple in our mock? No, we need a better mock for AMBIGUOUS)
  // Let's just force the AMBIGUOUS state!
  v2Ctx.pendingAmbiguousItem = {
      lastRequestedQuantity: 200,
      lastRequestedTerm: 'cordão',
      options: [
          { index: 1, id: 10, name: 'Cordão 20mm' },
          { index: 2, id: 11, name: 'Cordão 15mm' }
      ]
  };
  await runSim("opção 1");

  console.log(`\n\n--- TESTE 2: "quero a 2" ---`);
  v2Ctx.pendingAmbiguousItem = {
      lastRequestedQuantity: 200,
      lastRequestedTerm: 'cordão',
      options: [
          { index: 1, id: 10, name: 'Cordão 20mm' },
          { index: 2, id: 11, name: 'Cordão 15mm' }
      ]
  };
  await runSim("quero a 2");

  console.log(`\n\n--- TESTE 3: "esse 3" ---`);
  v2Ctx.pendingAmbiguousItem = {
      lastRequestedQuantity: 200,
      lastRequestedTerm: 'cordão',
      options: [
          { index: 1, id: 10, name: 'Cordão 20mm' },
          { index: 2, id: 11, name: 'Cordão 15mm' },
          { index: 3, id: 12, name: 'Cordão 10mm' }
      ]
  };
  await runSim("esse 3");
  
  console.log(`\n\n--- TESTE 4: "quantidade é 500" ---`);
  v2Ctx.pendingAmbiguousItem = {
      lastRequestedQuantity: 200,
      lastRequestedTerm: 'cordão',
      options: [
          { index: 1, id: 10, name: 'Cordão 20mm' },
          { index: 2, id: 11, name: 'Cordão 15mm' }
      ]
  };
  await runSim("quantidade é 500");
  console.log(`[V2Ctx State After Quantidade]: `, JSON.stringify(v2Ctx.pendingAmbiguousItem));
}

testSuite().catch(console.error);
