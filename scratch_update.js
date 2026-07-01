const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key.trim()] = val.join('=').trim().replace(/^\"|\"$/g, '');
  return acc;
}, {});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY); // unauthenticated

async function run() {
  const { data: updateData, error: updateError } = await supabase
    .from("propostas")
    .update({ status_interno: "NOVO / EM ARTE" })
    .eq("id_int", 18360)
    .eq("status_interno", "NOVO")
    .select("id_int");
    
  console.log('Update Data:', updateData);
  console.log('Update Error:', updateError);
}
run();
