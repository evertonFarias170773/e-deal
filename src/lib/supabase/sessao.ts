import { getSupabaseClient } from "./client";

/**
 * Token de sessão para chamadas às rotas /api do próprio ERP.
 *
 * PROBLEMA QUE ISTO RESOLVE
 *   O padrão espalhado pelo app era `getSession()` → pega `access_token` →
 *   manda no header. `getSession()` devolve o que está GUARDADO no navegador;
 *   isso não é prova de que o servidor ainda aceita aquele token. Quando o
 *   token morria, o front só descobria pelo 401 — e não tratava o 401 em
 *   lugar nenhum. O usuário recebia "Sessão inválida" num modal com botão
 *   "Entendi" e ficava preso, sem nem ser informado de que bastava entrar de
 *   novo.
 *
 *   Medido em 12/08/2026, proposta #20522: E-Crédito de R$ 145,00 recusado
 *   com "Sessão inválida" tendo o crédito íntegro no cadastro. O log de
 *   auth mostra a mesma conta fazendo login duas vezes em menos de uma hora
 *   — o usuário contornando na mão o que a tela não resolvia.
 *
 * POR QUE O TOKEN MORRE SEM AVISO
 *   Não existe `middleware.ts` neste projeto. Com `@supabase/ssr` a sessão
 *   fica em cookie, e a renovação depende INTEIRAMENTE do timer do
 *   `autoRefreshToken` na aba aberta. Aba em segundo plano por mais de uma
 *   hora, máquina suspensa, ou duas abas competindo pela rotação do refresh
 *   token e o timer não entrega. Nada no servidor corrige depois.
 *
 * POR QUE REPETIR APÓS 401 É SEGURO
 *   Nas rotas deste app a validação do JWT é o PRIMEIRO passo, antes de
 *   qualquer leitura ou escrita. Um 401 significa que o servidor não fez
 *   absolutamente nada — não criou pagamento, não consumiu crédito, não
 *   chamou provedor. Repetir com token novo não duplica efeito. As rotas de
 *   crédito ainda carregam chave de idempotência por cima disso.
 */

/**
 * Renova quando falta menos que isto para expirar. Cobre o caso comum: tela
 * aberta há tempo, usuário clica com o token na reta final e ele expira
 * entre o clique e a chegada no servidor.
 */
const MARGEM_EXPIRACAO_SEGUNDOS = 120;

/** Sessão acabou e não foi possível renovar. Exige novo login — não é erro de negócio. */
export class SessaoExpiradaError extends Error {
  constructor(mensagem = "Sua sessão expirou. Entre novamente para continuar.") {
    super(mensagem);
    this.name = "SessaoExpiradaError";
  }
}

/**
 * Access token pronto para uso, renovado quando perto de expirar.
 * Retorna null quando não há sessão utilizável.
 */
export async function obterAccessToken(opcoes?: { forcarRenovacao?: boolean }): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  if (opcoes?.forcarRenovacao) {
    const { data, error } = await client.auth.refreshSession();
    if (error) {
      console.warn("[sessao] Falha ao renovar a sessão:", error.message);
      return null;
    }
    return data.session?.access_token ?? null;
  }

  const { data: { session } } = await client.auth.getSession();
  if (!session) return null;

  const agora = Math.floor(Date.now() / 1000);
  const expiraEm = typeof session.expires_at === "number" ? session.expires_at : 0;
  const perigoDeExpirar = !expiraEm || expiraEm - agora <= MARGEM_EXPIRACAO_SEGUNDOS;
  if (!perigoDeExpirar) return session.access_token;

  const { data, error } = await client.auth.refreshSession();
  if (error) {
    // Renovação falhou, mas o token atual pode ainda ser aceito. Quem decide
    // é o servidor: devolvemos o que temos e o 401, se vier, aciona o retry.
    console.warn("[sessao] Renovação preventiva falhou, seguindo com o token atual:", error.message);
    return session.access_token;
  }
  return data.session?.access_token ?? session.access_token;
}

/**
 * `fetch` para as rotas /api deste app, com Authorization preenchido.
 * Em 401, renova a sessão UMA vez e repete. Persistindo o 401, lança
 * SessaoExpiradaError para a tela pedir novo login em vez de mostrar um
 * beco sem saída.
 */
export async function fetchComSessao(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await obterAccessToken();
  if (!token) throw new SessaoExpiradaError();

  const comAutorizacao = (valor: string): RequestInit => ({
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${valor}` },
  });

  const primeira = await fetch(url, comAutorizacao(token));
  if (primeira.status !== 401) return primeira;

  console.warn(`[sessao] 401 em ${url} — renovando a sessão e repetindo uma vez.`);
  const tokenRenovado = await obterAccessToken({ forcarRenovacao: true });
  if (!tokenRenovado) throw new SessaoExpiradaError();

  const segunda = await fetch(url, comAutorizacao(tokenRenovado));
  if (segunda.status === 401) throw new SessaoExpiradaError();
  return segunda;
}
