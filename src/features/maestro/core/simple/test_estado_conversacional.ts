/**
 * test_estado_conversacional.ts
 *
 * Testes da correção estrutural "estado conversacional de primeira classe"
 * (pendingGoal, pendingInteraction, retomada de objetivo, respostas por
 * estado real). 100% determinístico — sem LLM e sem banco.
 *
 * Cobre as variações do diagnóstico:
 *   G. Derivação/preservação do pendingGoal (inclui interrupção por "cliente X")
 *   H. Diálogo real: "15680 triband qual valor?" → cliente → confirmações em
 *      várias formas de falar → retomada
 *   I. getPendingInteraction para cada pendência
 *   J. temEstadoConversacional / gate de respostas estáticas
 *   K. descreverEstadoReal (nunca afirma estado inexistente)
 *   L. Roteamento determinístico com estado (social exige cotação real)
 *   M. Presenters parametrizados por estado real
 *
 * Execução: npx tsx src/features/maestro/core/simple/test_estado_conversacional.ts
 */

import {
  getEmptyV2Context,
  handleContextContinuation,
  serializeV2Context,
  deserializeV2Context,
  computePendingGoal,
  getPendingInteraction,
  temEstadoConversacional,
  obterItensRetomada,
  descreverEstadoReal,
  type MaestroV2Context,
} from './maestro-v2-context-manager';
import { processarOrcamentoAvulso } from './maestro-orcamento-engine';
import { detectIntent } from './maestro-simple-intents';
import { presenterRespostaSocialCotacao, presenterClosure } from './maestro-simple-presenter';

process.env.MAESTRO_AVULSO_ENABLED = 'true';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, actual?: any, expected?: any) {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    if (actual !== undefined) console.error(`  Atual:    ${JSON.stringify(actual)}`);
    if (expected !== undefined) console.error(`  Esperado: ${JSON.stringify(expected)}`);
    failed++;
  }
}

function roundtrip(ctx: MaestroV2Context): MaestroV2Context {
  return deserializeV2Context(serializeV2Context(ctx));
}

// ─── G. Derivação e preservação do pendingGoal ────────────────────────────────

console.log('\n─── G. computePendingGoal ───');

{
  const ctx = getEmptyV2Context();
  ctx.domain = 'orcamento_avulso';
  ctx.orcamentoItens = [{ quantidade: 15680, termo: 'triband' }];
  const goal = computePendingGoal(ctx);
  assert('G1: itens sem cliente/endereço → goal com faltando [cliente, endereco]',
    goal?.tipo === 'cotacao' && goal.itens.length === 1 &&
    goal.faltando.includes('cliente') && goal.faltando.includes('endereco'), goal);
}

{
  // Interrupção estilo "cliente X" (seção 2): domínio muda, itens são limpos,
  // mas o goal anterior sobrevive.
  const ctx = getEmptyV2Context();
  ctx.domain = 'orcamento_avulso';
  ctx.orcamentoItens = [{ quantidade: 15680, termo: 'triband' }];
  const persisted = roundtrip(ctx); // goal derivado aqui
  persisted.domain = 'cliente';
  persisted.orcamentoItens = [];
  const after = roundtrip(persisted);
  assert('G2: goal SOBREVIVE à interrupção que limpa os itens',
    after.pendingGoal?.itens?.[0]?.quantidade === 15680, after.pendingGoal);
}

{
  const ctx = getEmptyV2Context();
  ctx.domain = 'orcamento_avulso';
  ctx.orcamentoItens = [{ quantidade: 10, termo: 'mobi' }];
  ctx.activeQuote = { status: 'nao_salva', itens: [] } as any;
  assert('G3: activeQuote presente → goal null (objetivo materializado)', computePendingGoal(ctx) === null);
}

{
  const ctx = getEmptyV2Context();
  ctx.domain = 'orcamento_avulso';
  ctx.orcamentoItens = [{ quantidade: 10, termo: 'mobi' }];
  ctx.pendingSaveQuotation = { savedIdInt: undefined } as any;
  assert('G4: pendingSaveQuotation → goal null', computePendingGoal(ctx) === null);
}

