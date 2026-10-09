/**
 * Igual a `_supabase-js-falso.mts`, mais os nomes que alguns serviços importam
 * de `@supabase/supabase-js` como valor quando são só tipos (`SupabaseClient`).
 * No build o Next apaga esses imports; rodando direto pelo Node eles precisam
 * existir, senão o módulo nem carrega. Serve para testar ROTA que puxa o
 * serviço de orçamentos.
 */
import { getSupabaseClient } from "./_supabase-falso.mts";

export function createClient() {
  return getSupabaseClient();
}

export class SupabaseClient {}
