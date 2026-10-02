/**
 * Substituto de `@supabase/supabase-js` para testar ROTA sem banco: `createClient`
 * devolve o cliente falso de `_supabase-falso.mts`, que só anota o que foi pedido.
 * Quem usa redireciona o import no hook do próprio teste.
 */
import { getSupabaseClient } from "./_supabase-falso.mts";

export function createClient() {
  return getSupabaseClient();
}
