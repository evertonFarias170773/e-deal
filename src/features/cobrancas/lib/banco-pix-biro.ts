/**
 * Banco do PIX da Birô (empresa 2): Inter -> C6, etapa 1 (18/11/2026).
 *
 * A Birô troca o Inter pelo C6. Os fluxos do C6 da Birô são NOVOS e separados
 * (n8n "PIX C6 BIRO - VIBE" e "NOTIFICA-C6 PIX - BIRO"); o PIX GERAL - VIBE não muda.
 *
 * DUAS PERGUNTAS DIFERENTES, DUAS RESPOSTAS DIFERENTES
 *   - Por onde sai um PIX NOVO da Birô? A chave de ambiente `BANCO_BIRO`
 *     ("INTER" ou "C6"; ausente ou qualquer outro valor = "INTER"). Sem
 *     migration: trocar a chave na Vercel é o que liga o C6.
 *   - Em que banco está um PIX JÁ EMITIDO (para cancelar ou consultar)? O
 *     FORMATO do código gravado em `cod_solicitacao_inter`, nunca a chave: os
 *     títulos da Birô no Inter seguem no Inter até o último, mesmo depois da
 *     troca. Medido em 18/11/2026 nos PIX dos últimos 120 dias: Inter = UUID
 *     (36, com hífens) nos 918 da Birô; C6 = txid alfanumérico de 35 nos 3.594
 *     da Ideal e da E3.
 *
 * Sem `next/server`: roda em teste.
 */

export type BancoPix = "INTER" | "C6";

export const EMPRESA_BIRO = 2;

/** Nome da variável de ambiente (Vercel e `.env.local`). Só no servidor. */
export const VARIAVEL_BANCO_BIRO = "BANCO_BIRO";

/** Webhooks do fluxo novo "PIX C6 BIRO - VIBE" (exigem o cabeçalho do segredo). */
const N8N = "https://10074.hostoo.net.br/webhook";
export const WEBHOOK_GERA_PIX_BIRO_C6 = `${N8N}/vibe-biro-c6`;
export const WEBHOOK_CANCELA_PIX_BIRO_C6 = `${N8N}/del-pix-biro-c6`;
export const WEBHOOK_CONSULTA_PIX_BIRO_C6 = `${N8N}/consulta-pix-biro-c6`;

/** Banco por onde sai um PIX NOVO da Birô. Padrão INTER. */
export function bancoDoPixNovoDaBiro(ambiente: Record<string, string | undefined> = process.env): BancoPix {
  return String(ambiente[VARIAVEL_BANCO_BIRO] ?? "").trim().toUpperCase() === "C6" ? "C6" : "INTER";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TXID_C6 = /^[A-Za-z0-9]{26,35}$/;

/** Banco de um PIX já emitido, pelo formato do código. `null` = formato desconhecido. */
export function bancoDoCodigoPix(codigo: string | null | undefined): BancoPix | null {
  const c = String(codigo ?? "").trim();
  if (UUID.test(c)) return "INTER";
  if (TXID_C6.test(c)) return "C6";
  return null;
}

/**
 * Banco de um PIX já emitido de qualquer empresa. Ideal (1) e E3 (3) são sempre
 * C6. Birô (2): pelo código; código em formato desconhecido fica no Inter, que é
 * o comportamento de antes desta etapa.
 */
export function bancoDoPixEmitido(idEmpresa: number | null | undefined, codigo: string | null | undefined): BancoPix {
  if (Number(idEmpresa) !== EMPRESA_BIRO) return "C6";
  return bancoDoCodigoPix(codigo) === "C6" ? "C6" : "INTER";
}
