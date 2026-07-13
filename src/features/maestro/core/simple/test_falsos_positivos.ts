/**
 * test_falsos_positivos.ts
 *
 * Teste unitário para validar a função extrairClienteDaQuery do roteador V2.
 * Garante que:
 * - Menções de cliente com "para", "para o", "para a" sejam extraídas.
 * - Preposições de produtos contendo "de", "do", "da" NÃO gerem falsos positivos.
 * - Termos de produtos conhecidos no catálogo sejam detectados e descartados da busca de cliente.
 *
 * Para rodar: npx ts-node src/features/maestro/core/simple/test_falsos_positivos.ts
 */

import { routeToolSimple } from './maestro-v2-router';
import type { SimpleClientContext } from './maestro-simple-context';
import type { MaestroV2Context } from './maestro-v2-context-manager';
import { getEmptyV2Context } from './maestro-v2-context-manager';

// Configura a variável de ambiente para habilitar o roteador
process.env.MAESTRO_V2_ENABLED = 'true';
process.env.MAESTRO_AVULSO_ENABLED = 'true';

let passed = 0;
let failed = 0;

function assert(label: string, ok: boolean, detalhe?: string) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    if (detalhe) console.error(`    Detalhe: ${detalhe}`);
    failed++;
  }
}

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   Teste de Falsos Positivos — extrairClienteDaQuery          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const mockCtx = getEmptyV2Context();

  // Caso 1: Falso positivo com "de" no nome do produto
  console.log('--- Caso 1: Falso positivo com "de" (pulseiras de identificacao) ---');
  {
    const mockCtx = getEmptyV2Context();
    const res = await routeToolSimple(
      'solicitação de orçamento de 1000 pulseiras de identificacao',
      null,
      null,
      mockCtx
    );
    const firstStep = res.plan?.steps[0];
    assert('Não deve rotear para buscarCliente', firstStep?.tool === 'simularOrcamentoAvulso');
    assert('Deve manter o orçamento avulso puro', firstStep?.tool !== 'buscarCliente');
  }

  // Caso 2: Falso positivo com "do" no nome do produto
  console.log('\n--- Caso 2: Falso positivo com "do" (pulseiras do tipo silicone) ---');
  {
    const mockCtx = getEmptyV2Context();
    const res = await routeToolSimple(
      'quero 1000 pulseiras do tipo silicone',
      null,
      null,
      mockCtx
    );
    const firstStep = res.plan?.steps[0];
    assert('Não deve rotear para buscarCliente', firstStep?.tool === 'simularOrcamentoAvulso');
    assert('Deve manter o orçamento avulso puro', firstStep?.tool !== 'buscarCliente');
  }

  // Caso 3: Falso positivo com "da" no nome do produto
  console.log('\n--- Caso 3: Falso positivo com "da" (lacres da marca x) ---');
  {
    const mockCtx = getEmptyV2Context();
    const res = await routeToolSimple(
      'cotação de 500 lacres da marca x',
      null,
      null,
      mockCtx
    );
    const firstStep = res.plan?.steps[0];
    assert('Não deve rotear para buscarCliente', firstStep?.tool === 'simularOrcamentoAvulso');
  }

  // Caso 4: Caso positivo legítimo com "para"
  console.log('\n--- Caso 4: Caso legítimo com "para" (para Carlos Henrique) ---');
  {
    const mockCtx = getEmptyV2Context();
    const res = await routeToolSimple(
      'solicitação de orçamento para Carlos Henrique, 1.000 Pulseiras Triband',
      null,
      null,
      mockCtx
    );
    const firstStep = res.plan?.steps[0];
    assert('Deve rotear para buscarCliente', firstStep?.tool === 'buscarCliente');
    assert('Deve buscar pelo nome correto do cliente', firstStep?.params?.busca === 'carlos henrique');
  }

  // Caso 5: Caso legítimo com "para o"
  console.log('\n--- Caso 5: Caso legítimo com "para o" (para o Edison Santos) ---');
  {
    const mockCtx = getEmptyV2Context();
    const res = await routeToolSimple(
      'orçamento para o Edison Santos: 1000 mobi',
      null,
      null,
      mockCtx
    );
    const firstStep = res.plan?.steps[0];
    assert('Deve rotear para buscarCliente', firstStep?.tool === 'buscarCliente');
    assert('Deve buscar pelo nome correto do cliente', firstStep?.params?.busca === 'edison santos');
  }

  // Caso 6: Falso positivo com palavra que coincide com produto do catálogo (ex: para mobi)
  console.log('\n--- Caso 6: Falso positivo com palavra de produto no catálogo ("para mobi") ---');
  {
    const mockCtx = getEmptyV2Context();
    const res = await routeToolSimple(
      'orçamento de 1000 para mobi', // "mobi" é produto cadastrado no catálogo oficial
      null,
      null,
      mockCtx
    );
    const firstStep = res.plan?.steps[0];
    assert('Não deve buscar cliente por "mobi"', firstStep?.tool === 'simularOrcamentoAvulso');
  }

  // Caso 7: Apenas unidades sem produto nem cliente
  console.log('\n--- Caso 7: Query apenas com unidades ("orçamento de 1000 unidades") ---');
  {
    const mockCtx = getEmptyV2Context();
    const res = await routeToolSimple(
      'orçamento de 1000 unidades',
      null,
      null,
      mockCtx
    );
    const firstStep = res.plan?.steps[0];
    assert('Não deve buscar cliente', firstStep?.tool === 'simularOrcamentoAvulso' || firstStep?.tool === 'perguntar_tipo_orcamento');
  }

  // Caso 8: Caso integrado exato relatado no front
  console.log('\n--- Caso 8: Caso integrado exato ("Orçamento para Carlos Henrique de 1.000 Pulseira Triband") ---');
  {
    const mockCtx = getEmptyV2Context();
    const res = await routeToolSimple(
      'Orçamento para Carlos Henrique de 1.000 Pulseira Triband',
      null,
      null,
      mockCtx
    );
    const firstStep = res.plan?.steps[0];
    assert('Deve rotear para buscarCliente', firstStep?.tool === 'buscarCliente');
    assert('Deve buscar pelo nome correto sem "de" final', firstStep?.params?.busca === 'carlos henrique');
    const itemPreservado = mockCtx.orcamentoItens?.[0];
    assert('Deve preservar a quantidade de 1.000 sem mutilação', itemPreservado?.quantidade === 1000);
    assert('Deve preservar o termo "pulseira triband"', itemPreservado?.termo === 'pulseira triband');
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║   Fim dos testes: ${passed} passados, ${failed} falhados.      ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
