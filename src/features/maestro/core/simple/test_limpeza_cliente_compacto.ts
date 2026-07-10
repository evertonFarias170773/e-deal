import assert from 'assert';
import { getEmptyV2Context, handleContextContinuation, serializeV2Context, deserializeV2Context } from './maestro-v2-context-manager';
import { routeToolSimple } from './maestro-v2-router';
import { processSimpleQueryWithBrain } from './maestro-simple-engine';
import { processarOrcamentoAvulso } from './maestro-orcamento-engine';
import type { SimpleMaestroContext } from './maestro-simple-context';
import type { SupabaseClient } from '@supabase/supabase-js';

// Setup environment variables before imports/requires
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake-supabase-url.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fake-supabase-anon-key';

import { getSupabaseClient } from '@/lib/supabase/client';

process.env.MAESTRO_AVULSO_ENABLED = 'true';
process.env.MAESTRO_V2_ENABLED = 'true';

// Mock catalog products
const CATALOGO = [
  {
    id_produto: 101,
    descricao: 'Pulseira Triband Sintética',
    apelidos: 'triband, tri band, tri',
    valorUnt: 1.25,
    valorFixo: 0,
    ativo: true,
  },
  {
    id_produto: 402,
    descricao: 'Ingresso UP BOX do marketing',
    apelidos: 'up box, up, upbox',
    valorUnt: 1.85,
    valorFixo: 0,
    ativo: true,
  }
];

// Mock clients
const CLIENTE_14 = {
  clientInternalId: 14,
  clientDisplayCode: '14',
  clientName: 'Edison Santos De Farias Junior',
};

const CLIENTE_8469 = {
  clientInternalId: 8469,
  clientDisplayCode: '8469',
  clientName: 'LISITON DOCUMENTOS SEGUROS LTDA',
};

// Mock addresses
const ENDERECOS = [
  {
    id: 'addr-14-1',
    id_cliente: 14,
    tipo_endereco: 'principal',
    cep: '90660130',
    endereco: 'Rua Felizardo de Farias, 1000',
    numero: '1000',
    complemento: '',
    bairro: 'Medianeira',
    cidade: 'Porto Alegre',
    uf: 'RS'
  },
  {
    id: 'addr-8469-1',
    id_cliente: 8469,
    tipo_endereco: 'principal',
    cep: '95474110',
    endereco: 'Rua Jacaranda, 35580',
    numero: '35580',
    complemento: '',
    bairro: 'Condominio Querencia',
    cidade: 'Viamo',
    uf: 'RS'
  },
  {
    id: 'addr-8469-2',
    id_cliente: 8469,
    tipo_endereco: 'entrega',
    cep: '90660130',
    endereco: 'Rua Felizardo de Farias, 81',
    numero: '81',
    complemento: '',
    bairro: 'Medianeira',
    cidade: 'Porto Alegre',
    uf: 'RS'
  }
];

