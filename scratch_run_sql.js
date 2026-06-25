const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://vwbtitjlpelrcnsytzqw.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnRpdGpscGVscmNuc3l0enF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5NzE5NTEsImV4cCI6MjA2NDU0Nzk1MX0.te1kg9RKJUQ-gBQ7YiXLDk-Ej8JMNcujIzIR-fTGR-o');

async function run() {
  const { data: pData } = await supabase.from('pagamentos_v2').select('*').eq('id_int', 18284);
  const { data: bData } = await supabase.from('boletos').select('*').eq('id_int', 18284);
  
  console.log("PAGAMENTOS_V2 18284:", JSON.stringify(pData, null, 2));
  console.log("BOLETOS 18284:", JSON.stringify(bData, null, 2));
}

run();
