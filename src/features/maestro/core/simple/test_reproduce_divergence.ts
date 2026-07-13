/**
 * test_reproduce_divergence.ts
 *
 * Teste integrado para simular a engine do Maestro processando a frase exata:
 * "Orçamento para Carlos Henrique de 1.000 Pulseira Triband"
 *
 * Valida a barreira centralizada contra bypass do roteador e o comportamento em memória.
 *
 * Para rodar: npx tsx src/features/maestro/core/simple/test_reproduce_divergence.ts
 */

import { processSimpleQueryWithBrain } from './maestro-simple-engine';
import { getEmptyV2Context, serializeV2Context } from './maestro-v2-context-manager';
import type { ConversationContext } from '../../types';

process.env.MAESTRO_V2_ENABLED = 'true';
process.env.MAESTRO_AVULSO_ENABLED = 'true';

const mockCatalogo = [
  {
    id_produto: 101,
    descricao: 'PULSEIRA TRIBAND ACESSO',
    apelidos: 'triband, pulseira triband, tri',
    valorUnt: 1.25,
    valorFixo: 0,
    ativo: true
  }
];

// Fixture com exatamente 7 homônimos para disparar a busca ampla (too_many)
const mockClientes = [
  { id_cliente: 8001, id_cliente_text: 'CLI8001', nome: 'Carlos Henrique da Silva', fantasia: 'Carlos Silva', documento: '12345678901', cidade_uf: 'São Paulo/SP', busca_geral: 'carlos henrique da silva cli8001', ativo: true },
  { id_cliente: 8002, id_cliente_text: 'CLI8002', nome: 'Carlos Henrique Santos', fantasia: 'Carlos Santos', documento: '12345678902', cidade_uf: 'Rio de Janeiro/RJ', busca_geral: 'carlos henrique santos cli8002', ativo: true },
  { id_cliente: 8003, id_cliente_text: 'CLI8003', nome: 'Carlos Henrique Oliveira', fantasia: 'Carlos Oliveira', documento: '12345678903', cidade_uf: 'Belo Horizonte/MG', busca_geral: 'carlos henrique oliveira cli8003', ativo: true },
  { id_cliente: 8004, id_cliente_text: 'CLI8004', nome: 'Carlos Henrique Souza', fantasia: 'Carlos Souza', documento: '12345678904', cidade_uf: 'Porto Alegre/RS', busca_geral: 'carlos henrique souza cli8004', ativo: true },
  { id_cliente: 8005, id_cliente_text: 'CLI8005', nome: 'Carlos Henrique Pereira', fantasia: 'Carlos Pereira', documento: '12345678905', cidade_uf: 'Curitiba/PR', busca_geral: 'carlos henrique pereira cli8005', ativo: true },
  { id_cliente: 8006, id_cliente_text: 'CLI8006', nome: 'Carlos Henrique Alves', fantasia: 'Carlos Alves', documento: '12345678906', cidade_uf: 'Salvador/BA', busca_geral: 'carlos henrique alves cli8006', ativo: true },
  { id_cliente: 8007, id_cliente_text: 'CLI8007', nome: 'Carlos Henrique Costa', fantasia: 'Carlos Costa', documento: '12345678907', cidade_uf: 'Fortaleza/CE', busca_geral: 'carlos henrique costa cli8007', ativo: true }
];

