import { handleContextContinuation } from './maestro-v2-context-manager';
import { getEmptyV2Context } from './maestro-v2-context-manager';

async function test() {
  console.log("=== Teste de Roteamento de Frete Pós-Save ===");

  const ctx = getEmptyV2Context();
  ctx.domain = 'orcamento_avulso';
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

  const queries = [
    'tem opção de sedex no frete?',
    'quais as opcoes de frete',
    'qual o valor do frete',
  ];

  for (const q of queries) {
    console.log(`\nTestando: "${q}"`);
    const result = handleContextContinuation(q, ctx, { clientInternalId: 8469 });
    
    if (result && result.plan?.steps[0]?.tool === 'consultar_fretes_cotacao') {
      console.log(`✅ OK - Roteado para consultar_fretes_cotacao`);
    } else {
      console.log(`❌ FALHOU - Roteamento incorreto. Result:`, JSON.stringify(result));
      process.exit(1);
    }
  }
}

test().catch(console.error);
