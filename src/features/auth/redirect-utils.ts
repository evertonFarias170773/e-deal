/**
 * Sanitização do destino pós-login (?next=) — compartilhada por LoginForm,
 * AuthGuard e pelo callback OAuth. Evita Open Redirect: aceita apenas paths
 * internos com prefixo permitido; qualquer outra coisa cai no fallback.
 */

const ALLOWED_NEXT_PREFIXES = [
  "/pedidos",
  "/orcamentos",
  "/dashboard",
  "/meu-desempenho",
  "/atualizar-senha",
  "/boas-vindas",
  // 21/08/2026: destinos da regra de pagina inicial por perfil (abaixo).
  "/cobrancas",
  "/expedicao"
];

const FALLBACK = "/dashboard";

export function sanitizeInternalNext(raw: string | null | undefined): string {
  if (!raw) return FALLBACK;
  const value = raw.trim();

  // Apenas path interno: exatamente uma "/" inicial, sem esquema, backslash ou host.
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes(":")) {
    return FALLBACK;
  }

  const permitido = ALLOWED_NEXT_PREFIXES.some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`)
  );

  return permitido ? value : FALLBACK;
}

// ---------------------------------------------------------------------------
// Pagina inicial por perfil (21/08/2026)
// ---------------------------------------------------------------------------

/**
 * Onde cada perfil cai depois de entrar, quando NAO ha `?next=`.
 *
 * A REGRA
 *   vendedor                -> /orcamentos   (o trabalho dele comeca ali)
 *   expedidor               -> /expedicao
 *   quem tem conferencia.view -> /cobrancas
 *   os demais               -> /orcamentos
 *
 * POR QUE O PADRAO NAO E A CONFERENCIA
 *   Seria o natural — a Conferencia e o item 1 do menu. Mas `/cobrancas` e
 *   guardada por `conferencia.view` (PermissionGuard na propria rota), e os
 *   perfis Designer, operador e producao NAO tem essa permissao. Manda-los para
 *   la os jogaria em "Acesso negado" no primeiro segundo de sessao. Medido em
 *   21/08/2026: cinco usuarios Designer em producao cairiam nisso.
 *
 *   `/orcamentos` e o unico destino do menu que nao tem guard nenhum — nem na
 *   rota, nem dentro da tela —, entao serve de piso para todo mundo. Ninguem
 *   ganha permissao para esta regra funcionar, que era a condicao.
 *
 * `/expedicao` se defende sozinha por `expedicao.view` dentro da tela, e o
 * perfil Expedidor nasce com essa permissao — por isso o destino dele e seguro.
 */
export const DESTINO_VENDEDOR = "/orcamentos";
export const DESTINO_EXPEDIDOR = "/expedicao";
export const DESTINO_CONFERENCIA = "/cobrancas";
export const DESTINO_PADRAO = "/orcamentos";

/** O minimo que a regra precisa saber do usuario. */
export type PerfilParaDestino = {
  perfilSlug?: string | null;
  permissoes?: string[] | null;
  isSeller?: boolean;
};

/** `["*"]` do super admin vale por qualquer permissao. */
function temPermissao(perfil: PerfilParaDestino, codigo: string): boolean {
  const lista = perfil.permissoes ?? [];
  return lista.includes("*") || lista.includes(codigo);
}

export function destinoPorPerfil(perfil: PerfilParaDestino | null | undefined): string {
  if (!perfil) return DESTINO_PADRAO;

  const slug = (perfil.perfilSlug ?? "").toLowerCase();
  if (slug === "vendedor" || perfil.isSeller) return DESTINO_VENDEDOR;
  if (slug === "expedidor") return DESTINO_EXPEDIDOR;
  if (temPermissao(perfil, "conferencia.view")) return DESTINO_CONFERENCIA;

  return DESTINO_PADRAO;
}

/**
 * Destino final do login: `?next=` explicito vence a regra de perfil, sempre —
 * e o que preserva deep-link (OS aberta por QR Code, link de proposta colado no
 * chat) e o retorno depois de um redirecionamento do AuthGuard.
 */
export function destinoPosLogin(
  nextParam: string | null | undefined,
  perfil: PerfilParaDestino | null | undefined
): string {
  if (nextParam && nextParam.trim()) {
    const destino = sanitizeInternalNext(nextParam);
    // `sanitizeInternalNext` devolve o FALLBACK quando o next e invalido; nesse
    // caso ele nao foi uma escolha do usuario, e a regra de perfil volta a valer.
    if (destino !== FALLBACK) return destino;
  }

  return destinoPorPerfil(perfil);
}