// Helper custom mock Supabase
function criarCustomSupabaseMock(): any {
  return {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'user-123' } } }, error: null }),
      getUser: () => Promise.resolve({ data: { user: { id: 'user-123' } }, error: null })
    },
    from: (tabela: string) => {
      let filtros: Array<(x: any) => boolean> = [];
      let limiteMax = 1000;
      let isSingle = false;

      const chain: any = {
        select: (_cols: string) => chain,
        eq: (campo: string, valor: any) => {
          filtros.push(x => x[campo] === valor || String(x[campo]) === String(valor));
          return chain;
        },
        ilike: (campo: string, padrao: string) => {
          const termoLower = padrao.replace(/%/g, '').toLowerCase();
          filtros.push(x => {
            const val = (x[campo] ?? '').toLowerCase();
            return val.includes(termoLower);
          });
          return chain;
        },
        order: () => chain,
        limit: (n: number) => {
          limiteMax = n;
          return chain;
        },
        single: () => {
          isSingle = true;
          return chain;
        },
        maybeSingle: () => {
          isSingle = true;
          return chain;
        },
        insert: (data: any) => {
          return chain;
        },
        update: (data: any) => {
          return chain;
        },
        delete: () => {
          return chain;
        },
        then: (resolve: (v: { data: any; error: any }) => void, reject?: any) => {
          let list: any[] = [];
          if (tabela === 'produtos') {
            list = CATALOGO;
          } else if (tabela === 'vw_cadastros_clientes_lista') {
            list = [
              { id_cliente: 14, id_cliente_text: '14', nome: CLIENTE_14.clientName, busca_geral: '14 edison farias', ativo: true },
              { id_cliente: 8469, id_cliente_text: '8469', nome: CLIENTE_8469.clientName, busca_geral: '8469 lisiton', ativo: true }
            ];
          } else if (tabela === 'enderecos') {
            list = ENDERECOS;
          } else if (tabela === 'clientes') {
            list = [
              { id_cliente: 14, nome: CLIENTE_14.clientName, fantasia: '', documento: '', cidade_uf: 'RS', percentual_bunus: 0, is_bonus: false, ativo: true },
              { id_cliente: 8469, nome: CLIENTE_8469.clientName, fantasia: '', documento: '', cidade_uf: 'RS', percentual_bunus: 0, is_bonus: false, ativo: true }
            ];
          } else if (tabela === 'contatos') {
            list = [
              { id: 1001, id_cliente: 14, nome: 'Contato Edison 1' },
              { id: 2002, id_cliente: 8469, nome: 'Contato Lisiton 1' }
            ];
          } else if (tabela === 'usuarios') {
            list = [
              { user_id: 'user-123', nome_usuario: 'Everton Farias' }
            ];
          } else if (tabela === 'clientes_socios') {
            list = [];
          } else if (['propostas', 'produtos_proposta', 'cotacao_frete', 'pedidos_modelos'].includes(tabela)) {
            const res = isSingle ? { id_int: 9999, id: 9999 } : [{ id_int: 9999, id: 9999 }];
            isSingle = false;
            filtros = [];
            return Promise.resolve({ data: res, error: null }).then(resolve, reject);
          }

          const filtered = list.filter(x => filtros.every(f => f(x)));
          const resultado = isSingle ? filtered[0] || null : filtered.slice(0, limiteMax);
          isSingle = false;
          filtros = [];
          return Promise.resolve({ data: resultado, error: null }).then(resolve, reject);
        }
      };

      return chain;
    }
  };
}

const supabase = criarCustomSupabaseMock() as unknown as SupabaseClient;

const realClient = getSupabaseClient();
if (realClient) {
  realClient.from = supabase.from;
  // @ts-ignore
  realClient.auth = supabase.auth;
}

