/**
 * Cartão C6 da Birô (empresa 2), etapa 3 (19/11/2026).
 *
 * A Birô nunca teve cartão. Passa a ter o cartão do C6, com as mesmas regras
 * do da Ideal (as parcelas e as taxas vêm da tabela única da página pública
 * `pagamento-publico`). O Asaas continua só da Ideal (empresa 1).
 *
 * Chave `CARTAO_BIRO` (Vercel e `.env.local`; e, separada, nos segredos da Edge
 * `pagamento-publico`): ausente ou qualquer valor fora de 1/true/sim/on/ligado/c6
 * = DESLIGADA, e tudo fica como antes (cartão só para 1 e 3).
 *
 * A chave chega à tela pelo `env` do `next.config.ts` (inlinada no build): trocar
 * o valor exige novo deploy, como a `BANCO_BIRO`. Não é segredo.
 *
 * Sem `next/server`: roda em teste.
 */

export const VARIAVEL_CARTAO_BIRO = "CARTAO_BIRO";

/** Única empresa com o Cartão Asaas (segunda opção do vendedor). */
export const EMPRESA_CARTAO_ASAAS = 1;

const EMPRESA_BIRO = 2;
const VALORES_LIGADA = new Set(["1", "TRUE", "SIM", "ON", "LIGADO", "LIGADA", "C6"]);

/** A chave está ligada? `process.env.CARTAO_BIRO` escrito por extenso para o Next inlinar. */
export function cartaoBiroLigado(valor: string | undefined = process.env.CARTAO_BIRO): boolean {
  return VALORES_LIGADA.has(String(valor ?? "").trim().toUpperCase());
}

/** A empresa oferece o cartão do C6? 1 e 3 sempre; 2 só com a chave ligada. */
export function empresaTemCartaoC6(idEmpresa: number | string | null | undefined, ligado: boolean = cartaoBiroLigado()): boolean {
  const id = Number(idEmpresa);
  return id === 1 || id === 3 || (id === EMPRESA_BIRO && ligado);
}

const N8N = "https://10074.hostoo.net.br/webhook";
/** Cancelamento do cartão C6 da Ideal e da E3 (fluxo CARTAO C6 - IDEAL - E3 VIBE). */
export const WEBHOOK_CANCELA_CARTAO_C6 = `${N8N}/cancela-cartao-c6-vibe`;
/** Cancelamento do cartão C6 da Birô (fluxo CARTAO C6 - BIRO; exige o cabeçalho do segredo). */
export const WEBHOOK_CANCELA_CARTAO_BIRO_C6 = `${N8N}/cancela-cartao-c6-biro`;

/** Webhook que cancela o checkout do C6 desta empresa. */
export function webhookCancelaCartaoC6(idEmpresa: number | string | null | undefined): string {
  return Number(idEmpresa) === EMPRESA_BIRO ? WEBHOOK_CANCELA_CARTAO_BIRO_C6 : WEBHOOK_CANCELA_CARTAO_C6;
}
