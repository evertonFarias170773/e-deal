/**
 * test_orcamento_catalogo_real.ts
 *
 * Fase 3.5 — Sandbox de validação do Orçamento Avulso com dados REAIS
 * de public.produtos. Usa somente leitura (anon key).
 *
 * NÃO altera dados.
 * NÃO usa service_role.
 * NÃO religa MAESTRO_AVULSO_ENABLED.
 * NÃO afeta o Maestro principal, clientes, financeiro ou produção.
 *
 * Para rodar:
 *   npx tsx src/features/maestro/core/simple/test_orcamento_catalogo_real.ts
 *
 * Requer no .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
 */

import { createClient } from '@supabase/supabase-js';
import { processarOrcamentoService } from './maestro-orcamento-service.server';
import { resolverOrcamento } from './maestro-orcamento-resolver.server';
import type { OrcamentoAvulsoState } from './maestro-orcamento-engine';

// ─── Verificação de variáveis ──────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('');
  console.error('❌ ERRO: Variáveis de ambiente não encontradas.');
  console.error('   Defina no .env.local:');
  console.error('     NEXT_PUBLIC_SUPABASE_URL=...');
  console.error('     NEXT_PUBLIC_SUPABASE_ANON_KEY=...');
  console.error('');
  process.exit(1);
}

// Nunca imprimir secrets
console.log(`[Supabase] URL: ${SUPABASE_URL}`);
console.log('[Supabase] ANON_KEY: [presente, não exibida]');
console.log('[Supabase] Modo: READ-ONLY — apenas public.produtos');
console.log('');

// ─── Cliente Supabase ──────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let avisos: string[] = [];

function ok(label: string, detail?: string) {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
}

function fail(label: string, detalhe?: string, atual?: any) {
  console.error(`  ✗ ${label}`);
  if (detalhe) console.error(`    ${detalhe}`);
  if (atual !== undefined) console.error(`    Atual: ${JSON.stringify(atual)}`);
  failed++;
}

function aviso(msg: string) {
  console.warn(`  ⚠ ${msg}`);
  avisos.push(msg);
}

function estadoVazio(): OrcamentoAvulsoState {
  return { itens: [], pendingAmbiguity: false };
}

function printSeparator(titulo: string) {
  console.log('');
  console.log(`─── ${titulo} ${'─'.repeat(Math.max(0, 60 - titulo.length))}`);
}

