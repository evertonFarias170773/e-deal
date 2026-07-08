import { routeToolSimple } from './src/features/maestro/core/simple/maestro-v2-router';
import { processarOrcamentoAvulso } from './src/features/maestro/core/simple/maestro-orcamento-engine';

process.env.MAESTRO_V2_ENABLED = 'true';
process.env.MAESTRO_AVULSO_ENABLED = 'false';

async function run() {
  const v2Ctx = {
    domain: 'financeiro',
    orcamentoItens: [],
    lastSuccessfulBudgetItems: [],
    previousOrcamentoItens: []
  };

  const activeClient = {
    clientInternalId: 100,
    clientName: 'Lisiton',
    clientCnpj: '0000',
    clientStatus: 'Ativo'
  };

  console.log("Teste isolado do motor:");
  const engineResult = processarOrcamentoAvulso('qual o valor pra 1560 tri', { itens: [], pendingAmbiguity: false });
  console.log(engineResult.action, engineResult.items);

  console.log("\nTeste do router:");
  const route = await routeToolSimple('qual o valor pra 1560 tri', activeClient as any, null, v2Ctx as any);
  console.log(JSON.stringify(route, null, 2));
}

run();
