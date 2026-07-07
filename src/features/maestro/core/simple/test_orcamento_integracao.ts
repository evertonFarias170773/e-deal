/**
 * test_orcamento_integracao.ts
 *
 * Teste de integração do fluxo completo de Orçamento Avulso:
 *   parser (engine) → resolver (catálogo mock) → cálculo (service)
 *
 * NÃO faz chamadas reais ao banco — usa fixtures locais via criarSupabaseMock().
 * NÃO religa MAESTRO_AVULSO_ENABLED (responsabilidade do Router).
 * NÃO afeta Cliente/Cadastro/Financeiro.
 *
 * Para rodar: npx tsx src/features/maestro/core/simple/test_orcamento_integracao.ts
 */

import {
  processarOrcamentoService,
} from './maestro-orcamento-service.server';
import type { OrcamentoAvulsoState } from './maestro-orcamento-engine';
import { criarSupabaseMock, type ProdutoDb } from './maestro-orcamento-resolver.server';


// ─── Fixtures de Catálogo ─────────────────────────────────────────────────────

const CATALOGO: ProdutoDb[] = [
  {
    id_produto: 101,
    descricao: 'PULSEIRA TRIBAND ACESSO',
    apelidos: 'triband, pulseira tri, tri, triband acesso',
    valorUnt: 1.25,
    valorFixo: 0,
    ativo: true,
  },
  {
    id_produto: 202,
    descricao: 'INGRESSO MOBI',
    apelidos: 'mobi, ingresso mobi, im',
    valorUnt: 0.85,
    valorFixo: 150,
    ativo: true,
  },
  {
    id_produto: 303,
    descricao: 'CREDENCIAL VIP PREMIUM',
    apelidos: 'vip, credencial vip',
    valorUnt: null,   // preco_incompleto
    valorFixo: null,
    ativo: true,
  },
  {
    id_produto: 404,
    descricao: 'PULSEIRA DESCONTINUADA',
    apelidos: 'antiga, descontinuada',
    valorUnt: 0.50,
    valorFixo: 0,
    ativo: false,     // inativo
  },
  {
    id_produto: 505,
    descricao: 'CORDAO EVENTO A',
    apelidos: 'cordao a, evento a',
    valorUnt: 2.00,
    valorFixo: 0,
    ativo: true,
  },
  {
    id_produto: 506,
    descricao: 'CORDAO EVENTO B',
    apelidos: 'cordao b, evento b',
    valorUnt: 2.50,
    valorFixo: 0,
    ativo: true,
  },
];

const supabase = criarSupabaseMock(CATALOGO);

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, ok: boolean, detalhe?: string, atual?: any, esperado?: any) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    if (detalhe) console.error(`    Detalhe: ${detalhe}`);
    if (atual !== undefined) console.error(`    Atual:    ${JSON.stringify(atual)}`);
    if (esperado !== undefined) console.error(`    Esperado: ${JSON.stringify(esperado)}`);
    failed++;
  }
}

function estadoVazio(): OrcamentoAvulsoState {
  return { itens: [], pendingAmbiguity: false };
}