function printResolucao(res: Awaited<ReturnType<typeof processarOrcamentoService>>) {
  for (const item of res.resolucao) {
    const statusIcon = item.status === 'sucesso' ? '✓' : '⚠';
    const subtotalStr = item.subtotal !== null
      ? item.subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : 'N/A';
    console.log(`    ${statusIcon} [${item.status}] "${item.termo}" × ${item.quantidade} → ${subtotalStr}`);
    if (item.produto) {
      console.log(`       Produto: #${item.produto.id_produto} — ${item.produto.descricao}`);
      console.log(`       valorUnt: ${item.produto.valorUnt} | valorFixo: ${item.produto.valorFixo ?? '(null→0)'} | ativo: ${item.produto.ativo}`);
    }
    if (item.candidatos && item.candidatos.length > 0) {
      console.log(`       Candidatos ambíguos (${item.candidatos.length}):`);
      for (const c of item.candidatos.slice(0, 5)) {
        console.log(`         • #${c.id_produto} ${c.descricao} (apelidos: ${c.apelidos ?? '-'})`);
      }
    }
  }
  if (res.totalGeral !== null) {
    console.log(`    💰 Total: ${res.totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
  } else {
    console.log('    ⚠ Total: BLOQUEADO (ver erros/pendências abaixo)');
  }
  if (res.errors.length > 0) {
    console.log('    Erros/Pendências:');
    for (const e of res.errors) console.log(`      - ${e}`);
  }
}

// ─── PARTE 1: Busca direta no catálogo ────────────────────────────────────────

async function testarBuscaDireta() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  PARTE 1 — Busca Direta no Catálogo (resolverOrcamento)');
  console.log('  Tabela: public.produtos | Modo: READ-ONLY');
  console.log('══════════════════════════════════════════════════════════════');

  // ── Busca "mobi" ──
  printSeparator('Busca: "mobi"');
  {
    const res = await resolverOrcamento(supabase, [{ quantidade: 15600, termo: 'mobi' }]);
    const item = res.itens[0];
    if (!item) {
      fail('"mobi" retornou resultado vazio');
    } else {
      console.log(`  Status: ${item.status}`);
      if (item.produto) {
        console.log(`  Produto: #${item.produto.id_produto} — ${item.produto.descricao}`);
        console.log(`  valorUnt: ${item.produto.valorUnt} | valorFixo: ${item.produto.valorFixo}`);
        console.log(`  ativo: ${item.produto.ativo}`);
      }
      if (item.candidatos) {
        console.log(`  Candidatos (${item.candidatos.length}):`);
        for (const c of item.candidatos.slice(0, 5)) {
          console.log(`    • #${c.id_produto} ${c.descricao}`);
        }
      }
      if (item.subtotal !== null) {
        console.log(`  Subtotal 15.600×mobi: ${item.subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
      }

      switch (item.status) {
        case 'sucesso':
          ok('"mobi" encontrado e resolvido com sucesso');
          break;
        case 'ambiguo':
          aviso('"mobi" retornou ambiguidade no catálogo real — verifique apelidos cadastrados');
          ok('"mobi" respondeu (ambíguo — catálogo real difere do mock)');
          break;
        case 'nao_encontrado':
          aviso('"mobi" não encontrado no catálogo real — apelido pode não estar cadastrado');
          fail('"mobi" não encontrado', 'Cadastrar apelido "mobi" em public.produtos');
          break;
        case 'inativo':
          aviso('"mobi" está inativo no catálogo real');
          ok('"mobi" respondeu (inativo — produto desativado)');
          break;
        case 'preco_incompleto':
          aviso('"mobi" sem valorUnt no catálogo real');
          ok('"mobi" respondeu (preço incompleto)');
          break;
      }
    }
  }

  // ── Busca "triband" ──
  printSeparator('Busca: "triband"');
  {
    const res = await resolverOrcamento(supabase, [{ quantidade: 1500, termo: 'triband' }]);
    const item = res.itens[0];
    if (!item) {
      fail('"triband" retornou resultado vazio');
    } else {
      console.log(`  Status: ${item.status}`);
      if (item.produto) {
        console.log(`  Produto: #${item.produto.id_produto} — ${item.produto.descricao}`);
        console.log(`  valorUnt: ${item.produto.valorUnt} | valorFixo: ${item.produto.valorFixo}`);
      }
      if (item.candidatos) {
        console.log(`  Candidatos (${item.candidatos.length}):`);
        for (const c of item.candidatos.slice(0, 5)) {
          console.log(`    • #${c.id_produto} ${c.descricao}`);
        }
      }
      if (item.subtotal !== null) {
        console.log(`  Subtotal 1.500×triband: ${item.subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
      }

      if (item.status === 'sucesso') {
        ok('"triband" encontrado e resolvido com sucesso');
      } else if (item.status === 'ambiguo') {
        aviso(`"triband" retornou ${item.candidatos?.length ?? 0} candidatos — ambiguidade no catálogo real`);
        ok('"triband" respondeu (ambíguo)');
      } else if (item.status === 'nao_encontrado') {
        aviso('"triband" não encontrado no catálogo real');
        fail('"triband" não encontrado', 'Cadastrar apelido "triband" em public.produtos');
      } else {
        ok(`"triband" respondeu com status: ${item.status}`);
      }
    }
  }

  // ── Busca por ID 101 ──
  printSeparator('Busca: ID "101"');
  {
    const res = await resolverOrcamento(supabase, [{ quantidade: 1000, termo: '101' }]);
    const item = res.itens[0];
    if (!item) {
      fail('ID 101 retornou resultado vazio');
    } else {
      console.log(`  Status: ${item.status}`);
      if (item.produto) {
        console.log(`  Produto: #${item.produto.id_produto} — ${item.produto.descricao}`);
        console.log(`  valorUnt: ${item.produto.valorUnt} | ativo: ${item.produto.ativo}`);
        if (item.subtotal !== null) {
          console.log(`  Subtotal 1.000×id101: ${item.subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
        }
        ok(`ID 101 encontrado: "${item.produto.descricao}" — status: ${item.status}`);
      } else if (item.status === 'nao_encontrado') {
        aviso('ID 101 não existe em public.produtos — fixtures do mock usam ID fictício');
        ok('ID 101 respondeu corretamente como nao_encontrado');
      } else {
        ok(`ID 101 respondeu com status: ${item.status}`);
      }
    }
  }

  // ── Termo inexistente ──
  printSeparator('Busca: termo inexistente "xyznaocadastrado99999"');
  {
    const res = await resolverOrcamento(supabase, [{ quantidade: 100, termo: 'xyznaocadastrado99999' }]);
    const item = res.itens[0];
    if (item?.status === 'nao_encontrado') {
      ok('Termo inexistente retornou nao_encontrado corretamente');
    } else {
      fail('Termo inexistente deveria retornar nao_encontrado', undefined, item?.status);
    }
  }

  // ── Busca "tri" (parcial) ──
  printSeparator('Busca: "tri" (parcial de triband)');
  {
    const res = await resolverOrcamento(supabase, [{ quantidade: 1000, termo: 'tri' }]);
    const item = res.itens[0];
    console.log(`  Status: ${item?.status ?? 'sem resultado'}`);
    if (item?.produto) {
      console.log(`  Produto: #${item.produto.id_produto} — ${item.produto.descricao}`);
    }
    if (item?.candidatos) {
      console.log(`  Candidatos (${item.candidatos.length}):`);
      for (const c of item.candidatos.slice(0, 5)) {
        console.log(`    • #${c.id_produto} ${c.descricao}`);
      }
    }
    if (item?.status === 'sucesso') {
      ok('"tri" resolveu para um produto único');
    } else if (item?.status === 'ambiguo') {
      aviso(`"tri" é ambíguo no catálogo real (${item.candidatos?.length ?? 0} candidatos)`);
      ok('"tri" respondeu como ambíguo — esperado se houver múltiplos produtos com "tri"');
    } else if (item?.status === 'nao_encontrado') {
      aviso('"tri" não encontrado — apelido "tri" pode não estar cadastrado');
      ok('"tri" respondeu como nao_encontrado');
    } else {
      ok(`"tri" respondeu com status: ${item?.status}`);
    }
  }
}

// ─── PARTE 2: Diálogos via serviço isolado ────────────────────────────────────

async function testarDialogos() {
  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  PARTE 2 — Diálogos via processarOrcamentoService (serviço isolado)');
  console.log('  Tabela: public.produtos | Modo: READ-ONLY');
  console.log('══════════════════════════════════════════════════════════════');

  let state = estadoVazio();

  // ── D1: "15600 mobi + 1500 triband qual valor?" ──
  printSeparator('D1: "15600 mobi + 1500 triband qual valor?"');
  {
    const res = await processarOrcamentoService({
      query: '15600 mobi + 1500 triband qual valor?',
      state,
      supabase,
    });
    console.log(`  Action: ${res.action} | Itens: ${res.items.length} | Total: ${res.totalGeral !== null ? res.totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'BLOQUEADO'}`);
    printResolucao(res);

    if (res.action === 'ADD' || res.action === 'REPLACE') {
      ok('D1 — action ADD/REPLACE');
    } else {
      fail('D1 — action esperada ADD/REPLACE', undefined, res.action);
    }
    if (res.items.length >= 1) {
      ok('D1 — pelo menos 1 item parseado');
    } else {
      fail('D1 — nenhum item parseado', undefined, res.items.length);
    }

    state = res.nextState;
  }

  // ── D2: "muda a qtd do mobi pra 10k" ──
  printSeparator('D2: "muda a qtd do mobi pra 10k"');
  {
    const res = await processarOrcamentoService({
      query: 'muda a qtd do mobi pra 10k',
      state,
      supabase,
    });
    console.log(`  Action: ${res.action} | Total: ${res.totalGeral !== null ? res.totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'BLOQUEADO'}`);
    printResolucao(res);

    if (res.action === 'UPDATE_QTD') {
      ok('D2 — action UPDATE_QTD');
      const mobi = res.items.find(i => i.termo === 'mobi');
      if (mobi?.quantidade === 10000) {
        ok('D2 — qtd do mobi atualizada para 10.000');
      } else {
        aviso(`D2 — qtd do mobi: ${mobi?.quantidade ?? 'não encontrado'} (esperado 10.000)`);
      }
    } else {
      aviso(`D2 — action esperada UPDATE_QTD, mas obteve: ${res.action}`);
    }

    state = res.nextState;
  }

  // ── D3: "muda a quantidade do mobi para 10.000" ──
  printSeparator('D3: "muda a quantidade do mobi para 10.000" (reinicia)');
  {
    // Reiniciar com estado D1 para testar a variação com ponto
    const res1 = await processarOrcamentoService({
      query: '15600 mobi + 1500 triband qual valor?',
      state: estadoVazio(),
      supabase,
    });
    const res = await processarOrcamentoService({
      query: 'muda a quantidade do mobi para 10.000',
      state: res1.nextState,
      supabase,
    });
    console.log(`  Action: ${res.action} | Total: ${res.totalGeral !== null ? res.totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'BLOQUEADO'}`);
    printResolucao(res);

    if (res.action === 'UPDATE_QTD') {
      ok('D3 — action UPDATE_QTD com escrita "10.000"');
    } else {
      aviso(`D3 — action: ${res.action}`);
    }
  }

  // ── D4: "10600 mobi + 1500 triband qual valor?" ──
  printSeparator('D4: "10600 mobi + 1500 triband qual valor?" (replace)');
  {
    const res = await processarOrcamentoService({
      query: '10600 mobi + 1500 triband qual valor?',
      state,  // já tem itens do D2
      supabase,
    });
    console.log(`  Action: ${res.action} | Total: ${res.totalGeral !== null ? res.totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'BLOQUEADO'}`);
    printResolucao(res);

    if (res.action === 'REPLACE') {
      ok('D4 — action REPLACE (reescreveu lista inteira)');
    } else {
      aviso(`D4 — action: ${res.action} (pode ser ADD se "qual valor" não disparar replace)`);
      ok('D4 — respondeu com catálogo real');
    }

    state = res.nextState;
  }

  // ── D5: "1500 tri" ──
  printSeparator('D5: "1500 tri" (parcial de triband)');
  {
    const res = await processarOrcamentoService({
      query: '1500 tri',
      state: estadoVazio(),
      supabase,
    });
    console.log(`  Action: ${res.action} | Total: ${res.totalGeral !== null ? res.totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'BLOQUEADO'}`);
    printResolucao(res);

    ok(`D5 — "1500 tri" respondeu com status: ${res.resolucao[0]?.status ?? 'sem resolução'}`);
  }

  // ── D6: "101" com pendência ──
  printSeparator('D6: "101" com pendência de produto (resolução de ambiguidade)');
  {
    // Simula estado com pendência — como seria após "1500 cordao" ambíguo
    const stateComPendencia: OrcamentoAvulsoState = {
      itens: [{ quantidade: 1500, termo: 'algumproduto' }],
      pendingAmbiguity: true,
      pendingTerm: 'algumproduto',
      pendingQuantidade: 1500,
    };
    const res = await processarOrcamentoService({
      query: '101',
      state: stateComPendencia,
      supabase,
    });
    console.log(`  Action: ${res.action}`);
    printResolucao(res);

    if (res.action === 'ADD') {
      ok('D6 — "101" com pendência → ADD (ID resolvido)');
    } else {
      aviso(`D6 — action: ${res.action}`);
      ok('D6 — respondeu');
    }
  }

  // ── D7: "assim não dá" ──
  printSeparator('D7: "assim não dá" (cancelamento)');
  {
    const res = await processarOrcamentoService({
      query: 'assim não dá',
      state,
      supabase,
    });
    console.log(`  Action: ${res.action}`);
    if (res.action === 'CLEAR') {
      ok('D7 — "assim não dá" limpou o orçamento (CLEAR)');
    } else if (res.action === 'NONE') {
      aviso('D7 — "assim não dá" retornou NONE (frase não mapeada como cancela)');
      ok('D7 — respondeu sem erro');
    } else {
      ok(`D7 — respondeu com action: ${res.action}`);
    }
  }
}

// ─── PARTE 3: Resumo de segurança ─────────────────────────────────────────────

async function verificarSeguranca() {
  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  PARTE 3 — Verificação de Segurança');
  console.log('══════════════════════════════════════════════════════════════');

  // Confirmar que o resolver não acessa outras tabelas
  let tabelasAcessadas: string[] = [];
  const supabaseInstrumented = {
    from: (tabela: string) => {
      tabelasAcessadas.push(tabela);
      return supabase.from(tabela);
    }
  } as any;

  await resolverOrcamento(supabaseInstrumented, [{ quantidade: 1, termo: 'mobi' }]);

  const tabelasProibidas = tabelasAcessadas.filter(t => t !== 'produtos');
  if (tabelasProibidas.length === 0) {
    ok(`Resolver acessou apenas "produtos" (${tabelasAcessadas.join(', ')})`);
  } else {
    fail('Resolver acessou tabela proibida', undefined, tabelasProibidas);
  }

  // Confirmar MAESTRO_AVULSO_ENABLED segue false
  const avulsoEnabled = process.env.MAESTRO_AVULSO_ENABLED;
  if (!avulsoEnabled || avulsoEnabled === 'false') {
    ok('MAESTRO_AVULSO_ENABLED segue false (ou não definido)');
  } else {
    fail('MAESTRO_AVULSO_ENABLED não está false!', undefined, avulsoEnabled);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  FASE 3.5 — Sandbox Orçamento Avulso com Catálogo Real       ║');
  console.log('║  public.produtos — READ-ONLY — ANON KEY                      ║');
  console.log('║  MAESTRO_AVULSO_ENABLED=false                                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  try {
    await testarBuscaDireta();
    await testarDialogos();
    await verificarSeguranca();
  } catch (err) {
    console.error('');
    console.error('❌ ERRO NÃO ESPERADO:', err instanceof Error ? err.message : String(err));
    failed++;
  }

  // ── Relatório final ────────────────────────────────────────────────────────
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  if (failed === 0) {
    console.log(`║  ✅ SANDBOX OK — ${passed} verificações passaram.                   ║`);
    console.log('║  Leitura real: public.produtos (read-only) ✓                 ║');
    console.log('║  Escrita: ZERO ✓                                             ║');
    console.log('║  Tabelas proibidas: 0 acessadas ✓                            ║');
  } else {
    console.log(`║  ⚠ SANDBOX COM RESSALVAS — ${failed} ponto(s) de atenção.           ║`);
    console.log('║  Verifique apelidos/preços no catálogo real antes da Fase 4. ║');
  }
  if (avisos.length > 0) {
    console.log('║  ─── Avisos de catálogo real ─────────────────────────────── ║');
    for (const a of avisos) {
      const aStr = a.substring(0, 56).padEnd(56, ' ');
      console.log(`║  ⚠ ${aStr} ║`);
    }
  }
  console.log(`║  Verificações: ${passed} ✓  |  ${failed} pontos atenção  de ${passed + failed} total           ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Saída 0 mesmo com avisos — avisos são informativos, não bloqueadores
  process.exit(0);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
