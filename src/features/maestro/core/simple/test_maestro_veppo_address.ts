/**
 * test_maestro_veppo_address.ts
 *
 * Testes integrados para validar:
 * 1. Seleção automática de endereço único utilizável (com cotação pendente)
 * 2. Desvio correto para múltiplos endereços ou manual (se 0)
 * 3. Integração com a transportadora VEPPO
 * 4. Limpeza de preposição de cliente no roteador
 *
 * Para rodar: npx tsx src/features/maestro/core/simple/test_maestro_veppo_address.ts
 */

import fs from 'fs';
import path from 'path';

// Carrega .env.local se existir para alimentar o Supabase Client
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
        if (key && value) {
          process.env[key] = value;
        }
      }
    });
  }
} catch (e) {
  console.warn('Falha ao ler .env.local:', e);
}

// Mock do fetch global para simular APIs de frete de forma determinística
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (url: any, options: any) {
  const urlStr = String(url);
  if (urlStr.includes('10074.hostoo.net.br/webhook/coordenadas')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ valor_frete: 44.95, prazo: 'Sob consulta' })
    } as any;
  }
  // Se for simulador de Correios ou outros endpoints externos do frete.service
  if (urlStr.includes('ws.correios.com.br') || urlStr.includes('correios') || urlStr.includes('calculadorafrete')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        // Mock de resposta dos Correios se necessário
        valor: '24.46',
        prazo: '1'
      }),
      text: async () => `<?xml version="1.0" encoding="utf-8"?><Servicos><cServico><Codigo>04014</Codigo><Valor>24,46</Valor><PrazoEntrega>1</PrazoEntrega><Erro>0</Erro></cServico></Servicos>`
    } as any;
  }
  return originalFetch(url, options);
};

import { processSimpleQueryWithBrain } from './maestro-simple-engine';
import { getEmptyV2Context, serializeV2Context } from './maestro-v2-context-manager';
import { extrairClienteDaQuery } from './maestro-v2-router';
import { createClient } from '@supabase/supabase-js';
import type { ConversationContext } from '../../types';

process.env.MAESTRO_V2_ENABLED = 'true';
process.env.MAESTRO_AVULSO_ENABLED = 'true';
process.env.MAESTRO_SIMPLE_LLM_ENABLED = 'false'; // Desliga humanização do Brain para testar presenters determinísticos

// Inicializa cliente Supabase real usando as credenciais do ambiente
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const mockCatalogo = [
  {
    id_produto: 101,
    descricao: 'PULSEIRA TRIBAND ACESSO',
    apelidos: 'triband, pulseira triband, tri',
    valorUnt: 1.25,
    valorFixo: 0,
    peso: 1.02, // Peso em gramas
    ativo: true
  }
];

const mockClientes = [
  { id_cliente: 8469, id_cliente_text: 'CLI8469', nome: 'LISITON DOCUMENTOS SEGUROS LTDA', fantasia: 'Lisiton', documento: '12345678901', cidade_uf: 'Santa Cruz do Sul/RS', busca_geral: 'lisiton documentos seguros ltda cli8469', ativo: true }
];

