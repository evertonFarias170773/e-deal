const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key.trim()] = val.join('=').trim().replace(/^\"|\"$/g, '');
  return acc;
}, {});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
  const { data: rlsStatus } = await supabase.rpc('execute_sql', { 
    sql_query: "SELECT relrowsecurity FROM pg_class WHERE relname = 'propostas'" 
  });
  
  if (!rlsStatus) {
    // se rpc nao existe, tenta ler direto de pg_class ou buscar via select se permitido
    console.log("RPC execute_sql nao disponivel.");
  } else {
    console.log('RLS status:', rlsStatus);
  }
}
run();
