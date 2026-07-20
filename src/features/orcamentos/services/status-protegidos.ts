/**
 * Status de proposta que representam vínculo operacional ativo
 * (arte aprovada, produção, expedição ou entrega).
 *
 * Propostas nesses status NÃO podem ter o status_interno revertido
 * automaticamente ao cancelar cobranças, nem ser canceladas sem antes
 * resolver o vínculo pelo fluxo próprio (ex.: "Retirar da Produção").
 *
 * Fonte: docs/business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md e
 * docs/business/CANCELAMENTO-COBRANCAS.md (reversão de status).
 */
export const PROPOSTA_STATUS_PROTEGIDOS = [
  "APROVADO", "APROVADO / EM ARTE", // legado — engine não grava mais este valor
  "LIBERADO", "LIBERADO / EM ARTE",
  "REVISAO ATENDENTE", "REVISAO PRODUCAO",
  "EM PRODUCAO", "EM IMPRESSAO", "EM ACABAMENTO",
  "EXPEDICAO", "A RETIRAR", "EM TRANSITO", "ENTREGUE"
] as const;

export function isPropostaStatusProtegido(status: string | null | undefined): boolean {
  const normalized = String(status || "").trim().toUpperCase();
  return (PROPOSTA_STATUS_PROTEGIDOS as readonly string[]).includes(normalized);
}
