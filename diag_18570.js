require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("=== Checking propostas 18570 ===");
  const { data: prop, error: err1 } = await supabase
    .from("propostas")
    .select("id_int, status_interno, status_pedido, etapa_operacional, boleto_aproved, em_arte, is_prd_aprovado, is_avulso")
    .eq("id_int", 18570)
    .single();
    
  if (err1) console.error(err1);
  else console.log(prop);

  console.log("\n=== Checking pedidos_modelos for 18570 ===");
  const { data: modelos, error: err4 } = await supabase
    .from("pedidos_modelos")
    .select("id_int, status_arte, status_producao")
    .eq("id_int", 18570);
    
  if (err4) console.error(err4);
  else console.log(modelos);

  console.log("\n=== Checking pedidos_artes for 18570 ===");
  const { data: arte, error: err2 } = await supabase
    .from("pedidos_artes")
    .select("id, id_int, status, id_modelo")
    .eq("id_int", 18570);
    
  if (err2) console.error(err2);
  else console.log(arte);
  console.log("\n=== Checking triggers on propostas, pagamentos_v2, pedidos_artes, pedidos_modelos ===");
  const { data: triggers, error: errTriggers } = await supabase.rpc("exec_sql", {
    query: `
      SELECT event_object_table as table_name, trigger_name, event_manipulation, action_statement
      FROM information_schema.triggers
      WHERE event_object_table IN ('propostas', 'pagamentos_v2', 'pedidos_artes', 'pedidos_modelos')
      ORDER BY event_object_table, trigger_name;
    `
  });
  
  if (errTriggers) {
    // maybe no exec_sql rpc. Let's try raw pg query if we can or just rely on what we know.
    console.error("RPC exec_sql failed or doesn't exist:", errTriggers.message);
  } else {
    console.log(triggers);
  }
  console.log("\n=== Checking pagamentos_v2 for 18570 ===");
  const { data: pags, error: err3 } = await supabase
    .from("pagamentos_v2")
    .select("id, status, confirmado")
    .eq("id_int", 18570);
    
  if (err3) console.error(err3);
  else console.log(pags);
}
run();
