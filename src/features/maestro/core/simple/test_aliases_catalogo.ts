/**
 * test_aliases_catalogo.ts
 *
 * Teste de cobertura do catálogo oficial de aliases.
 * Valida que cada termo resolve para o ID correto.
 * Sem chamada ao banco. 100% lógica de catálogo.
 *
 * Executar: npx tsx src/features/maestro/core/simple/test_aliases_catalogo.ts
 */

import {
  resolverTermoCatalogo,
  verificarAliasGenerico,
  verificarConflitosAlias,
} from './maestro-orcamento-catalogo-oficial';

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface TestResult {
  label: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];
let passCount = 0;
let failCount = 0;

function ok(label: string, condition: boolean, detail?: string) {
  const passed = condition;
  results.push({ label, passed, detail });
  if (passed) {
    passCount++;
    console.log(`  \u2713 ${label}`);
  } else {
    failCount++;
    console.log(`  \u2717 ${label}${detail ? ' \u2014 ' + detail : ''}`);
  }
}

function resolveId(termo: string): number | null {
  return resolverTermoCatalogo(termo).id_produto;
}

function resolveType(termo: string): string {
  return resolverTermoCatalogo(termo).tipoMatch;
}

// ─── Início dos Testes ────────────────────────────────────────────────────────

console.log('=== Teste de Aliases do Catálogo Oficial ===\n');

// ── PULSEIRAS ─────────────────────────────────────────────────────────────────