async function run() {
  console.log('=== INICIANDO TESTES DE LIMPEZA DE CLIENTE E COMANDO COMPACTO ===\n');

  // Teste 1: Comando compacto multi-item parsing
  console.log('--- Teste 1: Parsing de "cli 14 1200 triband 550 up" ---');
  {
    const editResult = processarOrcamentoAvulso('cli 14 1200 triband 550 up', { itens: [], pendingAmbiguity: false });
    console.log('Itens extraídos:', JSON.stringify(editResult.items));
    assert.strictEqual(editResult.items.length, 2, 'Deveria extrair 2 itens');
    assert.strictEqual(editResult.items[0].quantidade, 1200, 'Quantidade do item 1 incorreta');
    assert.strictEqual(editResult.items[0].termo, 'triband', 'Termo do item 1 incorreto');
    assert.strictEqual(editResult.items[1].quantidade, 550, 'Quantidade do item 2 incorreta');
    assert.strictEqual(editResult.items[1].termo, 'up', 'Termo do item 2 incorreto');
    console.log('✓ Teste 1 passou!\n');
  }

  // Teste 2: Sincronização de cliente e limpeza de estado no handleContextContinuation
  console.log('--- Teste 2: Limpeza ao trocar de cliente ativo via activeClient da sessão ---');
  {
    const v2Ctx = getEmptyV2Context();
    v2Ctx.activeEntities = {
      clientInternalId: 14,
      clientName: CLIENTE_14.clientName,
      clientId: '14'
    };
    v2Ctx.budgetAddressId = 'addr-14-1';
    v2Ctx.budgetAddressFull = 'Rua Felizardo de Farias, 1000';
    v2Ctx.activeQuote = {
      clientId: 14,
      itens: [{ id_produto: 101, nome: 'Pulseira Triband Sintética', quantidade: 1200, valorUnitario: 1.25, subtotal: 1500, status: 'sucesso', pesoUnitario: 1 }],
      fretes: [],
      freteSelecionado: { id: 'frete-1', transportadora: 'Correios', valor: 20, prazoDias: 2 },
      subtotal: 1500,
      total: 1520,
      pesoTotalGramas: 1200,
      timestamp: new Date().toISOString()
    } as any;
    v2Ctx.pendingSaveQuotation = {
      cliente: CLIENTE_14 as any,
      itens: [],
      freteEscolhido: {} as any,
      subtotal: 1500,
      total: 1520,
      pesoTotalGramas: 1200,
      timestamp: ''
    } as any;

    // Agora o activeClient na sessão muda para 8469
    const continuation = handleContextContinuation('bom dia', v2Ctx, CLIENTE_8469);
    
    assert.strictEqual(v2Ctx.activeEntities.clientInternalId, 8469, 'Deveria sincronizar o clientInternalId para 8469');
    assert.strictEqual(v2Ctx.activeQuote, null, 'activeQuote deveria ser limpo');
    assert.strictEqual(v2Ctx.pendingSaveQuotation, null, 'pendingSaveQuotation deveria ser limpo');
    assert.strictEqual(v2Ctx.budgetAddressId, undefined, 'budgetAddressId deveria ser limpo');
    assert.strictEqual(v2Ctx.budgetAddressFull, undefined, 'budgetAddressFull deveria ser limpo');
    console.log('✓ Teste 2 passou!\n');
  }

  // Teste 3: Mudança de cliente via busca e não contaminação de cotação anterior no engine
  console.log('--- Teste 3: Mudança de cliente via busca e limpeza no engine ---');
  {
    const v2Ctx = getEmptyV2Context();
    v2Ctx.activeEntities = {
      clientInternalId: 14,
      clientName: CLIENTE_14.clientName,
      clientId: '14'
    };
    v2Ctx.budgetAddressId = 'addr-14-1';
    v2Ctx.budgetAddressFull = 'Rua Felizardo de Farias, 1000';
    v2Ctx.activeQuote = {
      clientId: 14,
      itens: [{ id_produto: 101, nome: 'Pulseira Triband Sintética', quantidade: 1200, valorUnitario: 1.25, subtotal: 1500, status: 'sucesso', pesoUnitario: 1 }],
      fretes: [],
      freteSelecionado: { id: 'frete-1', transportadora: 'Correios', valor: 20, prazoDias: 2 },
      subtotal: 1500,
      total: 1520,
      pesoTotalGramas: 1200,
      timestamp: new Date().toISOString()
    } as any;

    const legacyCtx = {
      v2ContextJson: serializeV2Context(v2Ctx)
    };

    // O usuário diz "sobre o cliente 8469"
    // Isso deve desencadear a busca pelo cliente 8469
    const response = await processSimpleQueryWithBrain('sobre o cliente 8469', legacyCtx, { supabase });
    
    const nextV2Ctx = deserializeV2Context(response.context.v2ContextJson);

    assert.strictEqual(nextV2Ctx.activeEntities.clientInternalId, 8469, 'Deveria atualizar o clientInternalId no contexto para 8469');
    assert.strictEqual(nextV2Ctx.activeQuote, null, 'activeQuote deveria ser limpo no engine ao trocar de cliente');
    assert.strictEqual(nextV2Ctx.budgetAddressId, undefined, 'budgetAddressId deveria ser limpo no engine');
    assert.strictEqual(nextV2Ctx.budgetAddressFull, undefined, 'budgetAddressFull deveria ser limpo no engine');
    console.log('✓ Teste 3 passou!\n');
  }

  // Teste 4: Nome comercial oficial no presenter
  console.log('--- Teste 4: Nome comercial preferido para UP BOX ---');
  {
    const v2Ctx = getEmptyV2Context();
    v2Ctx.activeEntities = {
      clientInternalId: 8469,
      clientName: CLIENTE_8469.clientName,
      clientId: '8469'
    };
    v2Ctx.budgetAddressId = 'addr-8469-1';
    v2Ctx.budgetAddressFull = 'Rua Jacaranda, 35580';
    v2Ctx.budgetAddressCep = '95474110';

    const legacyCtx = {
      v2ContextJson: serializeV2Context(v2Ctx)
    };

    // Simula orçamento de "550 up" para o cliente ativo
    const response = await processSimpleQueryWithBrain('cota 550 up', legacyCtx, { supabase });
    console.log('Mensagem de resposta:', response.message.content);
    assert.ok(response.message.content.includes('Ingresso UP BOX'), 'Deveria usar o nome comercial oficial "Ingresso UP BOX"');
    assert.ok(!response.message.content.includes('UP BOX do marketing'), 'Não deveria exibir descrição de marketing longa do banco');
    console.log('✓ Teste 4 passou!\n');
  }
  
  // Teste 5: Escolha numérica de endereço pendente
  console.log('--- Teste 5: Escolha de endereço por resposta numérica ---');
  {
    const v2Ctx = getEmptyV2Context();
    v2Ctx.activeEntities = {
      clientInternalId: 8469,
      clientName: CLIENTE_8469.clientName,
      clientId: '8469'
    };
    v2Ctx.orcamentoItens = [{ quantidade: 1200, termo: 'triband' }];
    v2Ctx.pendingAddressChoice = {
      clientId: 8469,
      addresses: [
        ENDERECOS[1], // addr-8469-1
        ENDERECOS[2]  // addr-8469-2
      ]
    };

    const legacyCtx = {
      v2ContextJson: serializeV2Context(v2Ctx)
    };

    // Usuário responde "2" para escolher o segundo endereço
    const response = await processSimpleQueryWithBrain('2', legacyCtx, { supabase });
    const nextV2Ctx = deserializeV2Context(response.context.v2ContextJson);

    assert.strictEqual(nextV2Ctx.pendingAddressChoice, null, 'Deveria limpar pendingAddressChoice após escolha');
    assert.strictEqual(nextV2Ctx.budgetAddressId, 'addr-8469-2', 'Deveria selecionar o segundo endereço (addr-8469-2)');
    assert.ok(!response.message.content.includes('Tenho o cliente LISITON DOCUMENTOS SEGUROS LTDA ativo'), 'Não deveria responder com conversa genérica de cliente ativo');
    console.log('✓ Teste 5 passou!\n');
  }

  // Teste 6: Escolha de frete por resposta numérica
  console.log('--- Teste 6: Escolha de frete por resposta numérica ---');
  {
    const v2Ctx = getEmptyV2Context();
    v2Ctx.activeEntities = {
      clientInternalId: 8469,
      clientName: CLIENTE_8469.clientName,
      clientId: '8469'
    };
    v2Ctx.budgetAddressId = 'addr-8469-1';
    v2Ctx.activeQuote = {
      clientId: 8469,
      itens: [{ id_produto: 101, nome: 'Pulseira Triband Sintética', quantidade: 1200, valorUnitario: 1.25, subtotal: 1500, status: 'sucesso', pesoUnitario: 1 }],
      fretes: [
        { id: 'f-1', transportadora: 'Correios SEDEX', valor: 25, prazoDias: 2 },
        { id: 'f-2', transportadora: 'Azul Cargo', valor: 35, prazoDias: 3 }
      ],
      subtotal: 1500,
      total: 1500,
      pesoTotalGramas: 1200,
      timestamp: new Date().toISOString()
    } as any;
    v2Ctx.pendingFreightChoice = {
      clientInternalId: 8469,
      clientName: CLIENTE_8469.clientName,
      enderecoFull: 'Rua Jacaranda, 35580',
      cidade: 'Viamo',
      uf: 'RS',
      itens: [{ id_produto: 101, nome: 'Pulseira Triband Sintética', quantidade: 1200, valorUnitario: 1.25, valorFixo: 0, subtotal: 1500, pesoUnitario: 1 }],
      subtotal: 1500,
      pesoTotalGramas: 1200,
      fretes: [
        { id: 'f-1', servico: 'SEDEX', transportadora: 'Correios SEDEX', valor: 25, prazo: '2 dias' },
        { id: 'f-2', servico: 'Azul Cargo', transportadora: 'Azul Cargo', valor: 35, prazo: '3 dias' }
      ]
    };

    const legacyCtx = {
      v2ContextJson: serializeV2Context(v2Ctx)
    };

    // Usuário responde "1" para escolher o primeiro frete
    const response = await processSimpleQueryWithBrain('1', legacyCtx, { supabase });
    const nextV2Ctx = deserializeV2Context(response.context.v2ContextJson);

    assert.strictEqual(nextV2Ctx.pendingFreightChoice, null, 'Deveria limpar pendingFreightChoice após escolha');
    assert.strictEqual(nextV2Ctx.activeQuote?.freteSelecionado?.id, 'f-1', 'Deveria selecionar o frete f-1');
    assert.strictEqual(nextV2Ctx.activeQuote?.freteSelecionado?.transportadora, 'Correios SEDEX', 'Deveria preencher transportadora corretamente');
    console.log('✓ Teste 6 passou!\n');
  }

  // Teste 7: Confirmação de salvar proposta (ok vs sim)
  console.log('--- Teste 7: Confirmação de salvar proposta (ok vs sim) ---');
  {
    // Cenário A: Responde "ok" (não deve salvar)
    {
      const v2Ctx = getEmptyV2Context();
      v2Ctx.activeEntities = {
        clientInternalId: 8469,
        clientName: CLIENTE_8469.clientName,
        clientId: '8469'
      };
      v2Ctx.pendingSaveQuotation = {
        clientInternalId: 8469,
        clientName: CLIENTE_8469.clientName,
        contatoId: 'contato-99',
        enderecoId: 'addr-8469-1',
        enderecoFull: 'Rua Jacaranda, 35580',
        cep: '95474110',
        cidade: 'Viamo',
        uf: 'RS',
        itens: [{ id_produto: 101, nome: 'Pulseira Triband Sintética', quantidade: 1200, valorUnitario: 1.25, valorFixo: 0, subtotal: 1500, pesoUnitario: 1 }],
        freteEscolhido: { id: 'f-1', servico: 'SEDEX', transportadora: 'Correios SEDEX', valor: 25, prazo: '2 dias', pesoUsado: 1200 },
        subtotalProdutos: 1500,
        total: 1525,
        pesoTotalGramas: 1200,
        status: 'nao_salva',
        timestamp: new Date().toISOString()
      } as any;

      const legacyCtx = {
        v2ContextJson: serializeV2Context(v2Ctx)
      };

      const response = await processSimpleQueryWithBrain('ok', legacyCtx, { supabase });
      const nextV2Ctx = deserializeV2Context(response.context.v2ContextJson);

      assert.ok(nextV2Ctx.pendingSaveQuotation !== null, 'pendingSaveQuotation não deveria ser nulo com "ok"');
      assert.strictEqual(nextV2Ctx.pendingSaveQuotation?.savedIdInt, undefined, 'A proposta não deveria ser salva com "ok"');
      console.log('✓ Teste 7 (Parte A - ok) passou!');
    }

    // Cenário B: Responde "sim" (deve salvar)
    {
      const v2Ctx = getEmptyV2Context();
      v2Ctx.activeEntities = {
        clientInternalId: 8469,
        clientName: CLIENTE_8469.clientName,
        clientId: '8469'
      };
      v2Ctx.pendingSaveQuotation = {
        clientInternalId: 8469,
        clientName: CLIENTE_8469.clientName,
        contatoId: 'contato-99',
        enderecoId: 'addr-8469-1',
        enderecoFull: 'Rua Jacaranda, 35580',
        cep: '95474110',
        cidade: 'Viamo',
        uf: 'RS',
        itens: [{ id_produto: 101, nome: 'Pulseira Triband Sintética', quantidade: 1200, valorUnitario: 1.25, valorFixo: 0, subtotal: 1500, pesoUnitario: 1 }],
        freteEscolhido: { id: 'f-1', servico: 'SEDEX', transportadora: 'Correios SEDEX', valor: 25, prazo: '2 dias', pesoUsado: 1200 },
        subtotalProdutos: 1500,
        total: 1525,
        pesoTotalGramas: 1200,
        status: 'nao_salva',
        timestamp: new Date().toISOString()
      } as any;

      const legacyCtx = {
        v2ContextJson: serializeV2Context(v2Ctx)
      };

      const response = await processSimpleQueryWithBrain('sim', legacyCtx, { supabase, userId: 'user-123' });
      const nextV2Ctx = deserializeV2Context(response.context.v2ContextJson);

      assert.ok(nextV2Ctx.pendingSaveQuotation !== null, 'pendingSaveQuotation deve existir');
      assert.strictEqual(nextV2Ctx.pendingSaveQuotation?.savedIdInt, 9999, 'A proposta deveria ter savedIdInt = 9999');
      assert.ok(response.message.content.includes('Proposta criada com sucesso!'), 'Deveria exibir mensagem de sucesso no salvamento');
      console.log('✓ Teste 7 (Parte B - sim) passou!\n');
    }
  }

  console.log('========================================');
  console.log('TODOS OS TESTES PASSARAM COM SUCESSO! ✅');
}

run().catch(err => {
  console.error('\n❌ TESTE FALHOU:', err);
  process.exit(1);
});
