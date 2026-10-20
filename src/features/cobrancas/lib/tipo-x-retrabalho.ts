/**
 * E-RETRABALHO x PEDIDO DE RETRABALHO (20/10/2026) — espelho do gatilho
 * `trg_pgv2_tipo_x_motivo_copia` (migration 20261020_pagamentos_v2_tipo_x_motivo_copia).
 *
 * QUEM MANDA E O BANCO: o gatilho recusa em toda porta (tela, area do cliente,
 * pagamento-combinado, usar-credito). Este arquivo so serve para a tela nao
 * oferecer o que o banco vai recusar e para as rotas devolverem a mensagem do
 * gatilho limpa, antes de qualquer efeito.
 *
 *   1. E-RETRABALHO so em pedido com `propostas.motivo_copia = RETRABALHO`, ou em
 *      pedido que JA TEVE uma E-RETRABALHO (qualquer status): os retrabalhos
 *      antigos, sem motivo gravado.
 *   2. Pedido com motivo RETRABALHO so aceita E-RETRABALHO. Pedido antigo (motivo
 *      vazio) que ja teve E-RETRABALHO segue livre para as outras formas.
 *
 * Sem imports de proposito: roda no navegador, no servidor e no teste do Node.
 */

export const MENSAGEM_E_RETRABALHO_FORA_DE_RETRABALHO = "E-Retrabalho só pode ser usado em pedido criado como Retrabalho";
export const MENSAGEM_OUTRO_TIPO_EM_RETRABALHO = "Pedido de retrabalho só aceita cobrança E-Retrabalho";

export type ContextoRetrabalhoDoPedido = {
  /** `propostas.motivo_copia`: DUPLICACAO, RETRABALHO ou nulo. */
  motivoCopia: string | null;
  /** O pedido tem (ou teve, mesmo cancelada) alguma cobranca E-RETRABALHO. */
  jaTeveRetrabalho: boolean;
};

const normalizar = (tipo: unknown) => String(tipo ?? "").trim().toUpperCase();

/** A mensagem que o gatilho daria para este tipo neste pedido, ou `null` se passa. */
export function recusaDoTipoNoPedido(tipo: unknown, contexto: ContextoRetrabalhoDoPedido): string | null {
  const ehRetrabalho = normalizar(contexto.motivoCopia) === "RETRABALHO";
  if (normalizar(tipo) === "E-RETRABALHO") {
    return ehRetrabalho || contexto.jaTeveRetrabalho ? null : MENSAGEM_E_RETRABALHO_FORA_DE_RETRABALHO;
  }
  return ehRetrabalho ? MENSAGEM_OUTRO_TIPO_EM_RETRABALHO : null;
}

/**
 * A tela mostra a forma? Enquanto o contexto nao chegou (`null`), so esconde a
 * E-RETRABALHO: e o caso raro, e o banco recusa o resto se for retrabalho.
 */
export function tipoApareceNoPedido(tipo: unknown, contexto: ContextoRetrabalhoDoPedido | null): boolean {
  if (!contexto) return normalizar(tipo) !== "E-RETRABALHO";
  return recusaDoTipoNoPedido(tipo, contexto) === null;
}

/** O erro do banco e a recusa do gatilho? Devolve a mensagem limpa, ou `null`. */
export function recusaDoGatilhoNoErro(mensagemDeErro: unknown): string | null {
  const texto = String(mensagemDeErro ?? "");
  if (texto.includes(MENSAGEM_E_RETRABALHO_FORA_DE_RETRABALHO)) return MENSAGEM_E_RETRABALHO_FORA_DE_RETRABALHO;
  if (texto.includes(MENSAGEM_OUTRO_TIPO_EM_RETRABALHO)) return MENSAGEM_OUTRO_TIPO_EM_RETRABALHO;
  return null;
}