console.log('\u2500\u2500 Pulseiras \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
ok('"triband" \u2192 ID 101', resolveId('triband') === 101);
ok('"tri" \u2192 ID 101 (n\u00e3o 9001)', resolveId('tri') === 101);
ok('"pulseira triband" \u2192 ID 101', resolveId('pulseira triband') === 101);
ok('"tyvek" \u2192 ID 101', resolveId('tyvek') === 101);
ok('"tribnd" typo \u2192 ID 101', resolveId('tribnd') === 101);
ok('"colorband" \u2192 ID 102', resolveId('colorband') === 102);
ok('"color band" \u2192 ID 102', resolveId('color band') === 102);
ok('"texband" \u2192 ID 301', resolveId('texband') === 301);
ok('"tex band" \u2192 ID 301', resolveId('tex band') === 301);
ok('"tecido" \u2192 ID 301', resolveId('tecido') === 301);
ok('"bracelete" \u2192 ID 104', resolveId('bracelete') === 104);
ok('"dryband" \u2192 ID 106', resolveId('dryband') === 106);
ok('"neonband" \u2192 ID 303', resolveId('neonband') === 303);

// ── INGRESSOS ─────────────────────────────────────────────────────────────────

console.log('\n\u2500\u2500 Ingressos \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
ok('"mobi" \u2192 ID 401', resolveId('mobi') === 401);
ok('"moby" \u2192 ID 401', resolveId('moby') === 401);
ok('"up box" \u2192 ID 402', resolveId('up box') === 402);
ok('"up" \u2192 ID 402', resolveId('up') === 402);
ok('"van gogh" \u2192 ID 403', resolveId('van gogh') === 403);
ok('"vangogh" \u2192 ID 403', resolveId('vangogh') === 403);
ok('"mega 4" \u2192 ID 404', resolveId('mega 4') === 404);
ok('"mega" \u2192 ID 404', resolveId('mega') === 404);
ok('"f4" \u2192 ID 404', resolveId('f4') === 404);
ok('"f5" \u2192 ID 403', resolveId('f5') === 403);
ok('"f6" \u2192 ID 402', resolveId('f6') === 402);

// ── TICKETS ───────────────────────────────────────────────────────────────────

console.log('\n\u2500\u2500 Tickets \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
ok('"ticket color" \u2192 ID 501', resolveId('ticket color') === 501);
ok('"ticket bar" \u2192 ID 501', resolveId('ticket bar') === 501);
ok('"ficha" \u2192 ID 501', resolveId('ficha') === 501);
ok('"vale bar" \u2192 ID 501', resolveId('vale bar') === 501);
ok('"tiket" typo \u2192 ID 501', resolveId('tiket') === 501);

// ── CORDÕES ───────────────────────────────────────────────────────────────────

console.log('\n\u2500\u2500 Cord\u00f5es \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
ok('"cordao jacare" \u2192 ID 601', resolveId('cordao jacare') === 601);
ok('"jacare" \u2192 ID 601', resolveId('jacare') === 601);
ok('"jacar\u00e9" \u2192 ID 601 (com acento)', resolveId('jacar\u00e9') === 601);
ok('"cordao mosquete metal" \u2192 ID 604', resolveId('cordao mosquete metal') === 604);
ok('"mosquete metal" \u2192 ID 604', resolveId('mosquete metal') === 604);
ok('"cordao mosquete plastico" \u2192 ID 607', resolveId('cordao mosquete plastico') === 607);
ok('"cordao argola" \u2192 ID 613', resolveId('cordao argola') === 613);
ok('"argola" \u2192 ID 613', resolveId('argola') === 613);

// ── CRACHÁS/CREDENCIAIS ────────────────────────────────────────────────────────

console.log('\n\u2500\u2500 Crach\u00e1s/Credenciais \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
ok('"cracha pvc" \u2192 ID 801', resolveId('cracha pvc') === 801);
ok('"cartao pvc" \u2192 ID 801', resolveId('cartao pvc') === 801);
ok('"cartao rigido" \u2192 ID 801', resolveId('cartao rigido') === 801);
ok('"credencial" \u2192 ID 901', resolveId('credencial') === 901);
ok('"credencial pvc" \u2192 ID 901', resolveId('credencial pvc') === 901);
ok('"credencial slim" \u2192 ID 902', resolveId('credencial slim') === 902);

// ── PRODUTO INATIVO ───────────────────────────────────────────────────────────

console.log('\n\u2500\u2500 Produto Inativo \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
ok('"jetband" \u2192 tipoMatch inativo', resolveType('jetband') === 'inativo');
ok('"jet band" \u2192 tipoMatch inativo', resolveType('jet band') === 'inativo');
ok('"nylon" \u2192 tipoMatch inativo', resolveType('nylon') === 'inativo');
ok('"nilon" \u2192 tipoMatch inativo', resolveType('nilon') === 'inativo');
ok('"jato de tinta" \u2192 tipoMatch inativo', resolveType('jato de tinta') === 'inativo');
ok('"jetband" \u2192 id_produto=103 (regista mas n\u00e3o cota)', resolveId('jetband') === 103);
ok('"jetbnd" typo \u2192 inativo', resolveType('jetbnd') === 'inativo');

// ── ALIASES GENÉRICOS ─────────────────────────────────────────────────────────

console.log('\n\u2500\u2500 Aliases Gen\u00e9ricos (pedir confirma\u00e7\u00e3o) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
ok('"cord\u00e3o" sozinho \u2192 generico', resolveType('cord\u00e3o') === 'generico');
ok('"cordao" sozinho \u2192 generico', resolveType('cordao') === 'generico');
ok('"pulseira" sozinho \u2192 generico', resolveType('pulseira') === 'generico');
ok('"cracha" sozinho \u2192 generico', resolveType('cracha') === 'generico');
ok('"pvc" sozinho \u2192 generico', resolveType('pvc') === 'generico');
ok('verificarAliasGenerico("cord\u00e3o") retorna sugest\u00e3o', verificarAliasGenerico('cord\u00e3o') !== null);
ok('verificarAliasGenerico("pulseira") retorna sugest\u00e3o', verificarAliasGenerico('pulseira') !== null);
ok('verificarAliasGenerico("triband") retorna null (n\u00e3o \u00e9 gen\u00e9rico)', verificarAliasGenerico('triband') === null);

// ── CONFLITOS DE ALIAS ────────────────────────────────────────────────────────

console.log('\n\u2500\u2500 Conflitos de Alias \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
const conflitos = verificarConflitosAlias();
if (conflitos.length === 0) {
  ok('Nenhum conflito de alias no cat\u00e1logo', true);
} else {
  ok(
    'Nenhum conflito de alias no cat\u00e1logo',
    false,
    JSON.stringify(conflitos)
  );
}

// ── ANTI-REGRESSÃO: TesteBand 9001 não vence Triband ─────────────────────────

console.log('\n\u2500\u2500 Anti-Regress\u00e3o TesteBand 9001 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
const triId = resolveId('tri');
ok('"tri" resolve 101, n\u00e3o 9001', triId === 101);
ok('"triband" resolve 101, n\u00e3o 9001', resolveId('triband') === 101);
// 'band' n\u00e3o est\u00e1 no cat\u00e1logo oficial, portanto n\u00e3o deve retornar 9001
const bandId = resolveId('band');
ok('"band" n\u00e3o resolve para 9001', bandId !== 9001);

// ── RESULTADO FINAL ───────────────────────────────────────────────────────────

const total = passCount + failCount;
console.log('\n' + '\u2550'.repeat(62));
if (failCount === 0) {
  console.log(`\u2551  \u2705 ALIASES OK \u2014 ${passCount}/${total} testes passaram.`);
} else {
  console.log(`\u2551  \u274c FALHA \u2014 ${passCount} ok, ${failCount} falhou(aram) de ${total} total.`);
}
console.log('\u2550'.repeat(62));

if (failCount > 0) process.exit(1);
