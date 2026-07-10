import assert from 'assert';
import { handleContextContinuation } from './maestro-v2-context-manager';
import type { MaestroV2Context } from './maestro-v2-context-manager';
import { routeToolSimple } from './maestro-v2-router';

process.env.MAESTRO_V2_ENABLED = 'true';
process.env.MAESTRO_AVULSO_ENABLED = 'false';

// Helper de reset
function createContext(): MaestroV2Context {
  return {
    version: 1,
    updatedAt: '',
    domain: 'orcamento_avulso',
    activeEntities: {},
    orcamentoItens: [],
    lastTool: undefined,
    pendingActions: [],
    pendingClientCandidate: null,
    pendingClientCandidates: null,
    pendingClientSearchTerm: null,
    pendingBudgetForCandidate: null,
    pendingSaveQuotation: null,
    activeQuote: null,
    pendingAddressChoice: null,
    pendingFreightChoice: null
  };
}

async function runTestesSociais() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  TESTE — Interceptação Social e Preservação de Contexto      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Teste 1: pendingSaveQuotation + "ok, bom dia pra você" -> resposta_social_cotacao
  console.log('─── T1: Social com pendingSaveQuotation ────────────────────────');
  let ctx = createContext();
  ctx.pendingSaveQuotation = {
    clientInternalId: 1,
    clientName: 'Teste',
    enderecoId: '1',
    cep: '',
    cidade: '',
    uf: '',
    itens: [],
    fretes: [],
    subtotal: 100,
    total: 100,
    pesoTotalGramas: 0,
    timestamp: '',
    freteEscolhido: { id: '1', transportadora: 'TESTE', valor: 0, prazo: '', servico: '', pesoUsado: 0 },
    enderecoFull: 'Endereço Teste'
  };

  let r = handleContextContinuation('ok, bom dia pra você', ctx, null);
  assert.ok(r?.routed, 'Deve ser roteado pelo interceptador P1.5');
  assert.strictEqual(r?.plan?.steps?.[0]?.tool, 'resposta_social_cotacao', 'Tool deve ser resposta_social_cotacao');
  assert.ok(ctx.pendingSaveQuotation !== null, 'pendingSaveQuotation não pode ser apagado');
  console.log('  ✓ T1: "ok, bom dia pra você" roteia para resposta_social e mantém contexto');

  // Teste 2: pendingSaveQuotation + "ok" -> resposta_social_cotacao, NÃO SALVAR
  console.log('─── T2: "ok" não confirma salvar ───────────────────────────────');
  r = handleContextContinuation('ok', ctx, null);
  assert.ok(r?.routed, 'Deve ser roteado');
  assert.strictEqual(r?.plan?.steps?.[0]?.tool, 'resposta_social_cotacao', 'Tool deve ser resposta_social_cotacao, não salvar_cotacao_confirmada');
  assert.strictEqual(ctx.pendingSaveQuotation!.savedIdInt, undefined, 'Não deve salvar automaticamente');
  console.log('  ✓ T2: "ok" cai na resposta social e não salva a cotação');

  // Teste 3: pendingSaveQuotation + "sim" -> salvar_cotacao_confirmada
  console.log('─── T3: "sim" confirma salvar ──────────────────────────────────');
  r = handleContextContinuation('sim', ctx, null);
  assert.ok(r?.routed, 'Deve ser roteado');
  assert.strictEqual(r?.plan?.steps?.[0]?.tool, 'salvar_cotacao_confirmada', 'Tool deve ser salvar_cotacao_confirmada');
  console.log('  ✓ T3: "sim" encaminha corretamente para salvar');

  // handleContextContinuation retorna null e vai pro roteador principal que trata addressIndex
  console.log('─── T4: "2" com pendingAddressChoice ───────────────────────────');
  ctx = createContext();
  ctx.pendingAddressChoice = {
    clientId: 1,
    addresses: [
      { id: '1', id_cliente: 1, tipo_endereco: 'A', cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' },
      { id: '2', id_cliente: 1, tipo_endereco: 'B', cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' },
      { id: '3', id_cliente: 1, tipo_endereco: 'C', cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' }
    ]
  };
  let routeResult = await routeToolSimple('2', null, null, ctx);
  assert.strictEqual(routeResult?.plan?.steps?.[0]?.tool, 'simularOrcamentoAvulso');
  assert.strictEqual(routeResult?.plan?.steps?.[0]?.params?.addressIndex, 2, 'Index deve ser 2');
  console.log('  ✓ T4: Resposta numérica "2" escolhe o endereço 2 normalmente');

  // Teste 5: pendingFreightChoice + "3" -> confirmar_frete_cotacao
  console.log('─── T5: "3" com pendingFreightChoice ───────────────────────────');
  ctx = createContext();
  ctx.pendingFreightChoice = {
    clientInternalId: 1,
    clientName: 'Teste',
    enderecoFull: '',
    cidade: '',
    uf: '',
    itens: [],
    subtotal: 0,
    pesoTotalGramas: 0,
    fretes: []
  };
  r = handleContextContinuation('3', ctx, null);
  assert.ok(r?.routed, 'Deve ser roteado por P3.5');
  assert.strictEqual(r?.plan?.steps?.[0]?.tool, 'confirmar_frete_cotacao', 'Tool deve ser confirmar_frete_cotacao');
  assert.strictEqual(r?.plan?.steps?.[0]?.params?.freteIndex, 3, 'Index enviado deve ser 3');
  console.log('  ✓ T5: Resposta numérica "3" escolhe o frete 3 normalmente');

  // Teste 6: activeQuote + "qual total?" -> consultar_cotacao_ativa
  console.log('─── T6: "qual total?" com activeQuote ──────────────────────────');
  ctx = createContext();
  ctx.activeQuote = {
    clientName: 'Teste',
    enderecoFull: '',
    itens: [],
    fretes: [],
    freteSelecionado: { id: '1', transportadora: 'TESTE', servico: '', valor: 0, prazo: '', pesoUsado: 0 },
    subtotalProdutos: 100,
    total: 100,
    pesoTotalGramas: 0,
    status: 'nao_salva'
  } as any;
  r = handleContextContinuation('qual o total?', ctx, null);
  assert.ok(r?.routed, 'Deve ser roteado por P4');
  assert.strictEqual(r?.plan?.steps?.[0]?.tool, 'consultar_cotacao_ativa', 'Tool deve ser consultar_cotacao_ativa');
  console.log('  ✓ T6: Pergunta real sobre cotação cai em consultar_cotacao_ativa');

  // Teste 7: pendingSaveQuotation + "ok, muito obrigado!" -> resposta_social_cotacao
  console.log('─── T7: "ok, muito obrigado!" ──────────────────────────────────');
  ctx = createContext();
  ctx.pendingSaveQuotation = { clientName: 'Teste' } as any;
  r = handleContextContinuation('ok, muito obrigado!', ctx, null);
  assert.ok(r?.routed, 'Deve ser roteado pelo interceptador P1.5');
  assert.strictEqual(r?.plan?.steps?.[0]?.tool, 'resposta_social_cotacao', 'Tool deve ser resposta_social_cotacao');
  console.log('  ✓ T7: "ok, muito obrigado!" é interceptado corretamente como social');

  // Teste 8: pendingSaveQuotation + "muito obrigado" -> resposta_social_cotacao
  console.log('─── T8: "muito obrigado" ───────────────────────────────────────');
  r = handleContextContinuation('muito obrigado', ctx, null);
  assert.ok(r?.routed, 'Deve ser roteado pelo interceptador P1.5');
  assert.strictEqual(r?.plan?.steps?.[0]?.tool, 'resposta_social_cotacao', 'Tool deve ser resposta_social_cotacao');
  console.log('  ✓ T8: "muito obrigado" é interceptado corretamente como social');

  // Teste 9: pendingSaveQuotation + "obrigado, pode salvar" -> salvar_cotacao_confirmada
  console.log('─── T9: "obrigado, pode salvar" ────────────────────────────────');
  r = handleContextContinuation('obrigado, pode salvar', ctx, null);
  assert.ok(r?.routed, 'Deve ser roteado pelo P0 (salvar)');
  assert.strictEqual(r?.plan?.steps?.[0]?.tool, 'salvar_cotacao_confirmada', 'Tool deve ser salvar_cotacao_confirmada');
  console.log('  ✓ T9: "obrigado, pode salvar" é interceptado como comando de salvar');

  // Teste 10: activeQuote + "valeu, consulta o cliente 8469" -> cai fora do P1.5
  console.log('─── T10: "valeu, consulta o cliente 8469" ──────────────────────');
  ctx = createContext();
  ctx.activeQuote = { clientName: 'Teste' } as any;
  r = handleContextContinuation('valeu, consulta o cliente 8469', ctx, null);
  assert.strictEqual(r, null, 'NÃO deve ser roteado pelo contexto manager (deve cair pro router principal)');
  console.log('  ✓ T10: "valeu, consulta o cliente 8469" ignorado pelo social guard, fluxo operacional vence');

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  ✅ TESTES SOCIAIS OK — 10/10 testes passaram.                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
}

runTestesSociais().catch(err => {
  console.error('\n❌ ERRO NOS TESTES SOCIAIS:');
  console.error(err);
  process.exit(1);
});
