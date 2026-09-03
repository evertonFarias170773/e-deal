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
/**
 * O token da sessão, ou `null` quando não há.
 *
 * É a forma ESTRITA: quem precisa saber que não há sessão usa esta e decide o
 * que fazer. `bearerDaSessao` continua existindo para os sete pontos REST de
 * navegador que já a usam, e não mudou de contrato.
 */
export async function tokenDaSessao(): Promise<string | null> {
  try {
    const client = getSupabaseClient();
    return client ? ((await client.auth.getSession()).data.session?.access_token ?? null) : null;
  } catch {
    return null;
  }
}

export async function bearerDaSessao(anonKey: string): Promise<string> {
  const token = await tokenDaSessao();
  if (token) return token;

  /**
   * O fallback continua — tirá-lo quebraria os sete pontos REST em qualquer
   * contexto sem sessão, e em tabela ainda aberta ao `anon` eles funcionam.
   *
   * O que ele NÃO faz mais é cair calado. Este aviso é o rastro que faltou em
   * 03/09/2026, quando a checagem de duplicidade de cadastro rodou no servidor,
   * caiu aqui, tomou 401 em `clientes` e o nulo foi lido como "sem conflito" —
   * a trava ficou desligada sem nada aparecer em lugar nenhum.
   *
   * Se este aviso aparecer num log de SERVIDOR, o caminho está errado: ali a
   * correção é injetar o client autenticado, não confiar no fallback.
   */
  console.warn(
    "[supabase] Chamada REST sem sessão: usando a anon key. " +
      "Em tabela fechada ao anon isto volta 401. " +
      "Se este caminho roda no servidor, injete o client autenticado em vez de depender deste fallback."
  );
  return anonKey;
}
