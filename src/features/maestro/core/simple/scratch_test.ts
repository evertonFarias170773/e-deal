import { routeToolSimple } from './maestro-v2-router';

async function test() {
  const ctx: any = {
    domain: 'orcamento_avulso',
    activeEntities: {},
    orcamentoItens: [],
    lastTool: null,
    pendingAddressChoice: {
      addresses: [
        { id_endereco: 1, text: 'A' },
        { id_endereco: 2, text: 'B' },
        { id_endereco: 3, text: 'C' }
      ],
      budgetItems: []
    }
  };
  const routeResult = await routeToolSimple('2', null, null, ctx);
  console.log(JSON.stringify(routeResult, null, 2));
}

test();
