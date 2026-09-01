import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Bearer para chamadas REST diretas (`/rest/v1/...`) feitas com `fetch`.
 *
 * O ERRO QUE ISTO EVITA
 * ---------------------
 * Vários services montavam o header na mão usando a PRÓPRIA anon key como
 * Bearer — `Authorization: Bearer <anonKey>`. Isso faz o PostgREST resolver o
 * papel como `anon`, mesmo com o usuário logado: o JWT da sessão nunca chega.
 *
 * Passou anos despercebido porque `anon` tinha GRANT em tudo. Em 01/09/2026 o
 * commit 93e0a9b revogou `clientes` e `enderecos`, e em duas horas houve dois
 * incidentes em produção pela mesma causa — a tela de cadastro em 404 e a
 * gravação de telefone em 401 `permission denied for table clientes`.
 *
 * O CONTRATO
 * ----------
 * `apikey` continua sendo a anon key: ela identifica o PROJETO e é obrigatória.
 * O que este helper resolve é só o `authorization`, que passa a levar o
 * access_token da sessão e faz o papel ser `authenticated`.
 *
 * Sem sessão, devolve a anon key. O comportamento fica idêntico ao anterior nas
 * tabelas ainda abertas, e o erro segue explícito nas fechadas — nunca um
 * `Bearer undefined`.
 *
 * NÃO SERVE PARA EDGE FUNCTION. Chamadas a `/functions/v1/...` usam a anon key
 * como Bearer por contrato do próprio Supabase; elas não passam por GRANT de
 * tabela nem por RLS, e por isso não quebram com REVOKE. Deixe-as como estão.
 */
export async function bearerDaSessao(anonKey: string): Promise<string> {
  try {
    const client = getSupabaseClient();
    const token = client ? (await client.auth.getSession()).data.session?.access_token : null;
    return token || anonKey;
  } catch {
    return anonKey;
  }
}
