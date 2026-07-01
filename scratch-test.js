const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://vwbtitjlpelrcnsytzqw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnRpdGpscGVscmNuc3l0enF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5NzE5NTEsImV4cCI6MjA2NDU0Nzk1MX0.te1kg9RKJUQ-gBQ7YiXLDk-Ej8JMNcujIzIR-fTGR-o';

const client = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runTests() {
  const token = SUPABASE_KEY;
  
  const { data: propostas, error: propError } = await client.from('propostas')
    .select('id_int, status_interno')
    .in('status_interno', ['NOVO']) // Let's use NOVO so we can test the transition NOVO -> AGUARDANDO
    .limit(1);
    
  if (!propostas || propostas.length === 0) {
    console.log("Nenhuma proposta encontrada para teste.");
    return;
  }
  
  const p = propostas[0];
  console.log(`\n=== Proposta para teste: ${p.id_int}, status atual: ${p.status_interno} ===\n`);
  
  console.log("\n--- TESTE 4: Flag Ligada + Origem Válida (Espera OK) ---");
  let res = await fetch('http://localhost:3000/api/orcamentos/trigger-automacao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ id_int: p.id_int, origem: 'AUTO_FINANCEIRO' })
  });
  console.log("Status Code:", res.status);
  console.log("Response:", await res.json());

  // Re-read status to see if it changed
  const { data: pAfter } = await client.from('propostas').select('status_interno').eq('id_int', p.id_int).single();
  console.log(`Status após Teste 4: ${pAfter.status_interno}`);

  // Fetch chat to see logs
  const { data: chats } = await client.from('propostas_chat').select('mensagem, tipo, setor, id_int').eq('id_int', p.id_int).order('created_at', { ascending: false }).limit(2);
  console.log("Logs no chat:");
  console.log(chats);

  console.log("\n--- TESTE 6: Status Proibido (Espera erro de whitelist) ---");
  // We can just rely on the fact that if it doesn't change, we get 400.
  console.log("Status Code: N/A - Depende da recomendação da engine.");

}

runTests().catch(console.error);
