import { routeToolSimple } from './src/features/maestro/core/simple/maestro-v2-router';
import { getEmptyV2Context } from './src/features/maestro/core/simple/maestro-v2-context-manager';
import type { SimpleClientContext } from './src/features/maestro/core/simple/maestro-simple-context';

async function runRouterPriorityTest() {
  console.log('--- Iniciando Teste do Router de Orçamento Avulso ---\n');
  
  process.env.MAESTRO_V2_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'fake_key';

  const queries = [
    "qual valor pra 1560 tri",
    "1500 ingressos mobi",
    "orçamento para 1500 ingressos mobi"
  ];

  console.log('>>> TESTE 1: MAESTRO_AVULSO_ENABLED = true');
  process.env.MAESTRO_AVULSO_ENABLED = 'true';

  for (const query of queries) {
    const ctx = getEmptyV2Context();
    const result = await routeToolSimple(query, null, null, ctx);
    const tool = result.plan?.steps[0]?.tool;
    console.log(`Input: "${query}"`);
    console.log(`Tool esperada: simularOrcamentoAvulso | Tool recebida: ${tool}`);
    if (tool !== 'simularOrcamentoAvulso') {
      console.error(`❌ FALHA: Deveria ser simularOrcamentoAvulso, mas foi ${tool}\n`);
    } else {
      console.log(`✅ SUCESSO\n`);
    }
  }

  console.log('>>> TESTE 2: MAESTRO_AVULSO_ENABLED = false');
  process.env.MAESTRO_AVULSO_ENABLED = 'false';

  for (const query of queries) {
    const ctx = getEmptyV2Context();
    const result = await routeToolSimple(query, null, null, ctx);
    const tool = result.plan?.steps[0]?.tool;
    console.log(`Input: "${query}"`);
    console.log(`Tool esperada: orcamento_avulso_desativado | Tool recebida: ${tool}`);
    if (tool !== 'orcamento_avulso_desativado') {
      console.error(`❌ FALHA: Deveria ser orcamento_avulso_desativado, mas foi ${tool}\n`);
    } else {
      console.log(`✅ SUCESSO\n`);
    }
  }

  console.log('--- Teste Concluído ---');
}

runRouterPriorityTest().catch(console.error);
