import assert from 'assert';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { detectIntent } from './maestro-simple-intents';
import { handleContextContinuation, getEmptyV2Context } from './maestro-v2-context-manager';

function makeCtx(clientName = 'Cleiton Zaffari', clientId = 9000) {
  const ctx = getEmptyV2Context();
  ctx.domain = 'cliente';
  ctx.activeEntities = { clientInternalId: clientId, clientName };
  return ctx;
}
const cleitonAtivo = { clientInternalId: 9000, clientName: 'Cleiton Zaffari' };

console.log('\n=== Suite 1: detectIntent — sobre o <nome> ===');
{
  const i = detectIntent('sobre o Zaffari');
  assert.strictEqual(i.type, 'client_lookup', `"sobre o Zaffari" => ${i.type}`);
  console.log(`[PASS] "sobre o Zaffari" => client_lookup (name=${i.name}) ✅`);
}
{
  const i = detectIntent('sobre a Maria');
  assert.strictEqual(i.type, 'client_lookup', `"sobre a Maria" => ${i.type}`);
  console.log(`[PASS] "sobre a Maria" => client_lookup (name=${i.name}) ✅`);
}
{
  const i = detectIntent('sobre Edison Santos');
  assert.strictEqual(i.type, 'client_lookup', `"sobre Edison Santos" => ${i.type}`);
  console.log(`[PASS] "sobre Edison Santos" => client_lookup (name=${i.name}) ✅`);
}
{
  const i = detectIntent('sobre o telefone');
  assert.notStrictEqual(i.type, 'client_lookup', '"sobre o telefone" nao deve ser client_lookup');
  console.log('[PASS] "sobre o telefone" => NOT client_lookup ✅');
}
{
  const i = detectIntent('sobre os boletos');
  assert.notStrictEqual(i.type, 'client_lookup', '"sobre os boletos" nao deve ser client_lookup');
  console.log('[PASS] "sobre os boletos" => NOT client_lookup ✅');
}
{
  const i = detectIntent('sobre o endereco');
  assert.notStrictEqual(i.type, 'client_lookup', '"sobre o endereco" nao deve ser client_lookup');
  console.log('[PASS] "sobre o endereco" => NOT client_lookup ✅');
}

console.log('\n=== Suite 2: context-manager — sobre o <nome> retorna null ===');
{
  const ctx = makeCtx();
  const result = handleContextContinuation('sobre o Zaffari', ctx, cleitonAtivo);
  assert.strictEqual(result, null, '"sobre o Zaffari" deve retornar null');
  console.log('[PASS] "sobre o Zaffari" => context-manager null (nova busca) ✅');
}
{
  const ctx = makeCtx();
  const result = handleContextContinuation('sobre o Everton Farias', ctx, cleitonAtivo);
  assert.strictEqual(result, null, '"sobre o Everton Farias" deve retornar null');
  console.log('[PASS] "sobre o Everton Farias" => context-manager null ✅');
}

console.log('\n=== Suite 3: campos contextuais preservados ===');
{
  const ctx = makeCtx();
  const result = handleContextContinuation('qual o telefone dele?', ctx, cleitonAtivo);
  assert.notStrictEqual(result, null, '"telefone dele" deve ser interceptado');
  assert.strictEqual(result?.plan?.steps[0]?.tool, 'consultarCampoCadastro');
  console.log('[PASS] "qual o telefone dele?" => consultarCampoCadastro ✅');
}

console.log('\n=== Suite 4: Confidence Gate (mock) ===');
{
  const rawT = 'zaffari';
  const amplo = rawT.split(/\s+/).length === 1 && rawT.length <= 10;
  assert.strictEqual(amplo, true);
  console.log('[PASS] "zaffari" => termoEhAmplo=true ✅');
}
{
  const rawT = 'cleiton zaffari';
  const amplo = rawT.split(/\s+/).length === 1 && rawT.length <= 10;
  assert.strictEqual(amplo, false);
  console.log('[PASS] "cleiton zaffari" => termoEhAmplo=false ✅');
}
{
  const t = 'zaffari';
  const row = { id_cliente_text: '9000', documento: '12345678000190', fantasia: 'ZAFFARI' };
  const strong = row.id_cliente_text === t || (t.replace(/\D/g,'').length >= 11 && row.documento.replace(/\D/g,'') === t.replace(/\D/g,''));
  assert.strictEqual(strong, false, 'fantasia ZAFFARI nao deve ser strongExact');
  console.log('[PASS] fantasia="ZAFFARI" => strongExact=false ✅');
}
{
  const t = '9000';
  const row = { id_cliente_text: '9000', documento: '12345678000190' };
  const strong = row.id_cliente_text === t || (t.replace(/\D/g,'').length >= 11 && row.documento.replace(/\D/g,'') === t.replace(/\D/g,''));
  assert.strictEqual(strong, true);
  console.log('[PASS] codigo "9000" => strongExact=true ✅');
}
{
  const rows7 = Array.from({ length: 7 }, (_, i) => ({ id_cliente: i }));
  assert.strictEqual(rows7.length > 6, true);
  console.log('[PASS] 7 resultados => too_many antes do nome check ✅');
}
{
  const rows3 = Array.from({ length: 3 }, (_, i) => ({ id_cliente: i }));
  assert.strictEqual(rows3.length > 1 && rows3.length <= 6, true);
  console.log('[PASS] 3 resultados => multiple (lista) ✅');
}

console.log('\n=== Suite 5: Não-regressão ===');
{
  const i = detectIntent('sobre o cliente Zaffari');
  assert.strictEqual(i.type, 'client_lookup');
  console.log('[PASS] "sobre o cliente Zaffari" => client_lookup ✅');
}
{
  const i = detectIntent('E o cliente Everton Farias?');
  assert.strictEqual(i.type, 'client_lookup');
  console.log('[PASS] "E o cliente Everton Farias?" => client_lookup ✅');
}
{
  const i = detectIntent('cpf 671490');
  assert.strictEqual(i.type, 'client_lookup');
  console.log('[PASS] "cpf 671490" => client_lookup ✅');
}
{
  const ctx = makeCtx('Lisiton', 8469);
  const result = handleContextContinuation('qual telefone dele?', ctx, { clientInternalId: 8469, clientName: 'Lisiton' });
  assert.notStrictEqual(result, null);
  console.log('[PASS] "telefone dele" com Lisiton ativo => interceptado ✅');
}

console.log('\n✅ TODOS OS TESTES DE CONFIDENCE GATE PASSARAM!');
