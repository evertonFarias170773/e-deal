import { detectFreightSwitch } from './maestro-v2-context-manager';
import { handleContextContinuation } from './maestro-v2-context-manager';
import assert from 'assert';

async function runTests() {
  console.log('=== Suite: Contaminação de Contexto ===\n');

  // Caso 1: "agora faça o mesmo orçamento para o cli 8469"
  {
    const ctx = {
      activeQuote: { status: 'nao_salva', clientInternalId: 14, clientName: 'Edison', itens: [{id_produto: 1, nome: 'Ingresso UP BOX', quantidade: 150, valorUnitario: 1, valorFixo: false, subtotal: 150, pesoUnitario: 0}] } as any,
      pendingSaveQuotation: { savedIdInt: undefined } as any,
      orcamentoItens: [],
      pendingAddressChoice: {} as any,
      pendingFreightChoice: {} as any,
    } as any;

    const res = handleContextContinuation('agora faça o mesmo orçamento para o cli 8469', ctx, null);
    assert.strictEqual(res, null, 'Deveria prosseguir para buscar cliente');
    assert.strictEqual(ctx.domain, 'cliente', 'Domínio deveria ser cliente');
    assert.strictEqual(ctx.activeQuote, null, 'activeQuote deve ser limpado');
    assert.strictEqual(ctx.pendingSaveQuotation, null, 'pendingSaveQuotation deve ser limpado');
    assert.strictEqual(ctx.pendingAddressChoice, null, 'pendingAddressChoice deve ser limpado');
    assert.strictEqual(ctx.pendingFreightChoice, null, 'pendingFreightChoice deve ser limpado');
    assert.strictEqual(ctx.orcamentoItens.length, 1, 'Itens devem ser preservados');
    assert.strictEqual(ctx.orcamentoItens[0].nome, 'Ingresso UP BOX', 'Nome do item preservado');
    console.log('OK  "agora faça o mesmo orçamento para o cli 8469"');
  }

  // Caso 2: "não" on pendingSaveQuotation
  {
    const ctx = {
      activeQuote: { status: 'nao_salva' } as any,
      pendingSaveQuotation: { savedIdInt: undefined } as any,
    } as any;
    const res = handleContextContinuation('não', ctx, null);
    assert.ok(res?.routed, 'Deveria rotear para cancelar_save_cotacao');
    assert.strictEqual(res?.plan.steps[0].tool, 'cancelar_save_cotacao');
    assert.strictEqual(ctx.activeQuote, null, 'activeQuote deve ser limpado');
    assert.strictEqual(ctx.pendingSaveQuotation, null, 'pendingSaveQuotation deve ser limpado');
    console.log('OK  "não" em pendingSaveQuotation limpa quote');
  }

  // Caso 3: "1580 triband pra o cli 8469" with old quote active
  {
    const ctx = {
      activeQuote: { status: 'nao_salva', clientInternalId: 14 } as any,
      orcamentoItens: [{nome: 'velho', quantidade: 1, subtotal: 1} as any],
    } as any;
    const res = handleContextContinuation('1580 triband pra o cli 8469', ctx, null);
    assert.strictEqual(res, null, 'Deveria seguir o fluxo normal para buscar cli e simular');
    assert.strictEqual(ctx.domain, 'cliente');
    assert.strictEqual(ctx.activeQuote, null, 'activeQuote deve ser limpado');
    assert.strictEqual(ctx.orcamentoItens.length, 0, 'Itens devem ser limpos porque nao e MESMO orcamento');
    console.log('OK  "1580 triband pra o cli 8469" limpa quote velha');
  }

  // Caso 4: "sobre o cliente 8469" with old quote active
  {
    const ctx = {
      activeQuote: { status: 'nao_salva', clientInternalId: 14 } as any,
    } as any;
    const res = handleContextContinuation('sobre o cliente 8469', ctx, null);
    assert.strictEqual(res, null);
    assert.strictEqual(ctx.domain, 'cliente');
    assert.strictEqual(ctx.activeQuote, null, 'activeQuote deve ser limpado');
    console.log('OK  "sobre o cliente 8469" limpa quote velha');
  }

  // Caso 5: "meu deus você não consegue entender"
  {
    const ctx = {
      activeQuote: { status: 'nao_salva', clientInternalId: 14 } as any,
    } as any;
    const res = handleContextContinuation('meu deus você não consegue entender', ctx, null);
    assert.ok(res?.routed);
    assert.strictEqual(res?.plan.steps[0].tool, 'resposta_frustracao_usuario');
    assert.strictEqual(ctx.activeQuote, null, 'activeQuote deve ser limpado');
    console.log('OK  frustração detectada e limpa context');
  }

  console.log('\nTodos os testes de contaminação de contexto passaram!');
}

runTests().catch(console.error);