{
  const ctx = getEmptyV2Context();
  ctx.domain = 'orcamento_avulso';
  ctx.orcamentoItens = [{ quantidade: 15680, termo: 'triband' }];
  const persisted = roundtrip(ctx);
  const r = handleContextContinuation('esquece orcamento', persisted, null);
  assert('G5a: cancelamento explícito roteia cancelar', r?.plan?.steps?.[0]?.tool === 'cancelar_orcamento_avulso', r?.plan?.steps?.[0]?.tool);
  const after = roundtrip(persisted);
  assert('G5b: cancelamento explícito zera o goal', after.pendingGoal === null || after.pendingGoal === undefined, after.pendingGoal);
}

{
  const ctx = getEmptyV2Context();
  ctx.domain = 'orcamento_avulso';
  ctx.orcamentoItens = [{ quantidade: 500, termo: 'tex' }];
  ctx.activeEntities.clientInternalId = 8469;
  const goal = computePendingGoal(ctx);
  assert('G6: cliente resolvido → faltando apenas endereco',
    goal !== null && !goal!.faltando.includes('cliente') && goal!.faltando.includes('endereco'), goal?.faltando);
}

// ─── H. Diálogo real do diagnóstico (camadas determinísticas) ────────────────

console.log('\n─── H. Diálogo "15680 triband qual valor?" ───');

// T1: parse determinístico da cotação
const parseT1 = processarOrcamentoAvulso('15680 triband qual valor?', { itens: [], pendingAmbiguity: false });
assert('H1: T1 parse → ADD [15680 triband]',
  parseT1.action === 'ADD' && parseT1.items[0]?.quantidade === 15680 && parseT1.items[0]?.termo === 'triband', parseT1.items);

// Simula fim do turno 1 (itens no contexto) + turno 2 "cliente Lisiton documentos"
const dlg = getEmptyV2Context();
dlg.domain = 'orcamento_avulso';
dlg.orcamentoItens = parseT1.items;
let dlgPersisted = roundtrip(dlg);

const r2 = handleContextContinuation('cliente Lisiton documentos', dlgPersisted, null);
assert('H2a: T2 "cliente Lisiton documentos" delega a busca (null)', r2 === null);
assert('H2b: T2 suspende os itens da conversa', (dlgPersisted.orcamentoItens ?? []).length === 0);
dlgPersisted = roundtrip(dlgPersisted);
assert('H2c: T2 preserva o OBJETIVO (goal) apesar da suspensão',
  dlgPersisted.pendingGoal?.itens?.[0]?.quantidade === 15680, dlgPersisted.pendingGoal);

// T2.5: o engine registraria o candidato; simulamos o registro
dlgPersisted.pendingClientCandidate = { id_cliente: 8469, nome: 'LISITON DOCUMENTOS SEGUROS LTDA', fantasia: '', documento: '', cidade_uf: '' };

// T3: confirmações em VÁRIAS formas de falar → todas confirmam o candidato
const confirmacoes = ['sim esse mesmo', 'correto', 'isso', 'pode ser esse', 'exato', 'e esse mesmo', 'confirmo'];
for (const frase of confirmacoes) {
  const ctxC = deserializeV2Context(serializeV2Context(dlgPersisted));
  ctxC.pendingClientCandidate = { ...dlgPersisted.pendingClientCandidate! };
  const rc = handleContextContinuation(frase, ctxC, null);
  assert(`H3: "${frase}" confirma o candidato`,
    rc?.plan?.steps?.[0]?.tool === 'confirmar_cliente_pendente' && rc?.plan?.steps?.[0]?.params?.id_cliente === 8469,
    rc?.plan?.steps?.[0]);
  // Após confirmar, a retomada estrutural encontra os itens do objetivo
  const itens = obterItensRetomada(ctxC);
  assert(`H3b: retomada pós-"${frase}" encontra os itens do objetivo`,
    itens !== null && itens[0]?.quantidade === 15680, itens);
}

