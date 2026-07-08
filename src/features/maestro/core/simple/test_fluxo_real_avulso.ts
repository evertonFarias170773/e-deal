/**
 * test_fluxo_real_avulso.ts
 * Teste de fluxo real turno a turno do Orcamento Avulso.
 * Simula caminho de /api/maestro/simple via context manager + engine.
 *
 * Para rodar: npx tsx src/features/maestro/core/simple/test_fluxo_real_avulso.ts
 */

import { processarOrcamentoAvulso, type OrcamentoAvulsoState } from './maestro-orcamento-engine';
import { processarOrcamentoService } from './maestro-orcamento-service.server';
import { handleContextContinuation, getEmptyV2Context, type MaestroV2Context } from './maestro-v2-context-manager';
import { criarSupabaseMock, type ProdutoDb } from './maestro-orcamento-resolver.server';
import { resolverTermoCatalogo } from './maestro-orcamento-catalogo-oficial';

const CATALOGO_MOCK: ProdutoDb[] = [
  { id_produto: 9001, descricao: 'PRODUTO TESTE LEGACY', apelidos: 'tri, teste, legacy', valorUnt: 0.50, valorFixo: 0, ativo: true },
  { id_produto: 101, descricao: 'PULSEIRA TRIBAND SINTETICA', apelidos: 'triband, tri, tyvek, pulseira triband', valorUnt: 0.186, valorFixo: 0, ativo: true },
  { id_produto: 102, descricao: 'PULSEIRA TECIDO VELCRO', apelidos: 'tex, tecido, velcro, fabric', valorUnt: 0.25, valorFixo: 0, ativo: true },
  { id_produto: 401, descricao: 'INGRESSO MOBI', apelidos: 'mobi, moby, ingresso mobi', valorUnt: 0.85, valorFixo: 150, ativo: true },
];

const supabase = criarSupabaseMock(CATALOGO_MOCK);

let passed = 0;
let failed = 0;

function ok(label: string) { console.log(`  OK ${label}`); passed++; }
function fail(label: string, atual?: any, esperado?: any) {
  console.error(`  FAIL ${label}`);
  if (atual !== undefined) console.error(`    Atual: ${JSON.stringify(atual)}`);
  if (esperado !== undefined) console.error(`    Esperado: ${JSON.stringify(esperado)}`);
  failed++;
}
function assert(label: string, cond: boolean, atual?: any, esperado?: any) {
  if (cond) ok(label); else fail(label, atual, esperado);
}

