/**
 * Webhook do n8n que cria o checkout do cartão C6, por empresa (19/11/2026).
 *
 * Ideal (1) e E3 (3) como sempre. Birô (2) só com o segredo CARTAO_BIRO da Edge
 * ligado: mesma regra de `src/features/cobrancas/lib/cartao-biro.ts` no Vibe
 * (repetida aqui porque a Edge não importa do src). Desligado, a Birô segue sem
 * webhook e a página responde "Webhook da empresa não configurado.", como antes.
 *
 * Sem dependência de Deno: roda em teste no Node.
 */

const N8N = "https://10074.hostoo.net.br/webhook";
const VALORES_LIGADA = new Set(["1", "TRUE", "SIM", "ON", "LIGADO", "LIGADA", "C6"]);

export function cartaoBiroLigado(valor: string | null | undefined): boolean {
  return VALORES_LIGADA.has(String(valor ?? "").trim().toUpperCase());
}

export function webhookCartaoPorEmpresa(idEmpresa: number, cartaoBiro: string | null | undefined): string {
  const porEmpresa: Record<number, string> = {
    1: `${N8N}/card-ideal-c6`,
    3: `${N8N}/card-e3-c6`,
  };
  if (cartaoBiroLigado(cartaoBiro)) porEmpresa[2] = `${N8N}/card-biro-c6`;
  return porEmpresa[idEmpresa] || "";
}
