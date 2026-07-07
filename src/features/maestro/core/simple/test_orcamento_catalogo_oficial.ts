/**
 * test_orcamento_catalogo_oficial.ts
 *
 * Testes do catálogo oficial de aliases de produtos.
 * Valida que os termos operacionais resolvem para os IDs corretos.
 *
 * Para rodar: npx tsx src/features/maestro/core/simple/test_orcamento_catalogo_oficial.ts
 *
 * Banco: ZERO acesso. Apenas lógica de mapeamento local.
 * MAESTRO_AVULSO_ENABLED: não verificado aqui.
 */

import {
  resolverTermoCatalogo,
  normalizarTermoCatalogo,
  verificarConflitosAlias,
  CATALOGO_OFICIAL,
} from './maestro-orcamento-catalogo-oficial';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, atual?: any, esperado?: any): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    if (atual !== undefined) console.error(`    Atual:    ${JSON.stringify(atual)}`);
    if (esperado !== undefined) console.error(`    Esperado: ${JSON.stringify(esperado)}`);
    failed++;
  }
}

function assertId(termo: string, idEsperado: number, tipoEsperado?: 'exato' | 'parcial'): void {
  const res = resolverTermoCatalogo(termo);
  const label = `"${termo}" → ID ${idEsperado}`;
  assert(
    label,
    res.id_produto === idEsperado && (tipoEsperado ? res.tipoMatch === tipoEsperado : true),
    { id: res.id_produto, tipo: res.tipoMatch },
    { id: idEsperado, tipo: tipoEsperado ?? 'exato ou parcial' }
  );
}

function assertAmbiguo(termo: string): void {
  const res = resolverTermoCatalogo(termo);
  assert(
    `"${termo}" → ambíguo`,
    res.tipoMatch === 'ambiguo',
    res.tipoMatch,
    'ambiguo'
  );
}

function assertNaoEncontrado(termo: string): void {
  const res = resolverTermoCatalogo(termo);
  assert(
    `"${termo}" → não encontrado`,
    res.tipoMatch === 'nao_encontrado' || res.id_produto === null,
    res.tipoMatch,
    'nao_encontrado'
  );
}

// ─── Testes ───────────────────────────────────────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  TESTE — Catálogo Oficial de Aliases de Produtos             ║');
console.log('╚══════════════════════════════════════════════════════════════╝');

// ── 1. Verificar conflitos internos no catálogo ─────────────────────────────
console.log('');
console.log('─── 1. Verificação de Integridade do Catálogo ─────────────────');

const conflitos = verificarConflitosAlias();
assert(
  'Catálogo sem conflitos de alias entre produtos',
  conflitos.length === 0,
  conflitos.length > 0 ? conflitos : 'nenhum conflito',
  'nenhum conflito'
);

if (conflitos.length > 0) {
  console.error('  ⚠️  Conflitos encontrados:');
  for (const c of conflitos) {
    console.error(`     alias "${c.alias}" → IDs: ${c.produtos.join(', ')}`);
  }
}

// ── 2. Ingressos ────────────────────────────────────────────────────────────
console.log('');
console.log('─── 2. Ingressos ──────────────────────────────────────────────');

assertId('mobi', 401, 'exato');
assertId('MOBI', 401);             // case-insensitive
assertId('Mobi', 401);
assertId('moby', 401, 'exato');
assertId('ingresso mobi', 401, 'exato');
assertId('ingresso moby', 401, 'exato');
assertId('up', 402, 'exato');
assertId('UP', 402);
assertId('ingresso up', 402, 'exato');
assertId('ticket', 501, 'exato');
assertId('TICKET', 501);
assertId('tike', 501, 'exato');

// ── 3. Pulseiras ────────────────────────────────────────────────────────────
console.log('');
console.log('─── 3. Pulseiras ──────────────────────────────────────────────');

assertId('triband', 101, 'exato');
assertId('tri', 101, 'exato');         // ← alias definido no catálogo → 101 (não produto de teste)
assertId('tri band', 101, 'exato');
assertId('tyvek', 101, 'exato');
assertId('pulseira tri', 101, 'exato');
assertId('pulseira triband', 101, 'exato');
assertId('tecido', 102, 'exato');
assertId('velcro', 102, 'exato');
assertId('silicone', 103, 'exato');

// ── 4. Cordões ──────────────────────────────────────────────────────────────
console.log('');
console.log('─── 4. Cordões ─────────────────────────────────────────────────');