// Mock Supabase flexível
function criarSupabaseMockFlexivel(catalogo: any[], clientes: any[], enderecos: any[]) {
  return {
    from: (tabela: string) => {
      let filtros: Array<(x: any) => boolean> = [];
      let limiteMax = 1000;
      let isSingle = false;
      let targetCollection = tabela === 'produtos' ? catalogo
                           : tabela === 'vw_cadastros_clientes_lista' ? clientes
                           : tabela === 'enderecos' ? enderecos
                           : tabela === 'cadastros' ? clientes
                           : [];

      const chain: any = {
        select: (_cols: string) => chain,
        eq: (campo: string, valor: any) => {
          filtros.push(x => (x as any)[campo] === valor || String((x as any)[campo]) === String(valor));
          return chain;
        },
        ilike: (campo: string, padrao: string) => {
          const termoLower = padrao.replace(/%/g, '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          filtros.push(x => {
            const val = String((x as any)[campo] ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
        then: (resolve: any, reject: any) => {
          const filtrados = targetCollection.filter(x => filtros.every(f => f(x)));
          const resultado = isSingle ? (filtrados[0] ?? null) : filtrados.slice(0, limiteMax);
          const val = { data: resultado, error: null };
          return Promise.resolve(val).then(resolve, reject);
        }
      };

      chain.then = (resolve: any, reject: any) => {
        const filtrados = targetCollection.filter(x => filtros.every(f => f(x)));
        const resultado = isSingle ? (filtrados[0] ?? null) : filtrados.slice(0, limiteMax);
        const val = { data: resultado, error: null };
        return Promise.resolve(val).then(resolve, reject);
      };
      
      return chain;
    }
  } as any;
}

let passed = 0;
let failed = 0;

function assert(label: string, ok: boolean, detalhe?: string) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    if (detalhe) console.error(`    Detalhe: ${detalhe}`);
    failed++;
  }
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   Testes Maestro — Integração VEPPO e Seleção de Endereço    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Teste 0: Limpeza de preposição no roteador
  console.log('--- Teste 0: Extração de nome de cliente com preposição final ---');
  {
    const res = extrairClienteDaQuery('Orçamento para Lisiton de 1000 Triband');
    assert('Deve limpar o "de" final no nome', res?.valor === 'lisiton');
  }

  // Cenário 1: Cliente com nenhum endereço utilizável
  console.log('\n--- Cenário 1: Cliente com nenhum endereço utilizável (0 válidos) ---');
  {
    // Endereços inválidos (sem CEP ou sem Cidade/UF)
    const mockEnderecos = [
      { id: 901, id_cliente: 8469, cep: '', endereco: 'Av Sem CEP', numero: '100', complemento: '', bairro: 'Centro', cidade: '', uf: '' }
    ];
    const supabase = criarSupabaseMockFlexivel(mockCatalogo, mockClientes, mockEnderecos);

    const legacyCtx: ConversationContext = {
      v2ContextJson: serializeV2Context(getEmptyV2Context()),


    };

    const result = await processSimpleQueryWithBrain(
      'Orçamento para o cliente 8469, 1000 Triband',
      legacyCtx,
      { supabase, userName: 'Everton', userId: 'usr-123' }
    );

    console.log('DEBUG RESPOSTA C1:', result.message.content);
    const v2CtxFinal = getEmptyV2Context();
    Object.assign(v2CtxFinal, JSON.parse(result.context.v2ContextJson || '{}'));
    console.log('DEBUG CTX C1:', JSON.stringify(v2CtxFinal, null, 2));

    assert('Deve redirecionar para solicitação manual de endereço', 
      result.message.content.includes('Por favor, me informe o endereço') || 
      result.message.content.includes('solicitarEnderecoManual') || 
      result.message.content.includes('cep') ||
      result.message.content.includes('CEP')
    );
  }

  // Cenário 2: Cliente com exatamente 1 endereço válido
  console.log('\n--- Cenário 2: Cliente com exatamente 1 endereço válido (com cotação automática) ---');
  {
    // Exatamente 1 endereço utilizável com CEP/Cidade/UF no Rio Grande do Sul (Santa Cruz do Sul)
    const mockEnderecos = [
      { id: 902, id_cliente: 8469, cep: '96810-400', endereco: 'Travessa Canoas', numero: '39', complemento: 'Casa', bairro: 'Centro', cidade: 'Santa Cruz do Sul', uf: 'RS' }
    ];
    const supabase = criarSupabaseMockFlexivel(mockCatalogo, mockClientes, mockEnderecos);

    const legacyCtx: ConversationContext = {
      v2ContextJson: serializeV2Context(getEmptyV2Context()),


    };

    const result = await processSimpleQueryWithBrain(
      'Orçamento para o cliente 8469, 1000 Triband',
      legacyCtx,
      { supabase, userName: 'Everton', userId: 'usr-123' }
    );

    console.log('DEBUG RESPOSTA C2:', result.message.content);
    const v2CtxFinal = getEmptyV2Context();
    Object.assign(v2CtxFinal, JSON.parse(result.context.v2ContextJson || '{}'));
    console.log('DEBUG CTX C2:', JSON.stringify(v2CtxFinal, null, 2));

    assert('Deve selecionar automaticamente o endereço id no contexto', v2CtxFinal.budgetAddressId === '902');
    assert('Deve calcular o frete e apresentar a cotação na mesma resposta', 
      result.message.content.includes('Cotação de Frete') || result.message.content.includes('VEPPO') || result.message.content.includes('Correios') || result.message.content.includes('Proposta de Orçamento') || result.message.content.includes('R$')
    );
    assert('Deve exibir a opção da VEPPO na resposta final', result.message.content.includes('VEPPO'));
  }

  // Cenário 3: Cliente com 2 ou mais endereços válidos
  console.log('\n--- Cenário 3: Cliente com 2 ou mais endereços válidos (pergunta escolha) ---');
  {
    // Dois endereços utilizáveis com CEP
    const mockEnderecos = [
      { id: 903, id_cliente: 8469, cep: '96810-400', endereco: 'Travessa Canoas', numero: '39', complemento: 'Casa', bairro: 'Centro', cidade: 'Santa Cruz do Sul', uf: 'RS' },
      { id: 904, id_cliente: 8469, cep: '90660-130', endereco: 'Rua Felizardo de Farias', numero: '81', complemento: 'Prédio 2', bairro: 'Medianeira', cidade: 'Porto Alegre', uf: 'RS' }
    ];
    const supabase = criarSupabaseMockFlexivel(mockCatalogo, mockClientes, mockEnderecos);

    const legacyCtx: ConversationContext = {
      v2ContextJson: serializeV2Context(getEmptyV2Context()),


    };

    const result = await processSimpleQueryWithBrain(
      'Orçamento para o cliente 8469, 1000 Triband',
      legacyCtx,
      { supabase, userName: 'Everton', userId: 'usr-123' }
    );

    console.log('DEBUG RESPOSTA C3:', result.message.content);
    const v2CtxFinal = getEmptyV2Context();
    Object.assign(v2CtxFinal, JSON.parse(result.context.v2ContextJson || '{}'));
    console.log('DEBUG CTX C3:', JSON.stringify(v2CtxFinal, null, 2));

    assert('Não deve selecionar endereço automaticamente', v2CtxFinal.budgetAddressId === undefined);
    assert('Deve registrar pendingAddressChoice para escolha do usuário', v2CtxFinal.pendingAddressChoice !== null);
    assert('Deve exibir o presenter de escolha de endereços', result.message.content.includes('Qual deles uso para cotação'));
    assert('Concordância textual deve estar no plural ("2 endereços")', result.message.content.includes('Encontrei 2 endereços'));
  }

  // Cenário 4: Cliente com vários registros, mas apenas 1 utilizável
  console.log('\n--- Cenário 4: Cliente com vários registros, mas apenas 1 endereço utilizável ---');
  {
    // Três registros, mas apenas o 905 possui CEP e campos utilizáveis
    const mockEnderecos = [
      { id: 905, id_cliente: 8469, cep: '96810-400', endereco: 'Travessa Canoas', numero: '39', complemento: 'Casa', bairro: 'Centro', cidade: 'Santa Cruz do Sul', uf: 'RS' },
      { id: 906, id_cliente: 8469, cep: '', endereco: 'Rua Sem CEP', numero: '40', complemento: '', bairro: '', cidade: '', uf: '' },
      { id: 907, id_cliente: 8469, cep: '90660-130', endereco: 'Rua Sem Cidade', numero: '50', complemento: '', bairro: '', cidade: '', uf: '' }
    ];
    const supabase = criarSupabaseMockFlexivel(mockCatalogo, mockClientes, mockEnderecos);

    const legacyCtx: ConversationContext = {
      v2ContextJson: serializeV2Context(getEmptyV2Context()),


    };

    const result = await processSimpleQueryWithBrain(
      'Orçamento para o cliente 8469, 1000 Triband',
      legacyCtx,
      { supabase, userName: 'Everton', userId: 'usr-123' }
    );

    console.log('DEBUG RESPOSTA C4:', result.message.content);
    const v2CtxFinal = getEmptyV2Context();
    Object.assign(v2CtxFinal, JSON.parse(result.context.v2ContextJson || '{}'));
    console.log('DEBUG CTX C4:', JSON.stringify(v2CtxFinal, null, 2));

    assert('Deve selecionar automaticamente o único endereço utilizável (id 905)', v2CtxFinal.budgetAddressId === '905');
    assert('Deve apresentar a cotação final diretamente', result.message.content.includes('Cotação de Frete') || result.message.content.includes('proposta') || result.message.content.includes('VEPPO') || result.message.content.includes('R$'));
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║   Fim dos testes: ${passed} passados, ${failed} falhados.          ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
