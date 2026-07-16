/**
 * test-maestro-frete-avulso.ts
 *
 * Script de testes e validação para cálculo de frete com CEP em orçamentos avulsos.
 * Executa os casos de teste mockando requisições ViaCEP e APIs de frete para evitar chamadas reais de rede.
 */

import { extrairCepDaQueryEstruturado } from './maestro-cep-resolver.server';
import { processSimpleQueryWithBrain } from './maestro-simple-engine';
import type { ConversationContext } from '../../types';

// Mock do fetch global do Node.js
const originalFetch = global.fetch;

function setupMocks() {
  global.fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof url === 'string' ? url : (url instanceof URL ? url.toString() : url.url);
    
    // Mock do ViaCEP
    if (urlStr.includes('viacep.com.br')) {
      if (urlStr.includes('96810400')) {
        return new Response(JSON.stringify({
          cep: "96810-400",
          localidade: "Santa Cruz do Sul",
          uf: "RS",
          bairro: "Centro"
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('90020021')) {
        return new Response(JSON.stringify({
          cep: "90020-021",
          localidade: "Porto Alegre",
          uf: "RS",
          bairro: "Centro"
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('00000000')) {
        // CEP Inexistente
        return new Response(JSON.stringify({ erro: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('99999999')) {
        // Timeout/Abort simulado
        throw new DOMException('The user aborted a request.', 'AbortError');
      }
    }

    // Fallback para outras requisições HTTP
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

function restoreMocks() {
  global.fetch = originalFetch;
}

// Funções de auxílio para simular o banco e ambiente
const mockSupabase = {
  from: (table: string) => {
    return {
      select: (fields: string) => {
        return {
          eq: (field: string, val: any) => {
            return {
              single: async () => ({ data: null, error: null }),
              limit: async () => ({ data: [], error: null }),
              maybeSingle: async () => ({ data: null, error: null }),
              order: () => ({ limit: async () => ({ data: [], error: null }) })
            };
          },
          ilike: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
          maybeSingle: async () => ({ data: null, error: null })
        };
      }
    };
  }
} as any;

const initialContext: ConversationContext = {


  v2ContextJson: '{}'
};

async function runTests() {
  console.log('🧪 Iniciando testes de Frete com CEP em Orçamento Avulso...\n');
  setupMocks();

  try {
    // -------------------------------------------------------------------------
    // Caso 1: Quantidade de 8 dígitos sem contexto de CEP ("20000000 triband")
    // -------------------------------------------------------------------------
    console.log('1. Testando "20000000 triband" (deve ignorar como CEP)');
    const match1 = extrairCepDaQueryEstruturado('20000000 triband');
    if (match1) {
      console.error('❌ Falha: extraiu CEP incorretamente de uma quantidade de 8 dígitos.');
    } else {
      console.log('✅ Sucesso: quantidade de 8 dígitos ignorada no extrator de CEP.');
    }

    // -------------------------------------------------------------------------
    // Caso 2: "2000 triband pra 96810400" (deve extrair CEP devido ao \'pra\')
    // -------------------------------------------------------------------------
    console.log('\n2. Testando "2000 triband pra 96810400" (deve casar CEP)');
    const match2 = extrairCepDaQueryEstruturado('2000 triband pra 96810400');
    if (match2 && match2.cep === '96810400') {
      console.log(`✅ Sucesso: CEP ${match2.cep} extraído. Texto casado: "${match2.rawText}"`);
    } else {
      console.error('❌ Falha: não identificou o CEP pra 96810400.');
    }

    // -------------------------------------------------------------------------
    // Caso 3: "produto 96810400" (sem marcador e sem pontuação -> ignora)
    // -------------------------------------------------------------------------
    console.log('\n3. Testando "produto 96810400" (deve ignorar)');
    const match3 = extrairCepDaQueryEstruturado('produto 96810400');
    if (match3) {
      console.error('❌ Falha: extraiu CEP de um número de 8 dígitos sem contexto de destino.');
    } else {
      console.log('✅ Sucesso: número sem preposição de destino ignorado corretamente.');
    }

    // -------------------------------------------------------------------------
    // Caso 4: "2000 triband para o cliente 96810400" (precedência de cliente)
    // -------------------------------------------------------------------------
    console.log('\n4. Testando "2000 triband para o cliente 96810400" (deve ignorar CEP)');
    const match4 = extrairCepDaQueryEstruturado('2000 triband para o cliente 96810400');
    if (match4) {
      console.error('❌ Falha: extraiu CEP onde o número pertencia ao cliente (id_cliente).');
    } else {
      console.log('✅ Sucesso: precedência de cliente respeitada (CEP ignorado).');
    }

    // -------------------------------------------------------------------------
    // Caso 5: Fluxo do motor com CEP Inexistente ("00000000")
    // -------------------------------------------------------------------------
    console.log('\n5. Testando ViaCEP com CEP Inexistente ("00000000")');
    process.env.MAESTRO_V2_ENABLED = 'true';
    process.env.MAESTRO_AVULSO_ENABLED = 'true';
    
    // Simula envio de orçamento com CEP inválido
    const resCepInexistente = await processSimpleQueryWithBrain(
      '2000 triband para o CEP 00000000',
      JSON.parse(JSON.stringify(initialContext)),
      { supabase: mockSupabase, userName: 'Everton', userId: 'user-123' }
    );

    if (resCepInexistente.message.content.includes('não foi localizado') && resCepInexistente.message.content.includes('digitou o CEP correto')) {
      console.log('✅ Sucesso: o motor interceptou e respondeu de forma objetiva sobre o CEP inexistente.');
    } else {
      console.error('❌ Falha: motor não alertou corretamente sobre CEP inexistente. Resposta obtida:', resCepInexistente.message.content);
    }

    // -------------------------------------------------------------------------
    // Caso 6: Timeout do ViaCEP ("99999999")
    // -------------------------------------------------------------------------
    console.log('\n6. Testando indisponibilidade/timeout do ViaCEP ("99999999")');
    const resTimeout = await processSimpleQueryWithBrain(
      '2000 triband para o CEP 99999999',
      JSON.parse(JSON.stringify(initialContext)),
      { supabase: mockSupabase, userName: 'Everton', userId: 'user-123' }
    );

    if (resTimeout.message.content.includes('Não foi possível consultar') && resTimeout.message.content.includes('Timeout na consulta do CEP')) {
      console.log('✅ Sucesso: motor indicou indisponibilidade temporária sem reportar o CEP como inválido.');
    } else {
      console.error('❌ Falha: motor não tratou a indisponibilidade de CEP corretamente. Resposta obtida:', resTimeout.message.content);
    }

    // -------------------------------------------------------------------------
    // Caso 7: Troca de CEP durante a cotação
    // -------------------------------------------------------------------------
    console.log('\n7. Testando troca de CEP na conversa');
    // 1º turno com CEP 96810400
    const resTurno1 = await processSimpleQueryWithBrain(
      '2000 triband para o CEP 96810400',
      JSON.parse(JSON.stringify(initialContext)),
      { supabase: mockSupabase, userName: 'Everton', userId: 'user-123' }
    );

    // 2º turno informando outro CEP
    const resTurno2 = await processSimpleQueryWithBrain(
      'muda para o CEP 90020021',
      resTurno1.context,
      { supabase: mockSupabase, userName: 'Everton', userId: 'user-123' }
    );

    const v2ContextFinal = JSON.parse(resTurno2.context.v2ContextJson || '{}');
    if (v2ContextFinal.budgetAddressCep === '90020021' && v2ContextFinal.budgetAddressCidade === 'Porto Alegre') {
      console.log('✅ Sucesso: o CEP anterior foi limpo e o novo CEP 90020021 foi resolvido para Porto Alegre.');
    } else {
      console.error('❌ Falha: o CEP não foi alterado corretamente. Contexto final:', v2ContextFinal);
    }

  } catch (err) {
    console.error('💥 Exceção ocorrida durante a execução dos testes:', err);
  } finally {
    restoreMocks();
    console.log('\n🏁 Testes finalizados.');
  }
}

runTests();
