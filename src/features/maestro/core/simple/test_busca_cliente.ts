import assert from 'assert';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { handleContextContinuation, getEmptyV2Context } from './maestro-v2-context-manager';
import { routeToolSimple } from './maestro-v2-router';
import { detectIntent } from './maestro-simple-intents';

async function test() {
  console.log("=== Teste de Regressão da Busca de Cliente ===");

  const ctx = getEmptyV2Context();
  ctx.domain = 'cliente';
  ctx.activeEntities = { clientInternalId: 8469, clientName: 'Lisiton' };
  ctx.pendingSaveQuotation = { 
    id_proposta: null, 
    status: 'draft', 
    items: [], 
    freteSugerido: null,
    domain: 'orcamento_avulso' 
  } as any;

  const activeClient = {
    clientInternalId: 8469,
    clientName: 'Lisiton'
  };

  async function testRoute(query: string, expectedTool: string) {
    console.log(`\nTestando: "${query}"`);
    const intent = detectIntent(query);
    if (intent.type === 'client_lookup' || intent.type === 'client_switch') {
      const tool = 'buscarCliente';
      console.log(`[DetectIntent] Resolvido para: ${tool}`);
      assert.strictEqual(tool, expectedTool, `DetectIntent errou. Esperava ${expectedTool}, obteve ${tool}`);
      return;
    }

    let result = handleContextContinuation(query, ctx, activeClient);
    
    if (result) {
      const tool = result.plan?.steps[0]?.tool;
      console.log(`[ContextManager] Resolvido para: ${tool}`);
      assert.strictEqual(tool, expectedTool, `Context manager errou. Esperava ${expectedTool}, obteve ${tool}`);
    } else {
      console.log(`[ContextManager] Passou adiante. Chamando Router...`);
      const routerResult = await routeToolSimple(query, activeClient as any, { type: 'none', label: '', value: '', reason: '', data: null }, ctx as any);
      const tool = routerResult.plan?.steps[0]?.tool;
      console.log(`[Router] Resolvido para: ${tool}`);
      assert.strictEqual(tool, expectedTool, `Router errou. Esperava ${expectedTool}, obteve ${tool}`);
    }
  }

  // 1. Contextual (deve usar consultarCampoCadastro)
  await testRoute('qual telefone dele?', 'consultarCampoCadastro');
  await testRoute('ele tem boletos?', 'consultarBoletos');

  // 2. Busca nova (deve ignorar cliente ativo e usar buscarCliente)
  await testRoute('tem cliente chamado Edison Farias?', 'buscarCliente');
  await testRoute('Edison Santos?', 'buscarCliente');
  await testRoute('eu pergunteu Edison Santos, tem?', 'buscarCliente');
  await testRoute('e Edison Jr.?', 'buscarCliente');
  await testRoute('Lisiton?', 'buscarCliente');

  console.log("\n✅ Todos os testes do roteador de cliente passaram!");
}

test().catch(err => {
  console.error("❌ FALHA NO TESTE:", err.message);
  process.exit(1);
});
