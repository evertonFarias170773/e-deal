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
  console.log("Running SQL logic from user request...");
  
  const { data: allPropostas, error: err1 } = await supabase
    .from('propostas')
    .select('id_int, status_interno');
    
  if (err1) {
    console.error("Error fetching propostas:", err1);
    return;
  }
  
  // Try exact match like SQL: UPPER(p.status_interno) = 'AGUARDANDO'
  const propostasAguardando = allPropostas.filter(p => p.status_interno && p.status_interno.toUpperCase() === 'AGUARDANDO');
  
  const inconsistentes = [];
  
  for (const prop of propostasAguardando) {
    const { data: cobrancas, error: err2 } = await supabase
      .from('pagamentos_v2')
      .select('id, status, tipo_cobranca')
      .eq('id_int', prop.id_int);
      
    if (err2) {
      continue;
    }
    
    // As per user SQL: COUNT(pg.id) FILTER (WHERE pg.status IS NULL OR UPPER(pg.status) <> 'CANCELADO') = 0
    let cobrancas_ativas = 0;
    for (const pg of cobrancas) {
      if (pg.status == null || pg.status.toUpperCase() !== 'CANCELADO') {
        cobrancas_ativas++;
      }
    }
    
    if (cobrancas_ativas === 0) {
      inconsistentes.push({
        id_int: prop.id_int,
        status_interno: prop.status_interno,
        cobrancas_ativas,
        cobrancas_raw: cobrancas
      });
    }
  }
  
  console.log(`User SQL logic test: Found ${inconsistentes.length} propostas inconsistentes (out of ${propostasAguardando.length} AGUARDANDO).`);
  if (inconsistentes.length > 0) {
    console.log("IDs:", inconsistentes.map(i => i.id_int).join(", "));
  }
}

runDiagnostics();
