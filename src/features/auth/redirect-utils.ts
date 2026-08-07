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
  "/boas-vindas"
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
