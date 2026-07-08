import { routeToolSimple } from './src/features/maestro/core/simple/maestro-v2-router';
import { getEmptyV2Context } from './src/features/maestro/core/simple/maestro-v2-context-manager';

async function test() {
  process.env.MAESTRO_V2_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'fake';
  
  const ctx = getEmptyV2Context();
  
  console.log('\n--- Teste 1: MAESTRO_AVULSO_ENABLED = true ---');
  process.env.MAESTRO_AVULSO_ENABLED = 'true';
  
  const r1 = await routeToolSimple('qual valor pra 1560 tri', null, null, ctx);
  console.log('qual valor pra 1560 tri ->', r1.plan?.steps[0]?.tool || r1);

  const r2 = await routeToolSimple('1500 ingressos mobi', null, null, ctx);
  console.log('1500 ingressos mobi ->', r2.plan?.steps[0]?.tool || r2);

  const r3 = await routeToolSimple('orçamento para 1500 ingressos mobi', null, null, ctx);
  console.log('orçamento para 1500 ingressos mobi ->', r3.plan?.steps[0]?.tool || r3);

  console.log('\n--- Teste 2: MAESTRO_AVULSO_ENABLED = false ---');
  process.env.MAESTRO_AVULSO_ENABLED = 'false';

  const r4 = await routeToolSimple('qual valor pra 1560 tri', null, null, ctx);
  console.log('qual valor pra 1560 tri ->', r4.plan?.steps[0]?.tool || r4);

  const r5 = await routeToolSimple('1500 ingressos mobi', null, null, ctx);
  console.log('1500 ingressos mobi ->', r5.plan?.steps[0]?.tool || r5);

  const r6 = await routeToolSimple('orçamento para 1500 ingressos mobi', null, null, ctx);
  console.log('orçamento para 1500 ingressos mobi ->', r6.plan?.steps[0]?.tool || r6);
}

test();
