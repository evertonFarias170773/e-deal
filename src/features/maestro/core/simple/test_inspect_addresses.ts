/**
 * test_inspect_addresses.ts
 *
 * Inspeciona as colunas e dados da tabela de endereços reais do cliente 8469 (Lisiton)
 * para diagnosticar o fluxo.
 *
 * Para rodar: npx tsx src/features/maestro/core/simple/test_inspect_addresses.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ ERRO: Variáveis de ambiente não encontradas no .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function run() {
  console.log('=== Inspecionando Endereços do Cliente 8469 ===');
  
  const { data, error } = await supabase
    .from('enderecos')
    .select('*')
    .eq('id_cliente', 8469);
    
  if (error) {
    console.error('Erro ao consultar tabela enderecos:', error);
    return;
  }
  
  console.log(`Encontrados ${data?.length || 0} endereços para o cliente 8469.`);
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);
