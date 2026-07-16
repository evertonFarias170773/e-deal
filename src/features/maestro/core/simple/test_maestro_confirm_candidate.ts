/**
 * test_maestro_confirm_candidate.ts
 *
 * Testes integrados para validar:
 * 1. Confirmação natural de candidato único ("esse mesmo", "sim", "correto").
 * 2. Negação natural ("não é esse") com preservação de itens de orçamento.
 * 3. Bloqueio de confirmação automática se houver múltiplos candidatos.
 * 4. Normalização de busca de clientes removendo prefixos ("cliente Lisiton" -> "Lisiton").
 * 5. Validação com o banco de dados real do Supabase para o cliente 8469.
 *
 * Para rodar: npx tsx src/features/maestro/core/simple/test_maestro_confirm_candidate.ts
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

import { processSimpleQueryWithBrain } from './maestro-simple-engine';
import { getEmptyV2Context, serializeV2Context } from './maestro-v2-context-manager';
import { extrairClienteDaQuery } from './maestro-v2-router';
import { createClient } from '@supabase/supabase-js';
import type { ConversationContext } from '../../types';

process.env.MAESTRO_V2_ENABLED = 'true';
process.env.MAESTRO_AVULSO_ENABLED = 'true';
process.env.MAESTRO_SIMPLE_LLM_ENABLED = 'false';

// Inicializa cliente Supabase real usando as credenciais do ambiente
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

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
  console.log('║   Testes Maestro — Confirmação de Cliente e Limpeza          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Teste 1: Limpeza de prefixo explícito "cliente Lisiton" -> "Lisiton"
  console.log('--- Teste 1: Extração com prefixo de cliente ---');
  {
    const res = extrairClienteDaQuery('orçamento de 20.000 tribands para cliente Lisiton');
    assert('Deve extrair nome limpo "lisiton"', res?.valor === 'lisiton');
  }

  // Teste 2: Confirmação de único candidato ("esse mesmo") com dados reais do cliente 8469
  console.log('\n--- Teste 2: Confirmação natural ("esse mesmo") de único candidato ---');
  {
    // Simulamos que a busca anterior por "Lisiton" retornou LISITON DOCUMENTOS SEGUROS LTDA (8469) como candidato pendente
    const v2Ctx = getEmptyV2Context();
    v2Ctx.pendingClientCandidate = {
      id_cliente: 8469,
      nome: 'LISITON DOCUMENTOS SEGUROS LTDA',
      fantasia: 'Lisiton',
      documento: '12345678901',
      cidade_uf: 'Santa Cruz do Sul/RS'
    };
    v2Ctx.pendingBudgetForCandidate = [
      { quantidade: 20000, termo: 'tribands' }
    ];

    const legacyCtx: ConversationContext = {
      v2ContextJson: serializeV2Context(v2Ctx),

    };

    const result = await processSimpleQueryWithBrain(
      'esse mesmo',
      legacyCtx,
      { supabase, userName: 'Everton', userId: 'usr-123' }
    );

    const v2CtxFinal = getEmptyV2Context();
    Object.assign(v2CtxFinal, JSON.parse(result.context.v2ContextJson || '{}'));

    console.log('DEBUG RESPOSTA T2:', result.message.content);
    console.log('DEBUG ACTIVE CLIENT T2:', JSON.stringify(result.simpleClient, null, 2));

    assert('Deve ativar o cliente 8469', result.simpleClient?.clientInternalId === 8469);
    assert('Deve exibir presenterEscolhaEndereco com 4 endereços do banco', 
      result.message.content.includes('Encontrei 4 endereços') || result.message.content.includes('Canoas')
    );
    assert('Não deve possuir candidato pendente', v2CtxFinal.pendingClientCandidate === null);
  }

  // Teste 3: Negação natural ("não é esse") com preservação de itens
  console.log('\n--- Teste 3: Negação natural ("não é esse") preservando itens ---');
  {
    const v2Ctx = getEmptyV2Context();
    v2Ctx.pendingClientCandidate = {
      id_cliente: 8469,
      nome: 'LISITON DOCUMENTOS SEGUROS LTDA',
      fantasia: 'Lisiton',
      documento: '12345678901',
      cidade_uf: 'Santa Cruz do Sul/RS'
    };
    v2Ctx.pendingBudgetForCandidate = [
      { quantidade: 20000, termo: 'tribands' }
    ];

    const legacyCtx: ConversationContext = {
      v2ContextJson: serializeV2Context(v2Ctx),

    };

    const result = await processSimpleQueryWithBrain(
      'não é esse',
      legacyCtx,
      { supabase, userName: 'Everton', userId: 'usr-123' }
    );

    const v2CtxFinal = getEmptyV2Context();
    Object.assign(v2CtxFinal, JSON.parse(result.context.v2ContextJson || '{}'));

    assert('Deve limpar o candidato pendente', v2CtxFinal.pendingClientCandidate === null);
    assert('Deve preservar os itens pendentes do orçamento', 
      v2CtxFinal.pendingBudgetForCandidate != null && v2CtxFinal.pendingBudgetForCandidate.length === 1 && v2CtxFinal.pendingBudgetForCandidate[0].quantidade === 20000
    );
  }

  // Teste 4: Bloqueio de confirmação se houver múltiplos candidatos
  console.log('\n--- Teste 4: Bloqueio de confirmação se múltiplos candidatos ---');
  {
    const v2Ctx = getEmptyV2Context();
    v2Ctx.pendingClientCandidate = {
      id_cliente: 8469,
      nome: 'LISITON DOCUMENTOS SEGUROS LTDA',
      fantasia: 'Lisiton',
      documento: '12345678901',
      cidade_uf: 'Santa Cruz do Sul/RS'
    };
    v2Ctx.pendingClientCandidates = [
      { id_cliente: 8469, nome: 'LISITON', fantasia: '', documento: '', cidade_uf: '' },
      { id_cliente: 9999, nome: 'LISITON OUTRO', fantasia: '', documento: '', cidade_uf: '' }
    ];

    const legacyCtx: ConversationContext = {
      v2ContextJson: serializeV2Context(v2Ctx),

    };

    const result = await processSimpleQueryWithBrain(
      'sim',
      legacyCtx,
      { supabase, userName: 'Everton', userId: 'usr-123' }
    );

    const v2CtxFinal = getEmptyV2Context();
    Object.assign(v2CtxFinal, JSON.parse(result.context.v2ContextJson || '{}'));

    assert('Não deve ativar o cliente 8469 automaticamente', result.simpleClient === null);
    assert('Deve reter a lista de candidatos pendentes', v2CtxFinal.pendingClientCandidates?.length === 2);
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
