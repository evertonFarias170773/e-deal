/**
 * test_fluxo_completo_lisiton.ts
 *
 * Teste de fluxo completo sequencial idêntico ao front-end:
 * Turno 1: "15000 triband pra Lisiton"
 * Turno 2: "8469" (com o contexto retornado no Turno 1)
 *
 * Para rodar: npx tsx src/features/maestro/core/simple/test_fluxo_completo_lisiton.ts
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

// Mock do fetch global apenas para interceptar VEPPO/Correios e rodar sem rede
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
  if (urlStr.includes('ws.correios.com.br') || urlStr.includes('correios') || urlStr.includes('calculadorafrete')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
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
import { createClient } from '@supabase/supabase-js';
import type { ConversationContext } from '../../types';

process.env.MAESTRO_V2_ENABLED = 'true';
process.env.MAESTRO_AVULSO_ENABLED = 'true';
process.env.MAESTRO_SIMPLE_LLM_ENABLED = 'false'; // Determinístico
process.env.MAESTRO_EXTERNAL_INTENT_ENABLED = 'true'; // Com roteador externo ativo para reproduzir front-end real

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('=== INICIANDO FLUXO CONVERSACIONAL REAL (SIMULAÇÃO FRONT-END) ===\n');

  // Inicializa contexto vazio
  let legacyCtx: ConversationContext = {
    v2ContextJson: serializeV2Context(getEmptyV2Context()),
    activeClientJson: null,
    lastAnswerJson: null,
    lastUpdateJson: null
  };

  // ----------------------------------------------------
  // TURNO 1: "15000 triband pra Lisiton"
  // ----------------------------------------------------
  console.log('>>>> TURNO 1: "15000 triband pra Lisiton"');
  const result1 = await processSimpleQueryWithBrain(
    '15000 triband pra Lisiton',
    legacyCtx,
    { supabase, userName: 'Everton', userId: 'usr-123' }
  );

  console.log('\n[RESPOSTA TURNO 1]');
  console.log(result1.message.content);
  console.log('\n[CONTEXTO RETORNADO TURNO 1 (Resumido)]');
  const v2Ctx1 = JSON.parse(result1.context.v2ContextJson || '{}');
  console.log(JSON.stringify({
    domain: v2Ctx1.domain,
    pendingClientCandidate: v2Ctx1.pendingClientCandidate,
    pendingClientCandidates: v2Ctx1.pendingClientCandidates,
    pendingBudgetForCandidate: v2Ctx1.pendingBudgetForCandidate,
    orcamentoItens: v2Ctx1.orcamentoItens,
    activeClient: result1.simpleClient ? {
      clientInternalId: result1.simpleClient.clientInternalId,
      clientName: result1.simpleClient.clientName
    } : null
  }, null, 2));

  console.log('\n----------------------------------------------------\n');

  // Atualiza o contexto conversacional com o retorno do Turno 1
  legacyCtx = result1.context;

  // ----------------------------------------------------
  // TURNO 2: "8469"
  // ----------------------------------------------------
  console.log('>>>> TURNO 2: "8469"');
  const result2 = await processSimpleQueryWithBrain(
    '8469',
    legacyCtx,
    { supabase, userName: 'Everton', userId: 'usr-123' }
  );

  console.log('\n[RESPOSTA TURNO 2]');
  console.log(result2.message.content);
  console.log('\n[CONTEXTO RETORNADO TURNO 2 (Resumido)]');
  const v2Ctx2 = JSON.parse(result2.context.v2ContextJson || '{}');
  console.log(JSON.stringify({
    domain: v2Ctx2.domain,
    pendingClientCandidate: v2Ctx2.pendingClientCandidate,
    pendingClientCandidates: v2Ctx2.pendingClientCandidates,
    pendingBudgetForCandidate: v2Ctx2.pendingBudgetForCandidate,
    orcamentoItens: v2Ctx2.orcamentoItens,
    pendingAddressChoice: v2Ctx2.pendingAddressChoice,
    activeClient: result2.simpleClient ? {
      clientInternalId: result2.simpleClient.clientInternalId,
      clientName: result2.simpleClient.clientName
    } : null
  }, null, 2));
}

run().catch(console.error);
