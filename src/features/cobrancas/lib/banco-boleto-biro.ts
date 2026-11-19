/**
 * Banco do BOLETO da Birô (empresa 2): Inter -> C6, etapa 2 (19/11/2026).
 *
 * Mesmo desenho do PIX (lib/banco-pix-biro):
 *   - Boleto NOVO da Birô (à vista e faturado): chave de ambiente `BOLETO_BIRO`
 *     (só no servidor). Ausente ou desligada = Inter, como hoje. Ligada
 *     (1/true/sim/on/ligado/c6) = fluxo novo "BOLETO C6 BIRO - VIBE".
 *   - Título JÁ EMITIDO (cancelar, consultar, refazer, recusa): o banco sai do
 *     FORMATO do código gravado, nunca da chave. Os boletos da Birô no Inter
 *     seguem no Inter até o último. Medido em 19/11/2026 (120 dias): Inter =
 *     UUID de 36 (36 títulos e 26 cobranças da Birô); C6 = 26 caracteres sem
 *     hífen (387 títulos e 176 cobranças da Ideal e da E3).
 *
 * Sem `next/server`: roda em teste. Nada aqui é segredo.
 */
import { bancoDoCodigoPix } from "@/features/cobrancas/lib/banco-pix-biro";

export type BancoBoleto = "INTER" | "C6";

export const EMPRESA_BIRO = 2;
export const VARIAVEL_BOLETO_BIRO = "BOLETO_BIRO";
const VALORES_LIGADA = new Set(["1", "TRUE", "SIM", "ON", "LIGADO", "LIGADA", "C6"]);

const N8N = "https://10074.hostoo.net.br/webhook";

/** Fluxos de hoje (Ideal e E3 no C6; Birô no Inter). */
export const WEBHOOK_BOLETO_AVISTA_C6 = `${N8N}/boleto-avista-vibe`;
export const WEBHOOK_BOLETO_AVISTA_INTER_BIRO = `${N8N}/boleto-inter-biro`;
export const WEBHOOK_CANCELA_AVISTA_C6 = `${N8N}/del-boleto-av-vibe`;
export const WEBHOOK_CANCELA_AVISTA_INTER_BIRO = `${N8N}/cancela-boleto-inter-biro`;
export const WEBHOOK_FATURADO_C6 = `${N8N}/boletos-vibe`;
export const WEBHOOK_CANCELA_FATURADO_C6 = `${N8N}/del-boleto-vibe`;
export const WEBHOOK_CONSULTA_C6 = `${N8N}/consulta-paid-c6`;

/** Fluxo novo "BOLETO C6 BIRO - VIBE". Os chamados pelo servidor exigem o cabeçalho do segredo. */
export const WEBHOOK_BOLETO_AVISTA_BIRO_C6 = `${N8N}/boleto-avista-biro-c6`;
export const WEBHOOK_CANCELA_AVISTA_BIRO_C6 = `${N8N}/del-boleto-av-biro-c6`;
export const WEBHOOK_FATURADO_BIRO_C6 = `${N8N}/boletos-biro-c6`;
export const WEBHOOK_CANCELA_FATURADO_BIRO_C6 = `${N8N}/del-boleto-biro-c6`;
/** Chamado pelo navegador (Contas a Receber), como o consulta-paid-c6: sem segredo. */
export const WEBHOOK_CONSULTA_BIRO_C6 = `${N8N}/consulta-boleto-biro-c6`;

const ehBiro = (idEmpresa: number | string | null | undefined) => Number(idEmpresa) === EMPRESA_BIRO;

/** Boleto NOVO da Birô sai pelo C6? Padrão: não (Inter). */
export function boletoBiroNoC6(valor: string | undefined = process.env.BOLETO_BIRO): boolean {
  return VALORES_LIGADA.has(String(valor ?? "").trim().toUpperCase());
}

/** Banco de um título já emitido, pelo formato do código. `null` = sem código ou formato desconhecido. */
export function bancoDoCodigoBoleto(codigo: string | null | undefined): BancoBoleto | null {
  return bancoDoCodigoPix(codigo);
}

/**
 * Banco de um título já emitido de qualquer empresa. Ideal e E3: sempre C6.
 * Birô: pelo código; sem código ou formato desconhecido = Inter (o de antes).
 */
export function bancoDoBoletoEmitido(idEmpresa: number | string | null | undefined, codigo: string | null | undefined): BancoBoleto {
  if (!ehBiro(idEmpresa)) return "C6";
  return bancoDoCodigoBoleto(codigo) === "C6" ? "C6" : "INTER";
}

/** Título da Birô no C6 (código do C6 gravado). */
export function tituloDaBiroNoC6(idEmpresa: number | string | null | undefined, codigo: string | null | undefined): boolean {
  return ehBiro(idEmpresa) && bancoDoCodigoBoleto(codigo) === "C6";
}