async function runTests() {
  const savedEnv = process.env.MAESTRO_AVULSO_ENABLED;
  process.env.MAESTRO_AVULSO_ENABLED = 'true';

  console.log('');
  console.log('=== Teste de Fluxo Real Avulso - Turno a Turno ===');
  console.log('');

  // T1: Catalogo resolve tri -> 101 (nao 9001)
  console.log('--- T1: tri -> ID 101 (catalogo oficial vence banco de teste) ---');
  {
    const r = resolverTermoCatalogo('tri');
    assert('"tri" resolvido pelo catalogo', r.tipoMatch === 'exato' || r.tipoMatch === 'parcial', r.tipoMatch);
    assert('"tri" -> ID 101 (nao 9001)', r.id_produto === 101, r.id_produto, 101);
    assert('"tri" tem nomeComercial', !!r.nomeComercial, r.nomeComercial);
  }

  // T2: 1560 tri - service novo, sem ambiguidade
  console.log('--- T2: "1560 tri" via service novo ---');
  {
    const res = await processarOrcamentoService({ query: '1560 tri', state: { itens: [], pendingAmbiguity: false }, supabase });
    assert('acao ADD ou REPLACE', res.action === 'ADD' || res.action === 'REPLACE', res.action);
    assert('sem pendencia', !res.temPendencia);
    assert('1 item', res.resolucao.length === 1, res.resolucao.length, 1);
    assert('sucesso', res.resolucao[0]?.status === 'sucesso', res.resolucao[0]?.status);
    assert('produto ID 101 (nao 9001)', res.resolucao[0]?.produto?.id_produto === 101, res.resolucao[0]?.produto?.id_produto, 101);
    assert('sem erros', res.errors.length === 0, res.errors);
    assert('total calculado', res.totalGeral !== null, res.totalGeral);
  }

  // T3: 1560 triband - alias exato
  console.log('--- T3: "1560 triband" ---');
  {
    const res = await processarOrcamentoService({ query: '1560 triband', state: { itens: [], pendingAmbiguity: false }, supabase });
    assert('sucesso', res.resolucao[0]?.status === 'sucesso', res.resolucao[0]?.status);
    assert('ID 101', res.resolucao[0]?.produto?.id_produto === 101, res.resolucao[0]?.produto?.id_produto, 101);
    assert('sem erros', res.errors.length === 0, res.errors);
  }

  // T4: adiciona + 120 tex - mantem triband
  console.log('--- T4: "adiciona + 120 tex" - mantem Triband ---');
  {
    const state: OrcamentoAvulsoState = { itens: [{ quantidade: 1560, termo: 'tri' }], pendingAmbiguity: false, previousItens: [] };
    const eng = processarOrcamentoAvulso('adiciona + 120 tex', state);
    assert('ADD detectado', eng.action === 'ADD', eng.action, 'ADD');
    assert('2 itens', eng.items.length === 2, eng.items.length, 2);
    assert('triband preservado (1560)', eng.items.some((i: any) => i.quantidade === 1560), eng.items.map((i: any) => `${i.quantidade} ${i.termo}`));
    assert('tex adicionado (120)', eng.items.some((i: any) => i.quantidade === 120 && i.termo.includes('tex')), eng.items.map((i: any) => `${i.quantidade} ${i.termo}`));
  }

  // T5: muda pra 200 tex - PRESERVA triband
  console.log('--- T5: "muda pra 200 tex" - UPDATE_QTD, preserva Triband ---');
  {
    const state: OrcamentoAvulsoState = {
      itens: [{ quantidade: 1560, termo: 'tri' }, { quantidade: 120, termo: 'tex' }],
      pendingAmbiguity: false,
      previousItens: [{ quantidade: 1560, termo: 'tri' }],
    };
    const eng = processarOrcamentoAvulso('muda pra 200 tex', state);
    assert('UPDATE_QTD (nao REPLACE)', eng.action === 'UPDATE_QTD', eng.action, 'UPDATE_QTD');
    assert('triband preservado (1560)', eng.items.some((i: any) => i.quantidade === 1560), eng.items.map((i: any) => `${i.quantidade} ${i.termo}`));
    assert('tex atualizado (200)', eng.items.some((i: any) => i.quantidade === 200 && i.termo.includes('tex')), eng.items.map((i: any) => `${i.quantidade} ${i.termo}`));
    assert('2 itens total', eng.items.length === 2, eng.items.length, 2);
  }

  // T6: "muda pra 200 tex" via context manager com domain=orcamento_avulso
  console.log('--- T6: UPDATE_QTD via handleContextContinuation ---');
  {
    const ctx: MaestroV2Context = getEmptyV2Context();
    ctx.domain = 'orcamento_avulso';
    ctx.orcamentoItens = [{ quantidade: 1560, termo: 'tri' }, { quantidade: 120, termo: 'tex' }];
    ctx.previousOrcamentoItens = [{ quantidade: 1560, termo: 'tri' }];

    const cont = handleContextContinuation('muda pra 200 tex', ctx, null);
    assert('interceptado pelo context manager', cont !== null, cont, 'non-null');
    if (cont) {
      const tool = cont.plan?.steps?.[0]?.tool;
      assert('tool simularOrcamentoAvulso', tool === 'simularOrcamentoAvulso', tool, 'simularOrcamentoAvulso');
      const itens = cont.plan?.steps?.[0]?.params?.itens;
      assert('triband 1560 preservado', (itens || []).some((i: any) => i.quantidade === 1560), itens?.map((i: any) => `${i.quantidade} ${i.termo}`));
      assert('tex 200', (itens || []).some((i: any) => i.quantidade === 200 && String(i.termo).includes('tex')), itens?.map((i: any) => `${i.quantidade} ${i.termo}`));
    }
  }

  // T7: mas mantem as triband - RESTORE, nao cliente
  console.log('--- T7: "mas mantem as triband" - RESTORE, nao fallback ---');
  {
    const stateApenasTex: OrcamentoAvulsoState = {
      itens: [{ quantidade: 200, termo: 'tex' }],
      pendingAmbiguity: false,
      previousItens: [{ quantidade: 1560, termo: 'tri' }, { quantidade: 200, termo: 'tex' }],
    };
    const eng = processarOrcamentoAvulso('mas mantem as triband', stateApenasTex);
    assert('RESTORE detectado', eng.action === 'RESTORE', eng.action, 'RESTORE');
    assert('triband restaurada', eng.items.some((i: any) => i.termo.includes('tri')), eng.items.map((i: any) => i.termo));
    assert('tex preservado', eng.items.some((i: any) => i.termo.includes('tex')), eng.items.map((i: any) => i.termo));
    assert('2 itens', eng.items.length === 2, eng.items.length, 2);

    // Context manager
    const ctx: MaestroV2Context = getEmptyV2Context();
    ctx.domain = 'orcamento_avulso';
    ctx.orcamentoItens = [{ quantidade: 200, termo: 'tex' }];
    ctx.previousOrcamentoItens = [{ quantidade: 1560, termo: 'tri' }, { quantidade: 200, termo: 'tex' }];

    const cont = handleContextContinuation('mas mantem as triband', ctx, null);
    assert('context manager intercepta RESTORE (nao foge para cliente)', cont !== null, cont, 'non-null');
    if (cont) {
      const tool = cont.plan?.steps?.[0]?.tool;
      assert('nao e buscarCliente', tool !== 'buscarCliente', tool);
      assert('e simularOrcamentoAvulso', tool === 'simularOrcamentoAvulso', tool, 'simularOrcamentoAvulso');
    }
  }

  // T8: ok obrigado - closure
  console.log('--- T8: "ok obrigado" - closure segura ---');
  {
    const state: OrcamentoAvulsoState = { itens: [{ quantidade: 1560, termo: 'tri' }], pendingAmbiguity: false };
    const eng = processarOrcamentoAvulso('ok obrigado', state);
    assert('engine NONE para closure', eng.action === 'NONE', eng.action, 'NONE');
  }

  // T9: context manager retomada de orçamento após financeiro
  console.log('--- T9: Retomada explícita de orçamento ---');
  {
    const ctx: MaestroV2Context = getEmptyV2Context();
    ctx.domain = 'financeiro'; // Simula estado atual financeiro
    // Mas temos itens salvos de sucesso
    ctx.lastSuccessfulBudgetItems = [{ quantidade: 1560, termo: 'tri' }, { quantidade: 200, termo: 'tex' }];
    
    const cont = handleContextContinuation('remove as triband do orçamento', ctx, null);
    assert('interceptado pelo context manager', cont !== null, cont, 'non-null');
    assert('domínio restaurado para orcamento_avulso', (ctx.domain as string) === 'orcamento_avulso', ctx.domain, 'orcamento_avulso');
    if (cont) {
      const tool = cont.plan?.steps?.[0]?.tool;
      assert('tool simularOrcamentoAvulso', tool === 'simularOrcamentoAvulso', tool, 'simularOrcamentoAvulso');
      const itens = cont.plan?.steps?.[0]?.params?.itens;
      assert('triband removida', !(itens || []).some((i: any) => String(i.termo).includes('tri')), true);
      assert('tex preservado', (itens || []).some((i: any) => i.quantidade === 200 && String(i.termo).includes('tex')), itens?.map((i: any) => `${i.quantidade} ${i.termo}`));
    }
  }

  // T10: remove as triband - REMOVE
  console.log('--- T10: "remove as triband" - REMOVE action ---');
  {
    const stateParaRemover: OrcamentoAvulsoState = {
      itens: [{ quantidade: 1560, termo: 'tri' }, { quantidade: 200, termo: 'tex' }],
      pendingAmbiguity: false,
      previousItens: []
    };
    const eng = processarOrcamentoAvulso('remove as triband', stateParaRemover);
    assert('REMOVE detectado', eng.action === 'REMOVE', eng.action, 'REMOVE');
    assert('apenas 1 item sobra', eng.items.length === 1, eng.items.length, 1);
    assert('tex sobra', eng.items.some((i: any) => i.termo.includes('tex')), eng.items.map((i: any) => i.termo));
    assert('triband removida', !eng.items.some((i: any) => i.termo.includes('tri')), eng.items.map((i: any) => i.termo));
    assert('estado anterior salvo', eng.nextState.previousItens?.length === 2, eng.nextState.previousItens?.length, 2);
  }

  // T11: refazer o orcamento sem as triband
  console.log('--- T11: "refazer o orcamento sem as triband" - REMOVE action ---');
  {
    const stateParaRemover: OrcamentoAvulsoState = {
      itens: [{ quantidade: 1560, termo: 'tri' }, { quantidade: 200, termo: 'tex' }],
      pendingAmbiguity: false,
      previousItens: []
    };
    const eng = processarOrcamentoAvulso('refazer o orçamento sem as triband', stateParaRemover);
    assert('REMOVE detectado', eng.action === 'REMOVE', eng.action, 'REMOVE');
    assert('apenas tex sobra', eng.items.length === 1 && eng.items[0].termo.includes('tex'), true);
  }

  if (savedEnv === undefined) delete process.env.MAESTRO_AVULSO_ENABLED;
  else process.env.MAESTRO_AVULSO_ENABLED = savedEnv;

  console.log('');
  if (failed === 0) {
    console.log(`=== FLUXO REAL OK: ${passed}/${passed + failed} verificacoes passaram ===`);
  } else {
    console.log(`=== FALHOU: ${failed} falha(s) em ${passed + failed} verificacoes ===`);
  }
  console.log('');
  if (failed > 0) process.exit(1);
}

