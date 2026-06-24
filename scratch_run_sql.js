const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://vwbtitjlpelrcnsytzqw.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnRpdGpscGVscmNuc3l0enF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5NzE5NTEsImV4cCI6MjA2NDU0Nzk1MX0.te1kg9RKJUQ-gBQ7YiXLDk-Ej8JMNcujIzIR-fTGR-o');

async function run() {
  const { data: pData, error: pErr } = await supabase.from('pagamentos_v2').select('id, id_int, id_pagamento, url_pdf, n_url_pdf, public_token').in('id_int', [20225, 18220]);
  
  if (pErr) console.error("Pagamentos Error:", pErr);
  
  console.log("PAGAMENTOS_V2 RECENTES:", JSON.stringify(pData, null, 2));
}

run();
