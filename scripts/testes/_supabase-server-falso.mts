/** Substituto de `@/lib/supabase/server` (usa next/headers): devolve o mesmo cliente falso. */
import { getSupabaseClient } from "./_supabase-falso.mts";

export async function createClient() {
  return getSupabaseClient();
}
