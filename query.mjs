import { createClient } from '@supabase/supabase-js';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
async function run() {
  const { data, error } = await supabase.rpc('exec_sql', { query: process.argv[1] });
  if (error) console.error(error); else console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}
run();