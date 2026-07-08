const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: mCols, error: e1 } = await supabase.rpc('execute_sql_v3', { sql_query: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'modelos_cobranca';" });
  console.log('modelos_cobranca cols:', mCols || e1);

  const { data: pk, error: e2 } = await supabase.rpc('execute_sql_v3', { sql_query: "SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = 'modelos_cobranca'::regclass AND i.indisprimary;" });
  console.log('modelos_cobranca pk:', pk || e2);

  const { data: p2Cols, error: e3 } = await supabase.rpc('execute_sql_v3', { sql_query: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pagamentos_v2';" });
  console.log('pagamentos_v2 cols:', p2Cols || e3);
}
check();
