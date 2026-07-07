/**
 * test_orcamento_resolver.ts
 *
 * Testes do OrcamentoResolver (maestro-orcamento-resolver.server.ts).
 * Roda completamente com fixtures locais — SEM chamada real ao banco.
 *
 * Para rodar: npx tsx src/features/maestro/core/simple/test_orcamento_resolver.ts
 *
 * Banco: Nenhuma escrita. Nenhuma leitura real.
 * MAESTRO_AVULSO_ENABLED: não é verificado aqui (responsabilidade do Router).
 */

import {
  resolverOrcamento,
  criarSupabaseMock,
  type ProdutoDb,
  type ResolverItemResult,
} from './maestro-orcamento-resolver.server';

// ─── Fixtures de Catálogo ─────────────────────────────────────────────────────

const CATALOGO_FIXTURE: ProdutoDb[] = [
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
    descricao: 'INGRESSO MOBI INGRESSO',
    apelidos: 'mobi, ingresso mobi, im',
    valorUnt: 0.85,
    valorFixo: 150,
    ativo: true,
  },
  {
    id_produto: 303,
    descricao: 'CREDENCIAL VIP PREMIUM',
    apelidos: 'vip, credencial vip',
    valorUnt: null, // Preço não cadastrado
    valorFixo: null,
    ativo: true,
  },
  {
    id_produto: 404,
    descricao: 'PULSEIRA DESCONTINUADA',
    apelidos: 'antiga, descontinuada',
    valorUnt: 0.50,
    valorFixo: 0,
    ativo: false, // Inativo
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detalhe?: string, atual?: any, esperado?: any): void {
  if (condition) {
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

// ─── Criação do mock ──────────────────────────────────────────────────────────

const supabaseMock = criarSupabaseMock(CATALOGO_FIXTURE);

// ─── Testes ───────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   Testes do OrcamentoResolver (mock local — sem banco real)  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // ── TESTE 1: Buscar "mobi" por apelido ────────────────────────────────────
  console.log('─── Teste 1: Buscar "mobi" ─────────────────────────────────────');
  {
    const res = await resolverOrcamento(supabaseMock, [{ quantidade: 5200, termo: 'mobi' }]);
    const item = res.itens[0] as ResolverItemResult;
    assert('status deve ser "sucesso"', item.status === 'sucesso', undefined, item.status, 'sucesso');
    assert('produto encontrado deve ser id 202', item.produto?.id_produto === 202, undefined, item.produto?.id_produto, 202);
    // subtotal = 5200 * 0.85 + 150 = 4420 + 150 = 4570
    assert('subtotal correto: 5200 * 0.85 + 150 = 4570', item.subtotal === 4570, undefined, item.subtotal, 4570);
    assert('totalGeral deve ser 4570', res.totalGeral === 4570, undefined, res.totalGeral, 4570);
  }

  // ── TESTE 2: Buscar "triband" por apelido ─────────────────────────────────
  console.log('');
  console.log('─── Teste 2: Buscar "triband" ─────────────────────────────────');
  {
    const res = await resolverOrcamento(supabaseMock, [{ quantidade: 1500, termo: 'triband' }]);
    const item = res.itens[0];
    assert('status deve ser "sucesso"', item.status === 'sucesso', undefined, item.status, 'sucesso');
    assert('produto encontrado deve ser id 101', item.produto?.id_produto === 101, undefined, item.produto?.id_produto, 101);
    // subtotal = 1500 * 1.25 + 0 = 1875
    assert('subtotal correto: 1500 * 1.25 + 0 = 1875', item.subtotal === 1875, undefined, item.subtotal, 1875);
  }

  // ── TESTE 3: Buscar por ID explícito "101" ────────────────────────────────
  console.log('');
  console.log('─── Teste 3: Buscar por ID "101" ─────────────────────────────');
  {
    const res = await resolverOrcamento(supabaseMock, [{ quantidade: 1000, termo: '101' }]);
    const item = res.itens[0];
    assert('status deve ser "sucesso"', item.status === 'sucesso', undefined, item.status, 'sucesso');
    assert('produto encontrado deve ser id 101 (triband)', item.produto?.id_produto === 101, undefined, item.produto?.id_produto, 101);
    // subtotal = 1000 * 1.25 + 0 = 1250
    assert('subtotal correto: 1000 * 1.25 + 0 = 1250', item.subtotal === 1250, undefined, item.subtotal, 1250);
  }

  // ── TESTE 4: Buscar por "id do produto 101" ───────────────────────────────
  console.log('');
  console.log('─── Teste 4: Buscar por "id do produto 101" ──────────────────');
  {
    const res = await resolverOrcamento(supabaseMock, [{ quantidade: 500, termo: 'id do produto 101' }]);
    const item = res.itens[0];
    assert('status deve ser "sucesso"', item.status === 'sucesso', undefined, item.status, 'sucesso');
    assert('produto encontrado deve ser id 101', item.produto?.id_produto === 101, undefined, item.produto?.id_produto, 101);
  }

  // ── TESTE 5: Produto inexistente ──────────────────────────────────────────
  console.log('');
  console.log('─── Teste 5: Produto inexistente "xyzabc" ─────────────────────');
  {
    const res = await resolverOrcamento(supabaseMock, [{ quantidade: 100, termo: 'xyzabc' }]);
    const item = res.itens[0];
    assert('status deve ser "nao_encontrado"', item.status === 'nao_encontrado', undefined, item.status, 'nao_encontrado');
    assert('subtotal deve ser null', item.subtotal === null, undefined, item.subtotal, null);
    assert('totalGeral deve ser null', res.totalGeral === null, undefined, res.totalGeral, null);
  }

  // ── TESTE 6: Produto inativo ───────────────────────────────────────────────
  console.log('');
  console.log('─── Teste 6: Produto inativo "descontinuada" ─────────────────');
  {
    const res = await resolverOrcamento(supabaseMock, [{ quantidade: 100, termo: 'descontinuada' }]);
    const item = res.itens[0];
    assert('status deve ser "inativo"', item.status === 'inativo', undefined, item.status, 'inativo');
    assert('subtotal deve ser null', item.subtotal === null, undefined, item.subtotal, null);
    assert('totalGeral deve ser null (item inativo)', res.totalGeral === null, undefined, res.totalGeral, null);
    assert('produto.ativo deve ser false', item.produto?.ativo === false, undefined, item.produto?.ativo, false);
  }

  // ── TESTE 7: Preço incompleto ──────────────────────────────────────────────
  console.log('');
  console.log('─── Teste 7: Produto sem preço "vip" ─────────────────────────');
  {
    const res = await resolverOrcamento(supabaseMock, [{ quantidade: 50, termo: 'vip' }]);
    const item = res.itens[0];
    assert('status deve ser "preco_incompleto"', item.status === 'preco_incompleto', undefined, item.status, 'preco_incompleto');
    assert('subtotal deve ser null', item.subtotal === null, undefined, item.subtotal, null);
  }

  // ── TESTE 8: Ambiguidade ("cordao") ───────────────────────────────────────
  console.log('');
  console.log('─── Teste 8: Ambiguidade "cordao" ────────────────────────────');
  {
    const res = await resolverOrcamento(supabaseMock, [{ quantidade: 100, termo: 'cordao' }]);
    const item = res.itens[0];
    assert('status deve ser "ambiguo"', item.status === 'ambiguo', undefined, item.status, 'ambiguo');
    assert('candidatos deve ter pelo menos 2', (item.candidatos?.length ?? 0) >= 2, undefined, item.candidatos?.length, '>=2');
    assert('subtotal deve ser null', item.subtotal === null, undefined, item.subtotal, null);
    assert('totalGeral deve ser null', res.totalGeral === null, undefined, res.totalGeral, null);
  }

  // ── TESTE 9: Múltiplos itens — todos sucesso ──────────────────────────────
  console.log('');
  console.log('─── Teste 9: "mobi" + "triband" (múltiplos) ─────────────────');
  {
    const res = await resolverOrcamento(supabaseMock, [
      { quantidade: 5200, termo: 'mobi' },
      { quantidade: 1500, termo: 'triband' },
    ]);
    const [itemMobi, itemTri] = res.itens;
    assert('mobi: status sucesso', itemMobi.status === 'sucesso', undefined, itemMobi.status, 'sucesso');
    assert('triband: status sucesso', itemTri.status === 'sucesso', undefined, itemTri.status, 'sucesso');
    // totalGeral = 4570 + 1875 = 6445
    assert('totalGeral correto: 4570 + 1875 = 6445', res.totalGeral === 6445, undefined, res.totalGeral, 6445);
  }

  // ── TESTE 10: valorFixo null tratado como 0 ───────────────────────────────
  console.log('');
  console.log('─── Teste 10: valorFixo=null tratado como 0 ──────────────────');
  {
    // triband tem valorFixo=0, mas vamos testar com produto que teria null (forçando via mock direto)
    const catalogoComFixoNull: ProdutoDb[] = [{
      id_produto: 999,
      descricao: 'PRODUTO FIXO NULL',
      apelidos: 'fixo null',
      valorUnt: 2.00,
      valorFixo: null, // null deve ser tratado como 0
      ativo: true,
    }];
    const mockLocal = criarSupabaseMock(catalogoComFixoNull);
    const res = await resolverOrcamento(mockLocal, [{ quantidade: 100, termo: 'fixo null' }]);
    const item = res.itens[0];
    // subtotal = 100 * 2.00 + 0 (null → 0) = 200
    assert('status deve ser "sucesso"', item.status === 'sucesso', undefined, item.status, 'sucesso');
    assert('subtotal = 100 * 2.00 + 0 = 200 (valorFixo null → 0)', item.subtotal === 200, undefined, item.subtotal, 200);
  }

  // ── TESTE 11: Garantir que o resolver não acessa tabelas proibidas ─────────
  console.log('');
  console.log('─── Teste 11: Resolver não acessa tabelas proibidas ──────────');
  {
    let erroTabela: string | null = null;
    const mockRestrito = {
      from: (tabela: string) => {
        if (tabela !== 'produtos') {
          erroTabela = tabela;
        }
        return criarSupabaseMock(CATALOGO_FIXTURE).from(tabela);
      }
    } as any;
    await resolverOrcamento(mockRestrito, [{ quantidade: 1, termo: 'triband' }]);
    assert('Não deve acessar tabelas fora de "produtos"', erroTabela === null,
      `Tabela não autorizada acessada: ${erroTabela}`, erroTabela, null);
  }

  // ── Relatório Final ───────────────────────────────────────────────────────
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  if (failed === 0) {
    console.log(`║  ✅ RESOLVER OK — ${passed}/${passed + failed} testes passaram.                       ║`);
    console.log('║  Banco: ZERO leituras reais.                                 ║');
    console.log('║  Escrita: ZERO.                                              ║');
    console.log('║  MAESTRO_AVULSO_ENABLED: não checado aqui (Router cuida).   ║');
  } else {
    console.log(`║  ❌ FALHOU — ${failed} teste(s) falharam.                          ║`);
  }
  console.log(`║  Testes: ${passed} ✓  |  ${failed} ✗  de ${passed + failed} total                          ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Erro inesperado no teste:', err);
  process.exit(1);
});
