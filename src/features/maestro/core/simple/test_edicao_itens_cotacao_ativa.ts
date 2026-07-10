/**
 * test_edicao_itens_cotacao_ativa.ts
 * npx tsx src/features/maestro/core/simple/test_edicao_itens_cotacao_ativa.ts
 *
 * Valida a edição de itens (adição, remoção, alteração de quantidade)
 * em uma cotação ativa não salva.
 */

import {
  getEmptyV2Context,
  handleContextContinuation,
  OrcamentoAvulsoItem,
} from './maestro-v2-context-manager';

process.env.MAESTRO_AVULSO_ENABLED = 'true';
process.env.MAESTRO_V2_ENABLED = 'true';

let passed = 0, failed = 0;
function assert(ok: boolean, name: string, detail = '') {
  if (ok) { console.log('OK  ' + name); passed++; }
  else { console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); failed++; }
}

const MOCK_FRETES = [
  { id: 'unesul-001', servico: 'Rodoviario', transportadora: 'Unesul', valor: 69.32, prazo: '3 dias uteis', pesoUsado: 1200 },
  { id: 'sao-miguel-001', servico: 'Rodoviario', transportadora: 'Sao Miguel', valor: 140.96, prazo: '2 dias uteis', pesoUsado: 1200 },
  { id: 'sedex-001', servico: 'SEDEX', transportadora: 'Correios SEDEX', valor: 549.39, prazo: '1 dia util', pesoUsado: 1200 },
];

const MOCK_QUOTE = {
  createdAt: new Date().toISOString(),
  clientInternalId: 8469,
  clientName: 'LISITON DOCUMENTOS SEGUROS LTDA',
  itens: [
    { id_produto: 101, nome: 'Pulseira Triband Sintetica', quantidade: 15000, valorUnitario: 0.12, valorFixo: 580, subtotal: 2440, pesoUnitario: 0.05 },
    { id_produto: 202, nome: 'Cordao Jacare', quantidade: 1500, valorUnitario: 1.72, valorFixo: 490, subtotal: 4070, pesoUnitario: 0.4 },
  ],
  enderecoId: 'end-uuid-02',
  enderecoFull: 'Travessa Canoas, 39 - Centro, Santa Cruz do Sul/RS',
  cep: '96810-000',
  cidade: 'Santa Cruz do Sul',
  uf: 'RS',
  fretes: MOCK_FRETES,
  freteSelecionado: MOCK_FRETES[2],
  subtotalProdutos: 6510,
  total: 7059.39,
  pesoTotalGramas: 1224,
  status: 'nao_salva' as const,
};