async function runE2ETests() {
  console.log('\n=== Teste E2E: Cliente -> Financeiro -> Orçamento -> Financeiro -> Retomada -> Remove -> Restore ===\n');
  const savedEnv = process.env.MAESTRO_AVULSO_ENABLED;
  process.env.MAESTRO_AVULSO_ENABLED = 'true';

  let ctx: MaestroV2Context = getEmptyV2Context();

  // 1. "Sobre o cliente Lisiton"
  console.log('Turno 1: "Sobre o cliente Lisiton"');
  ctx.domain = 'cliente';
  ctx.activeEntities.clientInternalId = 123;
  ctx.activeEntities.clientName = 'LISITON DOCUMENTOS SEGUROS LTDA';

  // 2. "ele tem boletos em aberto?"
  console.log('Turno 2: "ele tem boletos em aberto?"');
  ctx.domain = 'financeiro';

  // 3. "qual valor pra 1560 tri"
  console.log('Turno 3: "qual valor pra 1560 tri"');
  let eng = processarOrcamentoAvulso('qual valor pra 1560 tri', { itens: [], pendingAmbiguity: false });
  assert('ADD detectado', eng.action === 'ADD', eng.action, 'ADD');
  ctx.domain = 'orcamento_avulso';
  ctx.orcamentoItens = eng.items;
  ctx.lastSuccessfulBudgetItems = eng.items;

  // 4. "adiciona + 120 tex"
  console.log('Turno 4: "adiciona + 120 tex"');
  eng = processarOrcamentoAvulso('adiciona + 120 tex', { itens: ctx.orcamentoItens, pendingAmbiguity: false });
  assert('ADD detectado', eng.action === 'ADD', eng.action, 'ADD');
  ctx.orcamentoItens = eng.items;
  ctx.lastSuccessfulBudgetItems = eng.items;
  assert('2 itens no orcamento', ctx.orcamentoItens.length === 2);

  // 5. "e sabe me dizer se a Lisiton tem boletos em atraso?"
  console.log('Turno 5: "e sabe me dizer se a Lisiton tem boletos em atraso?"');
  // O router mudaria o domínio para financeiro
  ctx.domain = 'financeiro';
  
  // 6. "remove as triband do orçamento"
  console.log('Turno 6: "remove as triband do orçamento"');
  let cont = handleContextContinuation('remove as triband do orçamento', ctx, null);
  assert('interceptado pelo context manager', cont !== null, cont, 'non-null');
  assert('domínio restaurado para orcamento_avulso', (ctx.domain as string) === 'orcamento_avulso', ctx.domain, 'orcamento_avulso');
  let tool = cont?.plan?.steps?.[0]?.tool;
  assert('tool simularOrcamentoAvulso', tool === 'simularOrcamentoAvulso', tool, 'simularOrcamentoAvulso');
  let itensParam = cont?.plan?.steps?.[0]?.params?.itens || [];
  assert('triband removida', !itensParam.some((i: any) => i.termo.includes('tri')));
  assert('tex preservada', itensParam.some((i: any) => i.termo.includes('tex')));
  ctx.orcamentoItens = itensParam; // Simulando que o service salvou

  // 7. "qual o total agora?"
  console.log('Turno 7: "qual o total agora?"');
  cont = handleContextContinuation('qual o total agora?', ctx, null);
  // "qual o total agora" tem keyword de orçamento? "total"? Não adicionei na regex!
  // Mas o domínio JÁ É orcamento_avulso (foi restaurado no turno 6).
  // Se o domínio já é orcamento_avulso, o CM roda processarOrcamentoAvulso
  eng = processarOrcamentoAvulso('qual o total agora?', { itens: ctx.orcamentoItens || [], pendingAmbiguity: false });
  assert('action NONE', eng.action === 'NONE', eng.action, 'NONE');
  // No router, "qual o total agora?" com NONE cairá no LLM com domínio orcamento_avulso, o que é OK porque não trará tabelas financeiras.

  // 8. "mas mantem as triband"
  console.log('Turno 8: "mas mantem as triband"');
  cont = handleContextContinuation('mas mantem as triband', ctx, null);
  assert('interceptado pelo context manager RESTORE', cont !== null, cont, 'non-null');
  tool = cont?.plan?.steps?.[0]?.tool;
  assert('tool simularOrcamentoAvulso', tool === 'simularOrcamentoAvulso', tool, 'simularOrcamentoAvulso');
  itensParam = cont?.plan?.steps?.[0]?.params?.itens || [];
  assert('triband restaurada', itensParam.some((i: any) => i.termo.includes('tri')));
  ctx.orcamentoItens = itensParam;

  // 9. "ok obrigado"
  console.log('Turno 9: "ok obrigado"');
  eng = processarOrcamentoAvulso('ok obrigado', { itens: ctx.orcamentoItens || [], pendingAmbiguity: false });
  assert('action NONE', eng.action === 'NONE', eng.action, 'NONE');

  if (savedEnv === undefined) delete process.env.MAESTRO_AVULSO_ENABLED;
  else process.env.MAESTRO_AVULSO_ENABLED = savedEnv;
}

async function main() {
  await runTests();
  await runE2ETests();
}

main().catch(err => {
  console.error('Erro no teste de fluxo real:', err);
  process.exit(1);
});