// T4: "correto" SEM pendência e SEM cotação → não é interceptado como social
{
  const ctxT4 = getEmptyV2Context();
  const r4 = handleContextContinuation('correto', ctxT4, { clientInternalId: 8469, clientName: 'LISITON' });
  assert('H4: "correto" sem pendência/cotação → null (router decide com ESTADO REAL)', r4 === null);
}

// ─── I. getPendingInteraction ────────────────────────────────────────────────

console.log('\n─── I. getPendingInteraction ───');

{
  const ctx = getEmptyV2Context();
  assert('I1: contexto vazio → null', getPendingInteraction(ctx) === null);

  ctx.pendingClientCandidate = { id_cliente: 8469, nome: 'LISITON', fantasia: '', documento: '', cidade_uf: '' };
  const i1 = getPendingInteraction(ctx);
  assert('I2: candidato único → confirmar_candidato com id na descrição',
    i1?.tipo === 'confirmar_candidato' && i1.descricao.includes('8469'), i1);
  ctx.pendingClientCandidate = null;

  ctx.pendingClientCandidates = [
    { id_cliente: 1, nome: 'A', fantasia: '', documento: '', cidade_uf: 'POA' },
    { id_cliente: 2, nome: 'B', fantasia: '', documento: '', cidade_uf: 'SCS' },
  ];
  const i2 = getPendingInteraction(ctx);
  assert('I3: múltiplos candidatos → escolher_candidato listando ids',
    i2?.tipo === 'escolher_candidato' && i2.descricao.includes('1: A') && i2.descricao.includes('2: B'), i2);
  ctx.pendingClientCandidates = null;

  ctx.pendingAddressChoice = { clientId: 1, addresses: [{} as any, {} as any] };
  assert('I4: escolha de endereço → escolher_endereco', getPendingInteraction(ctx)?.tipo === 'escolher_endereco');
  ctx.pendingAddressChoice = null;

  ctx.pendingFreightChoice = { fretes: [{} as any], clientInternalId: 1, clientName: '', enderecoFull: '', cidade: '', uf: '', itens: [], subtotal: 0, pesoTotalGramas: 0 } as any;
  assert('I5: escolha de frete → escolher_frete', getPendingInteraction(ctx)?.tipo === 'escolher_frete');
  ctx.pendingFreightChoice = null;

  ctx.pendingSaveQuotation = { clientName: 'X', total: 100 } as any;
  assert('I6: save pendente → confirmar_save', getPendingInteraction(ctx)?.tipo === 'confirmar_save');
  ctx.pendingSaveQuotation = { clientName: 'X', total: 100, savedIdInt: 123 } as any;
  assert('I7: já salvo → NÃO é confirmar_save', getPendingInteraction(ctx)?.tipo !== 'confirmar_save');
}

// ─── J. temEstadoConversacional (gate das respostas estáticas) ───────────────

console.log('\n─── J. temEstadoConversacional ───');

{
  const vazio = getEmptyV2Context();
  assert('J1: sem estado e sem cliente → false (estático permitido)', temEstadoConversacional(vazio, false) === false);
  assert('J2: cliente ativo → true', temEstadoConversacional(vazio, true) === true);

  const comGoal = getEmptyV2Context();
  comGoal.pendingGoal = { tipo: 'cotacao', itens: [{ quantidade: 1, termo: 'x' }], criadoEm: '', faltando: ['cliente'] };
  assert('J3: objetivo pendente → true', temEstadoConversacional(comGoal, false) === true);

  const comCandidato = getEmptyV2Context();
  comCandidato.pendingClientCandidate = { id_cliente: 1, nome: 'A', fantasia: '', documento: '', cidade_uf: '' };
  assert('J4: pergunta aberta → true', temEstadoConversacional(comCandidato, false) === true);
}

// ─── K. descreverEstadoReal (nunca afirma estado inexistente) ────────────────

console.log('\n─── K. descreverEstadoReal ───');

