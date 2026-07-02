import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: all } = await supabase
    .from('propostas')
    .select('id_int, created_at, updated_at, status_interno')
    .order('id_int', { ascending: false })
    .limit(1000);

  const updatedGroups = {};
  const createdGroups = {};

  all.forEach(p => {
    if (p.updated_at) {
       // Check up to the minute level to see UI duplicates
       const min = p.updated_at.substring(0, 16);
       updatedGroups[min] = (updatedGroups[min] || 0) + 1;
    }
    if (p.created_at) {
       const min = p.created_at.substring(0, 16);
       createdGroups[min] = (createdGroups[min] || 0) + 1;
    }
  });

  console.log('--- Minutos com mais de 2 propostas (updated_at) ---');
  Object.entries(updatedGroups)
    .filter(([_, count]) => count > 2)
    .sort((a, b) => b[1] - a[1])
    .forEach(([min, count]) => {
      console.log(`Minuto ${min}: ${count} propostas`);
    });

  console.log('\n--- Minutos com mais de 2 propostas (created_at) ---');
  Object.entries(createdGroups)
    .filter(([_, count]) => count > 2)
    .sort((a, b) => b[1] - a[1])
    .forEach(([min, count]) => {
      console.log(`Minuto ${min}: ${count} propostas`);
    });
}

run();
