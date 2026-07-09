/**
 * test_intencao_composta.ts
 * npx tsx src/features/maestro/core/simple/test_intencao_composta.ts
 *
 * Testa se a intencao composta (cliente + itens) vai direto para cotacao
 * quando o cliente ja esta ativo, e pede endereco quando nao tem.
 */

import { getEmptyV2Context, handleContextContinuation } from './maestro-v2-context-manager';
import { routeToolSimple } from './maestro-v2-router';

let passed = 0, failed = 0;
function assert(ok: boolean, name: string, detail = '') {
  if (ok) { console.log('OK  ' + name); passed++; }
  else { console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); failed++; }
}

// Mock activeClient 8469
const ACTIVE_CLIENT_8469 = {
  clientInternalId: 8469,
  clientDisplayCode: '8469',
  clientName: 'LISITON DOCUMENTOS SEGUROS LTDA',
  clientFantasia: 'DSEG IMPRESSOS',
  documento: '41944974000100',
  cidade: 'Santa Cruz do Sul',
  uf: 'RS',
  vendedor: 'Edison Jr',
  limiteCredito: 10000,
  creditoDisponivel: 0,
} as any;

console.log('\n=== Suite 1: Router — cliente ja ativo va direto para cotacao ===');

{
  const ctx = getEmptyV2Context();
  ctx.activeEntities = { clientId: '8469', clientInternalId: 8469, clientName: 'LISITON DOCUMENTOS SEGUROS LTDA' };
  const result = await routeToolSimple(
    'faca cotacao para o cli 8469 de 15000 triband + 1500 jacara',
    ACTIVE_CLIENT_8469,
    null,
    ctx
  );
  const tool = result.plan?.steps?.[0]?.tool;
  assert(result.routed, 'deve rotear');
  assert(tool === 'simularOrcamentoAvulso', 'vai direto para simularOrcamentoAvulso (cliente ja ativo)', 'got: ' + tool);
  assert(ctx.lastExplicitBudgetItems?.length === 2, 'itens preservados no contexto');
}

console.log('\n=== Suite 2: Router — cliente novo (nao ativo) passa pelo buscarCliente ===');

{
  const ctx = getEmptyV2Context();
  // Sem cliente ativo
  const result = await routeToolSimple(
    'faca cotacao para o cli 8469 de 15000 triband + 1500 jacara',
    null, // sem activeClient
    null,
    ctx
  );
  const tool = result.plan?.steps?.[0]?.tool;
  assert(result.routed, 'deve rotear');
  assert(tool === 'buscarCliente', 'sem cliente ativo vai para buscarCliente', 'got: ' + tool);
  assert(ctx.lastExplicitBudgetItems?.length === 2, 'itens preservados para apos busca');
}

console.log('\n=== Suite 3: Router — cliente diferente do ativo passa pelo buscarCliente ===');

{
  const ctx = getEmptyV2Context();
  ctx.activeEntities = { clientId: '1234', clientInternalId: 1234, clientName: 'OUTRO CLIENTE' };
  const OUTRO_CLIENTE = { ...ACTIVE_CLIENT_8469, clientInternalId: 1234, clientDisplayCode: '1234', clientName: 'OUTRO CLIENTE' };
  const result = await routeToolSimple(
    'faca cotacao para o cli 8469 de 15000 triband + 1500 jacara',
    OUTRO_CLIENTE as any,
    null,
    ctx
  );
  const tool = result.plan?.steps?.[0]?.tool;
  // Cliente 8469 diferente do ativo 1234 — deve buscar primeiro
  assert(tool === 'buscarCliente', 'cliente diferente vai para buscarCliente', 'got: ' + tool);
}

console.log('\n=== Suite 4: Router — domain preservado como orcamento_avulso ===');

{
  const ctx = getEmptyV2Context();
  // Sem cliente ativo, domain deve ficar orcamento_avulso após routear para buscarCliente
  const result = await routeToolSimple(
    'cotacao para o cli 8469 de 15000 triband + 1500 jacara',
    null,
    null,
    ctx
  );
  assert(ctx.domain === 'orcamento_avulso', 'domain permanece orcamento_avulso', 'got: ' + ctx.domain);
}

console.log('\n========================================');
console.log('Resultado: ' + passed + ' passou, ' + failed + ' falhou.');
if (failed === 0) { console.log('TODOS OS TESTES PASSARAM'); process.exit(0); }
else { console.error('HA FALHAS'); process.exit(1); }