// ─── TESTES ───────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   Teste de Integração — parser + resolver + cálculo          ║');
  console.log('║   Mock local — ZERO chamadas reais ao banco                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // ── T1: "15600 mobi + 1500 triband qual valor?" ───────────────────────────
  console.log('─── T1: "15600 mobi + 1500 triband qual valor?" ───────────────');
  {
    const res = await processarOrcamentoService({
      query: '15600 mobi + 1500 triband qual valor?',
      state: estadoVazio(),
      supabase,
    });

    // mobi: 15600 * 0.85 + 150 = 13260 + 150 = 13410
    // triband: 1500 * 1.25 + 0 = 1875
    // total = 13410 + 1875 = 15285
    assert('action deve ser ADD ou REPLACE',
      res.action === 'ADD' || res.action === 'REPLACE',
      undefined, res.action);
    assert('deve ter 2 itens',
      res.items.length === 2, undefined, res.items.length, 2);
    assert('totalGeral correto (15285)',
      res.totalGeral === 15285, undefined, res.totalGeral, 15285);
    assert('sem erros', res.errors.length === 0, undefined, res.errors);
    assert('sem pendência', !res.temPendencia);
    assert('response contém "INGRESSO MOBI"',
      res.response.toUpperCase().includes('INGRESSO MOBI'), undefined, res.response);
    assert('response contém "TRIBAND"',
      res.response.toUpperCase().includes('TRIBAND'), undefined, res.response);
    assert('response contém "Total"',
      res.response.includes('Total'), undefined, res.response);

    // Guardar state para próximos turnos
    var stateT1 = res.nextState;
  }

  // ── T2: "muda a qtd do mobi pra 10k" ─────────────────────────────────────
  console.log('');
  console.log('─── T2: "muda a qtd do mobi pra 10k" ─────────────────────────');
  {
    const res = await processarOrcamentoService({
      query: 'muda a qtd do mobi pra 10k',
      state: stateT1,
      supabase,
    });

    // mobi: 10000 * 0.85 + 150 = 8650
    // triband: 1500 * 1.25 = 1875
    // total = 8650 + 1875 = 10525
    assert('action deve ser UPDATE_QTD',
      res.action === 'UPDATE_QTD', undefined, res.action, 'UPDATE_QTD');
    assert('item mobi deve ter qtd 10000',
      res.items.some(i => i.termo === 'mobi' && i.quantidade === 10000),
      undefined, res.items.map(i => `${i.termo}:${i.quantidade}`));
    assert('totalGeral correto (10525)',
      res.totalGeral === 10525, undefined, res.totalGeral, 10525);
    assert('sem erros', res.errors.length === 0, undefined, res.errors);

    var stateT2 = res.nextState;
  }

  // ── T3: "muda a quantidade do mobi para 10.000" ───────────────────────────
  console.log('');
  console.log('─── T3: "muda a quantidade do mobi para 10.000" ───────────────');
  {
    // Reinicia com estado T1 para testar a variação de escrita com ponto
    const res = await processarOrcamentoService({
      query: 'muda a quantidade do mobi para 10.000',
      state: stateT1,
      supabase,
    });

    assert('action deve ser UPDATE_QTD',
      res.action === 'UPDATE_QTD', undefined, res.action, 'UPDATE_QTD');
    assert('item mobi deve ter qtd 10000',
      res.items.some(i => i.termo === 'mobi' && i.quantidade === 10000),
      undefined, res.items.map(i => `${i.termo}:${i.quantidade}`));
    assert('totalGeral correto (10525)',
      res.totalGeral === 10525, undefined, res.totalGeral, 10525);
  }

  // ── T4: "10600 mobi + 1500 triband qual valor?" (replace completo) ────────
  console.log('');
  console.log('─── T4: "10600 mobi + 1500 triband qual valor?" ───────────────');
  {
    const res = await processarOrcamentoService({
      query: '10600 mobi + 1500 triband qual valor?',
      state: stateT1, // já tem itens → replace
      supabase,
    });

    // mobi: 10600 * 0.85 + 150 = 9010 + 150 = 9160
    // triband: 1500 * 1.25 = 1875
    // total = 9160 + 1875 = 11035
    assert('action deve ser REPLACE',
      res.action === 'REPLACE', undefined, res.action, 'REPLACE');
    assert('totalGeral correto (11035)',
      res.totalGeral === 11035, undefined, res.totalGeral, 11035);
    assert('sem erros', res.errors.length === 0, undefined, res.errors);
  }

  // ── T5: Produto não encontrado ────────────────────────────────────────────
  console.log('');
  console.log('─── T5: Produto não encontrado ────────────────────────────────');
  {
    const res = await processarOrcamentoService({
      query: '1000 xyzprodutonaocadastrado',
      state: estadoVazio(),
      supabase,
    });

    assert('action deve ser ADD',
      res.action === 'ADD', undefined, res.action, 'ADD');
    assert('totalGeral deve ser null',
      res.totalGeral === null, undefined, res.totalGeral, null);
    assert('deve ter erro de produto não encontrado',
      res.errors.some(e => e.includes('não encontrado')),
      undefined, res.errors);
    assert('resolucao deve ter status nao_encontrado',
      res.resolucao.some(r => r.status === 'nao_encontrado'),
      undefined, res.resolucao.map(r => r.status));
  }

  // ── T6: Produto ambíguo ──────────────────────────────────────────────────
  console.log('');
  console.log('─── T6: Produto ambíguo "cordao" ──────────────────────────────');
  {
    const res = await processarOrcamentoService({
      query: '500 cordao',
      state: estadoVazio(),
      supabase,
    });

    assert('totalGeral deve ser null',
      res.totalGeral === null, undefined, res.totalGeral, null);
    assert('deve ter pendência',
      res.temPendencia === true, undefined, res.temPendencia, true);
    assert('deve ter erro de ambiguidade',
      res.errors.some(e => e.toLowerCase().includes('produto')),
      undefined, res.errors);
    assert('resolucao deve ter status ambiguo',
      res.resolucao.some(r => r.status === 'ambiguo'),
      undefined, res.resolucao.map(r => r.status));
  }

  // ── T7: Produto inativo ──────────────────────────────────────────────────
  console.log('');
  console.log('─── T7: Produto inativo "descontinuada" ───────────────────────');
  {
    const res = await processarOrcamentoService({
      query: '100 descontinuada',
      state: estadoVazio(),
      supabase,
    });

    assert('totalGeral deve ser null',
      res.totalGeral === null, undefined, res.totalGeral, null);
    assert('deve ter erro de inativo',
      res.errors.some(e => e.includes('inativo')),
      undefined, res.errors);
    assert('resolucao deve ter status inativo',
      res.resolucao.some(r => r.status === 'inativo'),
      undefined, res.resolucao.map(r => r.status));
  }

  // ── T8: Preço incompleto ──────────────────────────────────────────────────
  console.log('');
  console.log('─── T8: Preço incompleto "vip" ────────────────────────────────');
  {
    const res = await processarOrcamentoService({
      query: '50 vip',
      state: estadoVazio(),
      supabase,
    });

    assert('totalGeral deve ser null',
      res.totalGeral === null, undefined, res.totalGeral, null);
    assert('deve ter erro de preco_incompleto',
      res.errors.some(e => e.includes('preço') || e.includes('preco')),
      undefined, res.errors);
    assert('resolucao deve ter status preco_incompleto',
      res.resolucao.some(r => r.status === 'preco_incompleto'),
      undefined, res.resolucao.map(r => r.status));
  }

  // ── T9: Total bloqueado quando há item com erro ───────────────────────────
  console.log('');
  console.log('─── T9: Total bloqueado com item inválido misto ───────────────');
  {
    const res = await processarOrcamentoService({
      query: '1500 triband + 100 xyznaocadastrado',
      state: estadoVazio(),
      supabase,
    });

    assert('action deve ser ADD ou REPLACE',
      res.action === 'ADD' || res.action === 'REPLACE',
      undefined, res.action);
    assert('totalGeral deve ser null (item inválido presente)',
      res.totalGeral === null, undefined, res.totalGeral, null);
    assert('deve ter pelo menos 1 erro',
      res.errors.length >= 1, undefined, res.errors);
    assert('resolucao tem um item sucesso (triband)',
      res.resolucao.some(r => r.status === 'sucesso'),
      undefined, res.resolucao.map(r => `${r.termo}:${r.status}`));
    assert('resolucao tem um item nao_encontrado (xyznaocadastrado)',
      res.resolucao.some(r => r.status === 'nao_encontrado'),
      undefined, res.resolucao.map(r => `${r.termo}:${r.status}`));
  }

  // ── T10: Total calculado quando todos os itens são válidos ────────────────
  console.log('');
  console.log('─── T10: Total calculado com todos válidos ─────────────────────');
  {
    const res = await processarOrcamentoService({
      query: '2000 triband + 3000 mobi',
      state: estadoVazio(),
      supabase,
    });

    // triband: 2000 * 1.25 + 0 = 2500
    // mobi: 3000 * 0.85 + 150 = 2550 + 150 = 2700
    // total = 2500 + 2700 = 5200
    assert('totalGeral deve ser 5200',
      res.totalGeral === 5200, undefined, res.totalGeral, 5200);
    assert('sem erros', res.errors.length === 0, undefined, res.errors);
    assert('sem pendência', !res.temPendencia);
    assert('todos itens com sucesso',
      res.resolucao.every(r => r.status === 'sucesso'),
      undefined, res.resolucao.map(r => `${r.termo}:${r.status}`));
  }

  // ── T11: Cancelamento não chama resolver ─────────────────────────────────
  console.log('');
  console.log('─── T11: Cancelamento (não chama resolver) ─────────────────────');
  {
    const res = await processarOrcamentoService({
      query: 'cancela tudo',
      state: stateT1,
      supabase,
    });

    assert('action deve ser CLEAR',
      res.action === 'CLEAR', undefined, res.action, 'CLEAR');
    assert('resolucao deve estar vazia (não consultou banco)',
      res.resolucao.length === 0, undefined, res.resolucao.length, 0);
    assert('nextState.itens deve estar vazio',
      res.nextState.itens.length === 0, undefined, res.nextState.itens.length, 0);
  }

  // ── T12: Busca por ID explícito via serviço ───────────────────────────────
  console.log('');
  console.log('─── T12: Busca por ID explícito "101" ──────────────────────────');
  {
    const stateComPendencia: OrcamentoAvulsoState = {
      itens: [{ quantidade: 500, termo: 'triband' }],
      pendingAmbiguity: true,
      pendingTerm: 'triband',
      pendingQuantidade: 500,
    };
    const res = await processarOrcamentoService({
      query: '101',
      state: stateComPendencia,
      supabase,
    });

    // "101" com pendência → resolve ambiguidade como produto ID 101
    assert('action deve ser ADD',
      res.action === 'ADD', undefined, res.action, 'ADD');
    assert('item resolvido tem produtoId 101',
      res.items.some(i => i.produtoId === 101),
      undefined, res.items.map(i => `id:${i.produtoId}`));
  }

  // ── Relatório Final ────────────────────────────────────────────────────────
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  if (failed === 0) {
    console.log(`║  ✅ INTEGRAÇÃO OK — ${passed}/${passed + failed} testes passaram.                    ║`);
    console.log('║  Parser + Resolver + Cálculo: INTEGRADOS ✓                  ║');
    console.log('║  Banco: ZERO leituras reais.                                 ║');
    console.log('║  Escrita: ZERO.                                              ║');
    console.log('║  MAESTRO_AVULSO_ENABLED: não checado aqui (Router cuida).   ║');
  } else {
    console.log(`║  ❌ FALHOU — ${failed} teste(s) falharam.                         ║`);
    console.log('║  Não religar MAESTRO_AVULSO_ENABLED=true até correção.      ║');
  }
  console.log(`║  Testes: ${passed} ✓  |  ${failed} ✗  de ${passed + failed} total                          ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Erro inesperado no teste de integração:', err);
  process.exit(1);
});
