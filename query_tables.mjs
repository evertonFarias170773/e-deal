import { createClient } from '@supabase/supabase-js';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
async function run() {
  const tables = ['clientes', 'enderecos', 'contatos', 'clientes_socios'];
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(1);
    if (error) console.log(t, 'Error:', error.message);
    else console.log(t, 'Columns:', data.length ? Object.keys(data[0]).join(', ') : 'Empty table');
  }
  process.exit(0);
}
run();