(async () => {
  console.log('\n=== Suite 1: Adição de Itens na Cotação Ativa ===');
  
  {
    const ctx = getEmptyV2Context();
    ctx.activeQuote = { ...MOCK_QUOTE };
    ctx.pendingFreightChoice = { ...MOCK_QUOTE, fretes: MOCK_FRETES } as any;

    const r = handleContextContinuation('+ 550 ingressos Up', ctx, null);
    const tool = r?.plan?.steps?.[0]?.tool;
    const items = r?.plan?.steps?.[0]?.params?.itens as OrcamentoAvulsoItem[];

    assert(!!r?.routed, 'deve rotear');
    assert(tool === 'simularOrcamentoAvulso', 'chama simularOrcamentoAvulso', 'got: ' + tool);
    assert(ctx.pendingFreightChoice === null, 'deve invalidar a escolha de frete pendente');
    assert(items?.length === 3, 'deve conter 3 itens agora');
    assert(items?.some(i => i.termo.toLowerCase() === 'ingressos up' && i.quantidade === 550), 'contém o item adicionado');
  }

  console.log('\n=== Suite 2: Adição Implícita ("faltou") ===');
  
  {
    const ctx = getEmptyV2Context();
    ctx.activeQuote = { ...MOCK_QUOTE };

    const r = handleContextContinuation('faltou 550 ingressos Up', ctx, null);
    const items = r?.plan?.steps?.[0]?.params?.itens as OrcamentoAvulsoItem[];

    assert(!!r?.routed && r?.plan?.steps?.[0]?.tool === 'simularOrcamentoAvulso', 'roteia para simularOrcamentoAvulso');
    assert(items?.length === 3, 'deve conter 3 itens');
    assert(items?.some(i => i.termo.toLowerCase() === 'ingressos up' && i.quantidade === 550), 'contém o item faltante');
  }

  console.log('\n=== Suite 3: Adição apenas com Qtd + Produto ===');
  
  {
    const ctx = getEmptyV2Context();
    ctx.activeQuote = { ...MOCK_QUOTE };

    const r = handleContextContinuation('550 ingressos Up', ctx, null);
    const items = r?.plan?.steps?.[0]?.params?.itens as OrcamentoAvulsoItem[];

    assert(!!r?.routed && r?.plan?.steps?.[0]?.tool === 'simularOrcamentoAvulso', 'roteia para simularOrcamentoAvulso');
    assert(items?.length === 3, 'deve conter 3 itens');
    assert(items?.some(i => i.termo.toLowerCase() === 'ingressos up' && i.quantidade === 550), 'tratado como ADD e não REPLACE');
  }

  console.log('\n=== Suite 4: Remoção de Item ===');
  
  {
    const ctx = getEmptyV2Context();
    ctx.activeQuote = { ...MOCK_QUOTE };

    const r = handleContextContinuation('remove o jacare', ctx, null);
    const items = r?.plan?.steps?.[0]?.params?.itens as OrcamentoAvulsoItem[];

    assert(!!r?.routed && r?.plan?.steps?.[0]?.tool === 'simularOrcamentoAvulso', 'roteia para simularOrcamentoAvulso');
    assert(items?.length === 1, 'resta apenas 1 item');
    assert(!items?.some(i => i.termo.toLowerCase().includes('jacare')), 'jacare foi removido');
  }

  console.log('\n=== Suite 5: Alteração de Quantidade ("muda para") ===');
  
  {
    const ctx = getEmptyV2Context();
    ctx.activeQuote = { ...MOCK_QUOTE };

    const r = handleContextContinuation('muda triband para 15000', ctx, null);
    const items = r?.plan?.steps?.[0]?.params?.itens as OrcamentoAvulsoItem[];

    assert(!!r?.routed && r?.plan?.steps?.[0]?.tool === 'simularOrcamentoAvulso', 'roteia para simularOrcamentoAvulso');
    const triband = items?.find(i => i.termo.toLowerCase().includes('triband'));
    assert(triband?.quantidade === 15000, 'quantidade atualizada para 15000', 'got: ' + triband?.quantidade);
  }

  console.log('\n=== Suite 6: Alteração de Quantidade implícita (mesmo termo) ===');
  
  {
    const ctx = getEmptyV2Context();
    ctx.activeQuote = { ...MOCK_QUOTE };

    const r = handleContextContinuation('10000 triband', ctx, null);
    const items = r?.plan?.steps?.[0]?.params?.itens as OrcamentoAvulsoItem[];

    assert(!!r?.routed && r?.plan?.steps?.[0]?.tool === 'simularOrcamentoAvulso', 'roteia para simularOrcamentoAvulso');
    const triband = items?.find(i => i.termo.toLowerCase().includes('triband'));
    assert(items?.length === 2, 'não deve criar um novo item duplicado, deve mesclar');
    assert(triband?.quantidade === 10000, 'quantidade atualizada para 10000', 'got: ' + triband?.quantidade);
  }

  console.log('\n=== Suite 7: Não-Edição (Perguntas livres / Conversa normal) ===');
  
  {
    const ctx = getEmptyV2Context();
    ctx.activeQuote = { ...MOCK_QUOTE };

    const r = handleContextContinuation('bom dia', ctx, null);
    assert(r?.plan?.steps?.[0]?.tool !== 'simularOrcamentoAvulso', 'bom dia não deve ser interpretado como edição de itens');
  }

  console.log('\n========================================');
  console.log('Resultado: ' + passed + ' passou, ' + failed + ' falhou.');
  if (failed === 0) { console.log('TODOS OS TESTES PASSARAM'); process.exit(0); }
  else { console.error('HA FALHAS'); process.exit(1); }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
