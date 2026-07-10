import { processSimpleQuery } from './maestro-simple-engine';
import { getEmptyV2Context } from './maestro-v2-context-manager';
import type { ConversationContext } from '../../types';
import { criarSupabaseMock } from './maestro-orcamento-resolver.server';

async function runTest() {
  console.log('=== Teste de Sobrevivência do Bônus entre Turnos ===');

  const supabaseMock = criarSupabaseMock([
    { id_produto: 101, descricao: 'PULSEIRA TRIBAND SINTETICA', apelidos: 'triband, tri, tyvek, pulseira triband', valorUnt: 0.16, valorFixo: 0, ativo: true },
  ]);

  // Turno 1: Cliente encontado e itens preservados. (Simula o estado logo após `buscarCliente`)
  // O ConversationContext inicial (antes do motor processar) já deve conter o cliente (o que simulamos aqui, como se o fluxo recém tivesse voltado do frontend)
  const legacyCtx: ConversationContext = {
    clientDisplayCode: '8469',
    clientInternalId: 8469,
    clientName: 'LISITON',
    clientIsBonus: true,
    clientPercentualBonus: 8,
    v2ContextJson: JSON.stringify({
      ...getEmptyV2Context(),
      domain: 'orcamento_avulso',
      orcamentoItens: [{ quantidade: 3450, termo: 'triband' }],
      activeEntities: { clientInternalId: 8469, clientName: 'LISITON', clientId: '8469' }
    }),
  };

  // Vamos disparar uma query simulando o comando de frete "4" (Retira no balcão)
  const res = await processSimpleQuery('4', legacyCtx, { supabase: supabaseMock });

  const returnedLegacyCtx = res.context;
  
  if (returnedLegacyCtx.clientIsBonus === true && returnedLegacyCtx.clientPercentualBonus === 8) {
    console.log('  OK Bônus sobreviveu no contexto de retorno!');
  } else {
    console.error('  FAIL Bônus perdido no contexto de retorno!', { isBonus: returnedLegacyCtx.clientIsBonus, percentualBonus: returnedLegacyCtx.clientPercentualBonus });
  }

  // Verificar se o pendingSaveQuotation aplicou o bonus corretamente
  const v2CtxOut = JSON.parse(returnedLegacyCtx.v2ContextJson || '{}');
  if (v2CtxOut.pendingSaveQuotation) {
    const psq = v2CtxOut.pendingSaveQuotation;
    if (psq.percentualBonus === 8) {
      console.log('  OK pendingSaveQuotation aplicou percentual de 8%!');
    } else {
      console.error('  FAIL pendingSaveQuotation sem bonus!', psq.percentualBonus);
    }
  } else if (v2CtxOut.pendingFreightChoice) {
    const pfc = v2CtxOut.pendingFreightChoice;
    if (pfc.percentualBonus === 8) {
      console.log('  OK pendingFreightChoice aplicou percentual de 8%!');
      console.log(`     Subtotal: R$ ${pfc.subtotal}`);
      console.log(`     Desconto: R$ ${pfc.descontoReais}`);
      console.log(`     Liquido: R$ ${pfc.subtotalLiquido}`);
    } else {
      console.error('  FAIL pendingFreightChoice sem bonus!', pfc.percentualBonus);
    }
  }
}

runTest();
