const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
let supabaseUrl = '';
let supabaseKey = '';

envFile.split('\n').forEach(line => {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
    supabaseUrl = line.split('=')[1].trim();
  }
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) {
    supabaseKey = line.split('=')[1].trim();
  }
});

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runDiagnostics() {
  console.log("Running diagnostics...");
  
  const { data: propostasAguardando, error: err1 } = await supabase
    .from('propostas')
    .select('id_int, status_interno')
    .ilike('status_interno', 'AGUARDANDO');
    
  if (err1) {
    console.error("Error fetching propostas:", err1);
    return;
  }
  
  console.log(`Found ${propostasAguardando.length} propostas in AGUARDANDO status.`);
  
  const inconsistentes = [];
  
  for (const prop of propostasAguardando) {
    const { data: cobrancas, error: err2 } = await supabase
      .from('pagamentos_v2')
      .select('id, status, tipo_cobranca, confirmado, created_at')
      .eq('id_int', prop.id_int);
      
    if (err2) {
      console.error(`Error fetching pagamentos for ${prop.id_int}:`, err2);
      continue;
    }
    
    const activeCharges = cobrancas.filter(c => c.status === null || c.status.toUpperCase() !== 'CANCELADO');
    
    if (activeCharges.length === 0) {
      inconsistentes.push({
        id_int: prop.id_int,
        status_interno: prop.status_interno,
        cobrancas_ativas: 0,
        cobrancas_raw: cobrancas
      });
    }
  }
  
  console.log(`Found ${inconsistentes.length} propostas inconsistentes (AGUARDANDO with 0 active cobrancas).`);
  
  if (inconsistentes.length > 0) {
    console.log("Sample of inconsistent proposals:");
    for (let i = 0; i < Math.min(10, inconsistentes.length); i++) {
      const inc = inconsistentes[i];
      console.log(`- ID_INT: ${inc.id_int}`);
      console.log(`  All cobrancas:`, inc.cobrancas_raw);
    }
  }
}

runDiagnostics();