assertId('cordao jacare', 601, 'exato');
assertId('jacare', 601, 'exato');
assertId('cordão jacaré', 601);       // com acentos → normalizados
assertId('cordao', 601, 'exato');
assertId('cordao argola', 602, 'exato');
assertId('argola', 602, 'exato');

// ── 5. Crachás ──────────────────────────────────────────────────────────────
console.log('');
console.log('─── 5. Crachás ─────────────────────────────────────────────────');

assertId('cracha pvc', 701, 'exato');
assertId('pvc', 701, 'exato');
assertId('credencial', 702, 'exato');
assertId('cracha papel', 702, 'exato');

// ── 6. IDs numéricos explícitos ─────────────────────────────────────────────
console.log('');
console.log('─── 6. IDs Explícitos ──────────────────────────────────────────');

const res101 = resolverTermoCatalogo('101');
assert('"101" → id_produto = 101', res101.id_produto === 101, res101.id_produto, 101);
assert('"101" → tipoMatch = exato', res101.tipoMatch === 'exato', res101.tipoMatch, 'exato');

const res401 = resolverTermoCatalogo('401');
assert('"401" → id_produto = 401', res401.id_produto === 401, res401.id_produto, 401);

// ID fora do catálogo mas numérico → ainda retorna o ID (cai no banco)
const res9001 = resolverTermoCatalogo('9001');
assert('"9001" (produto de teste) → tipoMatch exato com id=9001', res9001.id_produto === 9001, res9001.id_produto, 9001);

// ── 7. Termos inexistentes ──────────────────────────────────────────────────
console.log('');
console.log('─── 7. Termos Inexistentes ─────────────────────────────────────');

assertNaoEncontrado('xyznaocadastrado99999');
assertNaoEncontrado('produto fantasma');
assertNaoEncontrado('abc');

// ── 8. Normalização ─────────────────────────────────────────────────────────
console.log('');
console.log('─── 8. Normalização de Termos ──────────────────────────────────');

assert(
  'normalizarTermoCatalogo("Cordão Jacaré") = "cordao jacare"',
  normalizarTermoCatalogo('Cordão Jacaré') === 'cordao jacare',
  normalizarTermoCatalogo('Cordão Jacaré'),
  'cordao jacare'
);
assert(
  'normalizarTermoCatalogo("TRIBAND") = "triband"',
  normalizarTermoCatalogo('TRIBAND') === 'triband',
  normalizarTermoCatalogo('TRIBAND'),
  'triband'
);
assert(
  'normalizarTermoCatalogo("Pulseira Tri-Band") = "pulseira tri band"',
  normalizarTermoCatalogo('Pulseira Tri-Band') === 'pulseira tri band',
  normalizarTermoCatalogo('Pulseira Tri-Band'),
  'pulseira tri band'
);

// ── 9. Tamanho do catálogo ──────────────────────────────────────────────────
console.log('');
console.log('─── 9. Sanidade do Catálogo ────────────────────────────────────');

assert(
  `Catálogo tem ${CATALOGO_OFICIAL.length} produtos registrados`,
  CATALOGO_OFICIAL.length >= 8,
  CATALOGO_OFICIAL.length,
  '>= 8'
);

// Garante que cada produto tem ao menos 1 alias
const semAlias = CATALOGO_OFICIAL.filter(p => p.aliases.length === 0);
assert(
  'Todos os produtos têm ao menos 1 alias',
  semAlias.length === 0,
  semAlias.map(p => p.id_produto),
  'nenhum sem alias'
);

// Garante que IDs são únicos
const ids = CATALOGO_OFICIAL.map(p => p.id_produto);
const idsUnicos = new Set(ids);
assert(
  'Todos os IDs de produto são únicos no catálogo',
  ids.length === idsUnicos.size,
  ids.length,
  idsUnicos.size
);

// ─── Relatório Final ─────────────────────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
if (failed === 0) {
  console.log(`║  ✅ CATÁLOGO OFICIAL OK — ${passed}/${passed + failed} testes passaram.              ║`);
  console.log('║  Aliases → IDs: CORRETOS ✓                                  ║');
  console.log('║  Conflitos de alias: NENHUM ✓                               ║');
  console.log('║  Banco: ZERO acesso neste teste ✓                           ║');
} else {
  console.log(`║  ❌ REGRESSÃO — ${failed} teste(s) falharam.                         ║`);
  console.log('║  Corrigir antes de religar MAESTRO_AVULSO_ENABLED=true.     ║');
}
console.log(`║  Testes: ${passed} ✓  |  ${failed} ✗  de ${passed + failed} total                          ║`);
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');

if (failed > 0) {
  process.exit(1);
}
