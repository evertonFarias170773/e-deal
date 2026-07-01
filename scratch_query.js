const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key.trim()] = val.join('=').trim().replace(/^\"|\"$/g, '');
  return acc;
}, {});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
  const { data: prop } = await supabase.from('propostas').select('id_int, status_interno, updated_at').eq('id_int', 18360).maybeSingle();
  console.log('Proposta 18360:', prop);
  
  const { data: prop2 } = await supabase.from('propostas').select('id_int, status_interno, updated_at').eq('id_int', 18359).maybeSingle();
  console.log('Proposta 18359:', prop2);

  const { data: chats } = await supabase.from('propostas_chat').select('id, mensagem, created_at').eq('id_int', 18360).order('created_at', { ascending: false }).limit(3);
  console.log('Chats 18360:', chats);
  
  const { data: chats2 } = await supabase.from('propostas_chat').select('id, mensagem, created_at').eq('id_int', 18359).order('created_at', { ascending: false }).limit(3);
  console.log('Chats 18359:', chats2);
}
run();
