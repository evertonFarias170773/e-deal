/**
 * test_cotacao_ativa.ts
 * npx tsx src/features/maestro/core/simple/test_cotacao_ativa.ts
 */

import {
  getEmptyV2Context,
  handleContextContinuation,
  detectQuoteQuery,
  detectFreightSwitch,
} from './maestro-v2-context-manager';

const MOCK_FRETES = [
  { id: 'unesul-001', servico: 'Rodoviario', transportadora: 'Unesul', valor: 69.32, prazo: '3 dias uteis', pesoUsado: 1200 },
  { id: 'sao-miguel-001', servico: 'Rodoviario', transportadora: 'Sao Miguel', valor: 140.96, prazo: '2 dias uteis', pesoUsado: 1200 },
  { id: 'sedex-001', servico: 'SEDEX', transportadora: 'Correios SEDEX', valor: 549.39, prazo: '1 dia util', pesoUsado: 1200 },
];

const MOCK_QUOTE = {
  createdAt: new Date().toISOString(), clientInternalId: 8469, clientName: 'LISITON DOCUMENTOS SEGUROS LTDA',
  itens: [
    { id_produto: 101, nome: 'Pulseira Triband Sintetica', quantidade: 15000, valorUnitario: 0.12, valorFixo: 580, subtotal: 2440, pesoUnitario: 0.05 },
    { id_produto: 202, nome: 'Cordao Jaccare', quantidade: 1500, valorUnitario: 1.72, valorFixo: 490, subtotal: 4070, pesoUnitario: 0.4 },
  ],
  enderecoId: 'end-uuid-02', enderecoFull: 'Travessa Canoas, 39 - Centro, Santa Cruz do Sul/RS',
  cep: '96810-000', cidade: 'Santa Cruz do Sul', uf: 'RS',
  fretes: MOCK_FRETES, freteSelecionado: MOCK_FRETES[2],
  subtotalProdutos: 6510, total: 7059.39, pesoTotalGramas: 1224, status: 'nao_salva' as const,
};

let passed = 0, failed = 0;
function assert(ok: boolean, name: string, detail = '') {
  if (ok) { console.log('OK  ' + name); passed++; }
  else { console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); failed++; }
}

console.log('\n=== Suite 1: detectQuoteQuery ===');
assert(detectQuoteQuery('qual subtotal dos produtos') === 'subtotal', 'subtotal');
assert(detectQuoteQuery('qual o total') === 'total', 'total');
assert(detectQuoteQuery('total final') === 'total', 'total final');
assert(detectQuoteQuery('qual frete foi sugerido') === 'frete_sugerido', 'frete_sugerido');
assert(detectQuoteQuery('quais transportadoras apareceram') === 'transportadoras', 'transportadoras');
assert(detectQuoteQuery('qual endereco foi usado') === 'endereco', 'endereco');
assert(detectQuoteQuery('me resume essa cotacao') === 'resumo', 'resumo');
assert(detectQuoteQuery('peso total') === 'peso', 'peso');
assert(detectQuoteQuery('bom dia') === null, 'bom dia nao e cotacao');

console.log('\n=== Suite 2: detectFreightSwitch ===');
const r1 = detectFreightSwitch('mude para sao miguel', MOCK_FRETES);
assert(Boolean(r1 && r1.found === true && (r1 as any).frete.transportadora === 'Sao Miguel'), 'mude para sao miguel');
const r2 = detectFreightSwitch('use a unesul', MOCK_FRETES);
assert(Boolean(r2 && r2.found === true && (r2 as any).frete.transportadora === 'Unesul'), 'use a unesul');
const r3 = detectFreightSwitch('usa o sedex', MOCK_FRETES);
assert(Boolean(r3 && r3.found === true && (r3 as any).frete.transportadora === 'Correios SEDEX'), 'usa o sedex');
const r4 = detectFreightSwitch('usa o mais barato', MOCK_FRETES);
assert(Boolean(r4 && r4.found === true && (r4 as any).frete.valor === 69.32), 'mais barato = unesul');
const r5 = detectFreightSwitch('mude para braspress', MOCK_FRETES);
assert(Boolean(r5 && r5.found === false && (r5 as any).mentioned === 'braspress'), 'braspress nao disponivel');
const r6 = detectFreightSwitch('qual subtotal', MOCK_FRETES);
assert(r6 === null, 'subtotal nao e troca de frete');

console.log('\n=== Suite 3: P4 consulta ===');
function testP4(query: string, expectedTool: string) {
  const ctx = getEmptyV2Context();
  ctx.activeQuote = { ...MOCK_QUOTE };
  const result = handleContextContinuation(query, ctx, null);
  const tool = result?.plan?.steps?.[0]?.tool;
  assert(result?.routed && tool === expectedTool, '"' + query + '" -> ' + expectedTool, 'got: ' + tool);
}
testP4('qual subtotal dos produtos', 'consultar_cotacao_ativa');
testP4('qual o total', 'consultar_cotacao_ativa');
testP4('qual frete foi sugerido', 'consultar_cotacao_ativa');
testP4('quais transportadoras apareceram nessa cotacao', 'consultar_cotacao_ativa');
testP4('qual endereco foi usado nessa cotacao', 'consultar_cotacao_ativa');
testP4('me resume essa cotacao', 'consultar_cotacao_ativa');
testP4('qual peso total', 'consultar_cotacao_ativa');

console.log('\n=== Suite 4: P4 troca frete ===');
function testFSwitch(query: string, expectedTool: string) {
  const ctx = getEmptyV2Context();
  ctx.activeQuote = { ...MOCK_QUOTE };
  const result = handleContextContinuation(query, ctx, null);
  const tool = result?.plan?.steps?.[0]?.tool;
  assert(result?.routed && tool === expectedTool, '"' + query + '" -> ' + expectedTool, 'got: ' + tool);
}
testFSwitch('mude para sao miguel', 'trocar_frete_cotacao_ativa');
testFSwitch('use a unesul', 'trocar_frete_cotacao_ativa');
testFSwitch('usa o mais barato', 'trocar_frete_cotacao_ativa');
testFSwitch('mude para braspress', 'frete_nao_disponivel');

console.log('\n=== Suite 5: troca endereco ===');
{ const ctx = getEmptyV2Context(); ctx.activeQuote = { ...MOCK_QUOTE };
  const r = handleContextContinuation('quero mudar o endereco', ctx, null);
  assert(r?.routed && r?.plan?.steps?.[0]?.tool === 'iniciar_troca_endereco_cotacao', 'mudar endereco'); }

console.log('\n=== Suite 6: sem activeQuote nao ativa P4 ===');
{ const ctx = getEmptyV2Context();
  const r = handleContextContinuation('qual subtotal dos produtos', ctx, null);
  assert(r?.plan?.steps?.[0]?.tool !== 'consultar_cotacao_ativa', 'sem activeQuote'); }

console.log('\n=== Suite 7: P1 tem prioridade sobre P4 ===');
{ const ctx = getEmptyV2Context(); ctx.activeQuote = { ...MOCK_QUOTE };
  ctx.pendingClientCandidate = { id_cliente: 999, nome: 'Teste', fantasia: '', documento: '', cidade_uf: '' };
  const r = handleContextContinuation('sim', ctx, null);
  assert(r?.plan?.steps?.[0]?.tool === 'confirmar_cliente_pendente', 'P1 > P4'); }

console.log('\n========================================');
console.log('Resultado: ' + passed + ' passou, ' + failed + ' falhou.');
if (failed === 0) { console.log('TODOS OS TESTES PASSARAM'); process.exit(0); }
else { console.error('HA FALHAS'); process.exit(1); }


