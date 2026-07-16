/**
 * test_reproduce_divergence.ts
 *
 * Teste integrado para reproduzir e validar a divergência do fluxo de orçamento com cliente:
 * 1. "15000 triband pra Lisiton"
 * 2. Maestro apresenta o candidato LISITON (8469)
 * 3. Usuário responde "8469" ou "cliente 8469"
 *
 * O teste valida as duas variantes: com roteador externo ativo e inativo.
 *
 * Para rodar: npx tsx src/features/maestro/core/simple/test_reproduce_divergence.ts
 */

import fs from 'fs';
import path from 'path';

// Carrega .env.local se existir
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

// Mocks de Roteador Externo via require.cache
const extIntentServerPath = require.resolve('./maestro-external-intent.server');
require.cache[extIntentServerPath] = {
  id: extIntentServerPath,
  filename: extIntentServerPath,
  loaded: true,
  exports: {
    callExternalAgent: async (payload: any) => {
      // Se a query for o código "8469", simula que o LLM externo decidiu buscar o cliente
      if (payload.query === '8469' || payload.query === 'cliente 8469') {
        return {
          intent: 'client_lookup',
          confidence: 'high',
          entities: { clientCode: '8469' }
        };
      }
      return null;
    }
  }
} as any;

const extMapperPath = require.resolve('./maestro-external-intent.mapper');
require.cache[extMapperPath] = {
  id: extMapperPath,
  filename: extMapperPath,
  loaded: true,
  exports: {
    mapExternalIntentToRouterResult: (externalResult: any, v2Ctx: any, activeClient: any) => {
      if (externalResult && externalResult.intent === 'client_lookup') {
        return {
          routed: true,
          plan: { steps: [{ tool: 'buscarCliente', params: { busca: '8469' } }] }
        };
      }
      return { routed: false };
    }
  }
} as any;

import { processSimpleQueryWithBrain } from './maestro-simple-engine';
import { getEmptyV2Context, serializeV2Context } from './maestro-v2-context-manager';
import { createClient } from '@supabase/supabase-js';
import type { ConversationContext } from '../../types';

process.env.MAESTRO_V2_ENABLED = 'true';
process.env.MAESTRO_AVULSO_ENABLED = 'true';
process.env.MAESTRO_SIMPLE_LLM_ENABLED = 'false'; // Desliga humanização

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
  console.log('║   Testes Maestro — Reprodução da Divergência (Turno 8469)    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Variante A: Roteador Externo DESABILITADO
  console.log('--- Variante A: Roteador Externo Desabilitado (com query exata "8469") ---');
  {
    process.env.MAESTRO_EXTERNAL_INTENT_ENABLED = 'false';

    // Contexto simulando o final do Turno 1 ("15000 triband pra Lisiton")
    const v2Ctx = getEmptyV2Context();
    v2Ctx.pendingClientCandidate = {
      id_cliente: 8469,
      nome: 'LISITON DOCUMENTOS SEGUROS LTDA',
      fantasia: 'Lisiton',
      documento: '12345678901',
      cidade_uf: 'Santa Cruz do Sul/RS'
    };
    v2Ctx.pendingBudgetForCandidate = [
      { quantidade: 15000, termo: 'triband' }
    ];

    const legacyCtx: ConversationContext = {
      v2ContextJson: serializeV2Context(v2Ctx),


    };

    const result = await processSimpleQueryWithBrain(
      '8469',
      legacyCtx,
      { supabase, userName: 'Everton', userId: 'usr-123' }
    );

    const v2CtxFinal = getEmptyV2Context();
    Object.assign(v2CtxFinal, JSON.parse(result.context.v2ContextJson || '{}'));

    assert('Deve ativar o cliente 8469', result.simpleClient?.clientInternalId === 8469);
    assert('Deve carregar e exibir a escolha dos 4 endereços', result.message.content.includes('Encontrei 4 endereços'));
    assert('Não deve exibir a ficha cadastral completa isolada', !result.message.content.includes('Razão Social:') && !result.message.content.includes('Telefone:'));
  }

  // Variante B: Roteador Externo HABILITADO
  console.log('\n--- Variante B: Roteador Externo Habilitado (Simula a Divergência com "cliente 8469") ---');
  {
    process.env.MAESTRO_EXTERNAL_INTENT_ENABLED = 'true';

    // Contexto simulando o final do Turno 1 ("15000 triband pra Lisiton")
    const v2Ctx = getEmptyV2Context();
    v2Ctx.pendingClientCandidate = {
      id_cliente: 8469,
      nome: 'LISITON DOCUMENTOS SEGUROS LTDA',
      fantasia: 'Lisiton',
      documento: '12345678901',
      cidade_uf: 'Santa Cruz do Sul/RS'
    };
    v2Ctx.pendingBudgetForCandidate = [
      { quantidade: 15000, termo: 'triband' }
    ];

    const legacyCtx: ConversationContext = {
      v2ContextJson: serializeV2Context(v2Ctx),


    };

    const result = await processSimpleQueryWithBrain(
      'cliente 8469',
      legacyCtx,
      { supabase, userName: 'Everton', userId: 'usr-123' }
    );

    const v2CtxFinal = getEmptyV2Context();
    Object.assign(v2CtxFinal, JSON.parse(result.context.v2ContextJson || '{}'));

    console.log('DEBUG RESPOSTA VARIANTE B:', result.message.content);

    assert('Deve ativar o cliente 8469 mesmo sob roteamento de busca externo', result.simpleClient?.clientInternalId === 8469);
    assert('Deve carregar e exibir a escolha dos 4 endereços', result.message.content.includes('Encontrei 4 endereços'));
    assert('Não deve exibir a ficha cadastral completa isolada', !result.message.content.includes('Razão Social:') && !result.message.content.includes('Telefone:'));
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
