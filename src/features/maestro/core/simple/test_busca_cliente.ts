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
  ctx.pendingSaveQuotation = null;

  const activeClient = {
    clientInternalId: 8469,
    clientName: 'Lisiton'
  };

  async function testRoute(query: string, expectedTool: string) {
    console.log(`\nTestando: "${query}"`);
    const intent = detectIntent(query);
    if (intent.type === 'client_lookup' || intent.type === 'client_switch') {
      const tool = 'buscarCliente';
      console.log(`[DetectIntent] Resolvido para: ${tool} (intent.type=${intent.type}, doc=${intent.document}, name=${intent.name}, partial=${intent.documentPartial})`);
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
      const routerResult = await routeToolSimple(query, activeClient as any, { type: 'other', label: '', value: '', reason: '', data: null } as any, ctx as any);
      const tool = routerResult.plan?.steps[0]?.tool;
      console.log(`[Router] Resolvido para: ${tool}`);
      assert.strictEqual(tool, expectedTool, `Router errou. Esperava ${expectedTool}, obteve ${tool}`);
    }
  }

  // 1. Contextual (deve usar consultarCampoCadastro)
  await testRoute('qual telefone dele?', 'consultarCampoCadastro');
  await testRoute('ele tem boletos?', 'consultarBoletos');

  // 2. Busca nova por nome (deve ignorar cliente ativo e usar buscarCliente)
  await testRoute('tem cliente chamado Edison Farias?', 'buscarCliente');
  await testRoute('Edison Santos?', 'buscarCliente');
  await testRoute('eu pergunteu Edison Santos, tem?', 'buscarCliente');
  await testRoute('e Edison Jr.?', 'buscarCliente');
  await testRoute('Lisiton?', 'buscarCliente');

  // 3. Busca nova por prefixo explícito (não deve usar cliente ativo)
  await testRoute('sobre o cliente Zaffari', 'buscarCliente');
  await testRoute('E o cliente Everton Farias?', 'buscarCliente');
  await testRoute('sobre o cliente Everton Farias', 'buscarCliente');

  // 4. Busca por documento parcial (não deve usar cliente ativo)
  await testRoute('cpf 671490', 'buscarCliente');
  await testRoute('cpf 67149049087', 'buscarCliente');
  await testRoute('cnpj 93015006', 'buscarCliente');

  // 5. Verifica que CPF parcial é marcado como documentPartial
  {
    const i = detectIntent('cpf 671490');
    assert.strictEqual(i.type, 'client_lookup', 'cpf 671490 deve ser client_lookup');
    assert.strictEqual(i.documentPartial, true, 'cpf 671490 deve ter documentPartial=true');
    assert.strictEqual(i.documentType, 'cpf', 'cpf 671490 deve ter documentType=cpf');
    console.log('\n[Assertion] cpf 671490 => documentPartial=true ✅');
  }
  {
    const i = detectIntent('cpf 67149049087');
    assert.strictEqual(i.type, 'client_lookup', 'cpf completo deve ser client_lookup');
    assert.strictEqual(i.documentPartial, false, 'cpf completo nao deve ser documentPartial');
    console.log('[Assertion] cpf 67149049087 => documentPartial=false ✅');
  }

  console.log("\n✅ Todos os testes do roteador de cliente passaram!");
}

test().catch(err => {
  console.error("❌ FALHA NO TESTE:", err.message);
  process.exit(1);
});
