import { processarOrcamentoAvulso, OrcamentoAvulsoState } from './maestro-orcamento-engine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('Iniciando testes do motor de orçamento avulso...\n');

  let state: OrcamentoAvulsoState = {
    itens: [],
    pendingAmbiguity: false
  };

  // 1. "15600 mobi + 1500 triband qual valor?"
  console.log('Teste 1: Extracao de multiplos itens');
  let result = processarOrcamentoAvulso('15600 mobi + 1500 triband qual valor?', state);
  assert(result.action === 'ADD' || result.action === 'REPLACE', 'Ação deve ser ADD ou REPLACE');
  assert(result.items.length === 2, 'Deve extrair 2 itens');
  assert(result.items[0].quantidade === 15600 && result.items[0].termo === 'mobi', 'Item 1 incorreto');
  assert(result.items[1].quantidade === 1500 && result.items[1].termo === 'triband', 'Item 2 incorreto');
  state = result.nextState;
  console.log('✓ Passou');

  // 2. "muda a qtd do mobi pra 10k"
  console.log('Teste 2: Atualização de quantidade (10k)');
  result = processarOrcamentoAvulso('muda a qtd do mobi pra 10k', state);
  assert(result.action === 'UPDATE_QTD', 'Ação deve ser UPDATE_QTD');
  assert(result.items.length === 2, 'Ainda deve ter 2 itens');
  assert(result.items[0].quantidade === 10000 && result.items[0].termo === 'mobi', 'Item 1 deve ter quantidade alterada para 10000');
  state = result.nextState;
  console.log('✓ Passou');

  // 3. "muda a quantidade do mobi para 10.000"
  console.log('Teste 3: Atualização de quantidade (10.000 com ponto)');
  result = processarOrcamentoAvulso('muda a quantidade do mobi para 10.000', state);
  assert(result.action === 'UPDATE_QTD', 'Ação deve ser UPDATE_QTD');
  assert(result.items[0].quantidade === 10000 && result.items[0].termo === 'mobi', 'Item 1 deve manter 10000 (parsing correto do ponto)');
  state = result.nextState;
  console.log('✓ Passou');

  // 4. "10600 mobi + 1500 triband qual valor?" (Replace limpo)
  console.log('Teste 4: Substituição limpa de itens');
  result = processarOrcamentoAvulso('10600 mobi + 1500 triband qual valor?', state);
  assert(result.action === 'REPLACE', 'Ação deve ser REPLACE');
  assert(result.items.length === 2, 'Deve continuar com 2 itens');
  assert(result.items[0].quantidade === 10600 && result.items[0].termo === 'mobi', 'Novo valor do Mobi: 10600');
  state = result.nextState;
  console.log('✓ Passou');

  // 5. "assim não dá"
  console.log('Teste 5: Cancelamento');
  result = processarOrcamentoAvulso('assim não dá', state);
  assert(result.action === 'CLEAR', 'Ação deve ser CLEAR');
  assert(result.items.length === 0, 'Itens devem estar vazios');
  state = result.nextState;
  console.log('✓ Passou');

  // 6. "cliente 101"
  console.log('Teste 6: Ignorar pedido de cliente (devolver ao router)');
  result = processarOrcamentoAvulso('cliente 101', state);
  assert(result.action === 'NONE', 'Ação deve ser NONE');
  state = result.nextState;
  console.log('✓ Passou');

  // 7. "101" - Testando com pendencia e sem pendencia
  console.log('Teste 7a: "101" sem pendência');
  result = processarOrcamentoAvulso('101', state);
  assert(result.action === 'NONE', 'Ação deve ser NONE sem pendencia');
  
  console.log('Teste 7b: "101" com pendência');
  state.pendingAmbiguity = true;
  state.pendingQuantidade = 5000;
  state.pendingTerm = 'pulseira';
  result = processarOrcamentoAvulso('101', state);
  assert(result.action === 'ADD', 'Ação deve ser ADD resolvendo pendência');
  assert(result.items.length === 1, 'Deve adicionar o item resolvido');
  assert(result.items[0].produtoId === 101, 'ID do produto deve ser 101');
  assert(result.items[0].quantidade === 5000, 'A quantidade do pendente deve vir junto');
  console.log('✓ Passou');

  console.log('\nTodos os 7 testes foram concluídos com SUCESSO! 🚀');
}

runTests().catch(e => {
  console.error('\nErro no teste:', e.message);
  process.exit(1);
});