// ── Boleto NOVO (decide a chave) ───────────────────────────────────────────

/** Webhook do boleto à vista NOVO. */
export function webhookBoletoAVista(idEmpresa: number | string | null | undefined, ligado: boolean = boletoBiroNoC6()): string {
  if (!ehBiro(idEmpresa)) return WEBHOOK_BOLETO_AVISTA_C6;
  return ligado ? WEBHOOK_BOLETO_AVISTA_BIRO_C6 : WEBHOOK_BOLETO_AVISTA_INTER_BIRO;
}

/**
 * O registro deste título faturado vai ao C6? Ideal e E3: sempre. Birô: só com
 * a chave ligada E sem código do Inter já gravado (título que já está no Inter
 * fica no Inter: nunca se emite o mesmo título nos dois bancos).
 */
export function registroFaturadoNoC6(
  idEmpresa: number | string | null | undefined,
  codigo: string | null | undefined,
  ligado: boolean = boletoBiroNoC6()
): boolean {
  if (!ehBiro(idEmpresa)) return true;
  if (bancoDoCodigoBoleto(codigo) === "INTER") return false;
  return ligado;
}

/** Webhook do registro do faturado NO C6 (quem decide se vai ao C6 é registroFaturadoNoC6). */
export function webhookFaturadoC6(idEmpresa: number | string | null | undefined): string {
  return ehBiro(idEmpresa) ? WEBHOOK_FATURADO_BIRO_C6 : WEBHOOK_FATURADO_C6;
}

// ── Título JÁ EMITIDO (decide o código) ────────────────────────────────────

/** Webhook do cancelamento do boleto à vista. */
export function webhookCancelaBoletoAVista(idEmpresa: number | string | null | undefined, codigo: string | null | undefined): string {
  if (!ehBiro(idEmpresa)) return WEBHOOK_CANCELA_AVISTA_C6;
  return tituloDaBiroNoC6(idEmpresa, codigo) ? WEBHOOK_CANCELA_AVISTA_BIRO_C6 : WEBHOOK_CANCELA_AVISTA_INTER_BIRO;
}

/** Webhook do cancelamento do faturado NO C6 (o da Birô no Inter tem rota própria). */
export function webhookCancelaFaturadoC6(idEmpresa: number | string | null | undefined): string {
  return ehBiro(idEmpresa) ? WEBHOOK_CANCELA_FATURADO_BIRO_C6 : WEBHOOK_CANCELA_FATURADO_C6;
}

/** Webhook da consulta de pagamento de um título do C6. Birô no Inter não tem consulta: fica no de sempre. */
export function webhookConsultaBoletoC6(idEmpresa: number | string | null | undefined, codigo: string | null | undefined): string {
  return tituloDaBiroNoC6(idEmpresa, codigo) ? WEBHOOK_CONSULTA_BIRO_C6 : WEBHOOK_CONSULTA_C6;
}

/**
 * O que a resposta do cancelamento do boleto à vista no C6 diz (Ideal, E3 e Birô no C6; 19/11/2026).
 *
 * Os fluxos (del-boleto-av-vibe e del-boleto-av-biro-c6) conferem o C6: só respondem 200 com
 * `{ success: true, cancelado: true }` quando o banco cancelou; a recusa vem como
 * 409 `{ success: false, message: "O C6 recusou o cancelamento: <motivo>" }`.
 * Aqui a regra é a mesma do PIX do C6: só cancela no Vibe com a confirmação.
 * Sem confirmação (corpo estranho, 2xx sem `cancelado: true`), NÃO cancela.
 */
export function lerCancelamentoBoletoAVistaC6(resposta: { ok: boolean; status: number; texto: string }): { cancelou: boolean; mensagem: string } {
  let corpo: Record<string, unknown> = {};
  try {
    const lido = JSON.parse(resposta.texto || "{}");
    corpo = (Array.isArray(lido) ? lido[0] : lido) ?? {};
  } catch {
    corpo = {};
  }
  if (resposta.ok && corpo.cancelado === true) return { cancelou: true, mensagem: "" };
  const doBanco = String(corpo.message ?? corpo.detalheErro ?? "").trim();
  return {
    cancelou: false,
    mensagem: doBanco
      ? `${doBanco} O boleto continua ativo: nada foi alterado no sistema.`
      : "O banco não confirmou o cancelamento do boleto. O boleto continua ativo: nada foi alterado no sistema."
  };
}

/** Os webhooks do fluxo novo da Birô chamados pelo servidor exigem o cabeçalho do segredo. */
export function webhookDaBiroC6ComSegredo(url: string): boolean {
  return [WEBHOOK_BOLETO_AVISTA_BIRO_C6, WEBHOOK_CANCELA_AVISTA_BIRO_C6, WEBHOOK_FATURADO_BIRO_C6, WEBHOOK_CANCELA_FATURADO_BIRO_C6].includes(url);
}