{
  const ctx = getEmptyV2Context();
  const s0 = descreverEstadoReal(ctx, null);
  assert('K1: sem estado → declara explicitamente "nenhum(a)" em tudo',
    s0.includes('Cliente ativo: nenhum') && s0.includes('Objetivo pendente: nenhum') &&
    s0.includes('nenhuma (não afirme que existe cotação aberta)'), s0);

  ctx.pendingGoal = { tipo: 'cotacao', itens: [{ quantidade: 15680, termo: 'triband' }], criadoEm: '', faltando: ['cliente'] };
  ctx.pendingClientCandidate = { id_cliente: 8469, nome: 'LISITON', fantasia: '', documento: '', cidade_uf: '' };
  const s1 = descreverEstadoReal(ctx, { nome: 'OUTRA', id: 1 });
  assert('K2: goal e candidato aparecem com dados concretos',
    s1.includes('15680× triband') && s1.includes('falta resolver: cliente') && s1.includes('8469'), s1);

  const ctx2 = getEmptyV2Context();
  ctx2.activeQuote = { clientName: 'LISITON', total: 592, status: 'salva', savedIdInt: 19999, itens: [] } as any;
  const s2 = descreverEstadoReal(ctx2, null);
  assert('K3: cotação salva → status real com número da proposta', s2.includes('SALVA como proposta #19999'), s2);
}

// ─── L. Roteamento determinístico com estado real ────────────────────────────

console.log('\n─── L. Social/encerramento pelo estado real ───');

{
  // "valeu" COM cotação real → social (que agora só afirma cotação se real)
  const comQuote = getEmptyV2Context();
  comQuote.activeQuote = { status: 'nao_salva', clientName: 'X', total: 1, itens: [], fretes: [], freteSelecionado: {} } as any;
  const rl = handleContextContinuation('valeu', comQuote, null);
  assert('L1: "valeu" com cotação real → resposta_social_cotacao', rl?.plan?.steps?.[0]?.tool === 'resposta_social_cotacao');

  // "valeu" SEM cotação → NÃO intercepta como social-de-cotação
  const rl2 = handleContextContinuation('valeu', getEmptyV2Context(), null);
  assert('L2: "valeu" sem cotação → null (sem social falso)', rl2 === null);
}

// ─── M. Presenters nunca afirmam estado inexistente ──────────────────────────

console.log('\n─── M. Presenters parametrizados ───');

{
  const semCotacao = presenterRespostaSocialCotacao('Evi', false).message.content;
  assert('M1: social SEM cotação não menciona cotação', !/cota[cç][ãa]o/i.test(semCotacao), semCotacao);

  const comCotacao = presenterRespostaSocialCotacao('Evi', true).message.content;
  assert('M2: social COM cotação menciona a cotação aberta', /cota[cç][ãa]o/i.test(comCotacao), comCotacao);

  const closureSemCliente = presenterClosure().message.content;
  assert('M3: encerramento sem cliente não cita cliente', !closureSemCliente.includes('**'), closureSemCliente);

  const closureComCliente = presenterClosure({ activeClient: { clientName: 'LISITON', clientDisplayCode: '8469', enderecos: [], contatos: [], socios: [], source: '', queriedAt: '', fontesRelacoes: { enderecos: '', contatos: '', socios: '' } }, lastAnswer: null }).message.content;
  assert('M4: encerramento com cliente cita o cliente real', closureComCliente.includes('LISITON'), closureComCliente);
}

// ─── N. Intents estáticas de cliente → caminho V2 unificado ──────────────────

console.log('\n─── N. detectIntent → premap buscarCliente ───');

{
  const casos: Array<[string, string | undefined]> = [
    ['cliente 8469', '8469'],
    ['busca 8469', '8469'],
    ['cliente Lisiton documentos', 'lisiton documentos'],
  ];
  for (const [frase, buscaEsperada] of casos) {
    const it = detectIntent(frase);
    const busca = it.code ?? it.document ?? it.name;
    assert(`N: "${frase}" → intent ${it.type} com busca "${buscaEsperada}"`,
      (it.type === 'client_lookup' || it.type === 'client_switch') && busca === buscaEsperada,
      { type: it.type, busca });
  }
}

// ─── Resumo ───────────────────────────────────────────────────────────────────

console.log(`\n════════════════════════════════`);
console.log(`PASS: ${passed}  FAIL: ${failed}`);
console.log(`════════════════════════════════`);
if (failed > 0) process.exit(1);
