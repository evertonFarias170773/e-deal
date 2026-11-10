/**
 * Por que o banco recusou excluir um produto da proposta (10/11/2026, 24985).
 *
 * Apagar `produtos_proposta` apaga em cascata os modelos (`pedidos_modelos`),
 * e o gatilho `carimba_status_impressao_em` recusa apagar modelo marcado como
 * impresso (23514, "Modelo impresso: o registro de impressao e permanente...").
 * Item de prateleira nasce assim: a aprovação automática da prateleira aprova
 * a arte e marca IMPRESSO na mesma gravação. A tela dizia só "Tente novamente",
 * e tentar de novo nunca resolve.
 *
 * Esta função só traduz: não decide nada nem libera a exclusão.
 */

export type ErroDoBanco = { code?: string | null; message?: string | null } | null | undefined;

export const MOTIVO_MODELO_IMPRESSO =
  "O produto não pode ser excluído: o modelo dele já está marcado como impresso, e o registro de impressão é permanente.";

export function motivoDaExclusaoRecusada(erro: ErroDoBanco): string {
  const msg = String(erro?.message ?? "").trim();
  const code = String(erro?.code ?? "").trim();
  if (/modelo impresso/i.test(msg)) return MOTIVO_MODELO_IMPRESSO;
  if (code === "42501") return "Você não tem permissão para excluir este produto.";
  // Recusa escrita por gatilho ou regra do banco: a mensagem é o motivo.
  if ((code === "23514" || code === "P0001") && msg) return `O banco recusou a exclusão: ${msg}`;
  if (code === "23503") return "O produto não pode ser excluído: há registros ligados a ele.";
  return msg
    ? `Não foi possível remover o produto (${msg}).`
    : "Não foi possível remover o produto. Tente novamente.";
}