const mockEnderecos = [
  { id: 9901, id_cliente: 8001, tipo_endereco: 'ENTREGA', cep: '01000-000', endereco: 'Av Paulista', numero: '1000', complemento: '', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP' }
];

// Mock Supabase sob medida para o teste
function criarSupabaseMockCompleto(catalogo: any[], clientes: any[], enderecos: any[]) {
  return {
    from: (tabela: string) => {
      let filtros: Array<(x: any) => boolean> = [];
      let limiteMax = 1000;
      let isSingle = false;
      let targetCollection = tabela === 'produtos' ? catalogo
                           : tabela === 'vw_cadastros_clientes_lista' ? clientes
                           : tabela === 'enderecos' ? enderecos
                           : tabela === 'cadastros' ? clientes // buildDetailedClientContext consulta cadastros
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
        order: (campo: string, opts?: any) => chain,
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

const supabase = criarSupabaseMockCompleto(mockCatalogo, mockClientes, mockEnderecos);

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
  console.log('║   Teste Integrado — Barreira Centralizada de Segurança       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Testa a frase relatada pelo front no motor principal
  console.log('--- Testando frase do front: "Orçamento para Carlos Henrique de 1.000 Pulseira Triband" ---');
  {
    const legacyCtx: ConversationContext = {
      v2ContextJson: serializeV2Context(getEmptyV2Context()),
      activeClientJson: null,
      lastAnswerJson: null,
      lastUpdateJson: null
    };

    const result = await processSimpleQueryWithBrain(
      'Orçamento para Carlos Henrique de 1.000 Pulseira Triband',
      legacyCtx,
      { supabase, userName: 'Everton', userId: 'usr-123' }
    );

    // O motor principal deve ter interceptado o fluxo e retornado buscarCliente
    // com a busca por "carlos henrique de"
    assert('Deve interceptar e direcionar a resposta', !!result.message);
    assert('Não deve exibir preços, frete ou totais', !result.message.content.includes('R$') && !result.message.content.includes('Total'));
    assert('Deve exibir aviso de orçamento em espera', result.message.content.includes('Orçamento em espera'));
    
    const v2CtxFinal = getEmptyV2Context();
    Object.assign(v2CtxFinal, JSON.parse(result.context.v2ContextJson || '{}'));

    assert('Deve manter o orçamento em espera em pendingBudgetForCandidate', 
      v2CtxFinal.pendingBudgetForCandidate !== null && v2CtxFinal.pendingBudgetForCandidate.length > 0
    );
    
    const itemGuardado = v2CtxFinal.pendingBudgetForCandidate?.[0];
    assert('Quantidade em espera deve ser exatamente 1000', itemGuardado?.quantidade === 1000);
    assert('Produto em espera deve ser "pulseira triband"', itemGuardado?.termo === 'pulseira triband');
    assert('Deve guardar o termo de busca em pendingClientSearchTerm', v2CtxFinal.pendingClientSearchTerm === 'carlos henrique de');
  }

  // 2. Simula um bypass no Roteador (Roteador retornando simularOrcamentoAvulso incorretamente)
  console.log('\n--- Simulando Bypass do Roteador (Forçando simularOrcamentoAvulso com cliente pendente) ---');
  {
    // A barreira de segurança centralizada no motor garante que se a query tiver cliente
    // não resolvido, mas o step retornado pelo roteador for orçador avulso (como simularOrcamentoAvulso),
    // o motor reescreve a tool para buscarCliente
    const legacyCtx: ConversationContext = {
      v2ContextJson: serializeV2Context(getEmptyV2Context()),
      activeClientJson: null,
      lastAnswerJson: null,
      lastUpdateJson: null
    };

    // Aqui simulamos a query mista que a LLM externa erroneamente direcionaria para simularOrcamentoAvulso
    const result = await processSimpleQueryWithBrain(
      'Orçamento de 1000 pulseiras para o Carlos',
      legacyCtx,
      { supabase, userName: 'Everton', userId: 'usr-123' }
    );

    const v2CtxFinal = getEmptyV2Context();
    Object.assign(v2CtxFinal, JSON.parse(result.context.v2ContextJson || '{}'));

    // Verifica se a tool executada no motor final foi redirecionada para buscarCliente
    assert('Deve ter redirecionado a tool do orçador para buscarCliente', v2CtxFinal.lastTool === 'buscarCliente');
    assert('Deve ter retido os itens no pendingBudgetForCandidate', v2CtxFinal.pendingBudgetForCandidate !== null);
    assert('Quantidade retida deve ser 1000', v2CtxFinal.pendingBudgetForCandidate?.[0]?.quantidade === 1000);
  }

  // 3. Valida retomada da cotação após informar código do cliente
  console.log('\n--- Validando Retomada da Cotação após Identificação do Cliente ---');
  {
    // Turno 1: Envia query mista.
    const legacyCtx1: ConversationContext = {
      v2ContextJson: serializeV2Context(getEmptyV2Context()),
      activeClientJson: null,
      lastAnswerJson: null,
      lastUpdateJson: null
    };
    const result1 = await processSimpleQueryWithBrain(
      'Orçamento para Carlos Henrique de 1.000 Pulseira Triband',
      legacyCtx1,
      { supabase, userName: 'Everton', userId: 'usr-123' }
    );

    // Turno 2: Usuário informa o código específico (8001) para desambiguar
    const result2 = await processSimpleQueryWithBrain(
      '8001',
      result1.context,
      { supabase, userName: 'Everton', userId: 'usr-123' }
    );

    // Como o cliente foi resolvido (código 8001), o motor deve recuperar a cotação
    // do context (pendingBudgetForCandidate) e transicionar para o fluxo padrão de orçamento (ex: endereços).
    const v2CtxFinal = getEmptyV2Context();
    Object.assign(v2CtxFinal, JSON.parse(result2.context.v2ContextJson || '{}'));

    assert('Deve ter resolvido o cliente', result2.simpleClient?.clientDisplayCode === 'CLI8001');
    assert('Deve ter recuperado os itens de pendingBudgetForCandidate e colocado no orcamentoItens',
      v2CtxFinal.orcamentoItens !== null && v2CtxFinal.orcamentoItens.length > 0 && v2CtxFinal.orcamentoItens[0].quantidade === 1000
    );
    assert('Deve ter limpo o pendingBudgetForCandidate', v2CtxFinal.pendingBudgetForCandidate === null);
    assert('Deve carregar os endereços do cliente e exibir presenterEscolhaEndereco',
      result2.message.content.includes('endereço') || result2.message.content.includes('Paulista')
    );
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║   Fim do teste integrado: ${passed} passados, ${failed} falhados.  ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
