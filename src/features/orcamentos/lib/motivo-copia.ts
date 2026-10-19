/**
 * MOTIVO DA CÓPIA (19/10/2026) — "Duplicar proposta" pergunta: Duplicação ou Retrabalho?
 *
 * O banco grava a escolha em `propostas.motivo_copia` dentro de
 * `copiar_proposta_v2(p_id_int_origem, p_motivo)` (migration
 * 20261019_propostas_motivo_copia). O motivo é FIXO: não existe caminho para
 * trocá-lo depois.
 *
 *   - DUPLICACAO: a cópia de sempre. Proposta que já é cópia não pode ser
 *     duplicada (o banco recusa).
 *   - RETRABALHO: pode partir de uma cópia. `id_int_origem_copia` aponta para o
 *     pedido duplicado (o imediatamente anterior, nunca o primeiro da cadeia) e a
 *     orientação técnica começa com "Retrabalho do pedido #X". Continua exigindo a
 *     cobrança E-RETRABALHO e fica fora do faturamento (lib/retrabalho.ts).
 *
 * Sem imports de propósito: roda no navegador e no teste do Node, igual.
 */

export const MOTIVOS_DA_COPIA = ["DUPLICACAO", "RETRABALHO"] as const;
export type MotivoDaCopia = (typeof MOTIVOS_DA_COPIA)[number];

export function ehMotivoDaCopia(valor: unknown): valor is MotivoDaCopia {
  return typeof valor === "string" && (MOTIVOS_DA_COPIA as readonly string[]).includes(valor);
}

/**
 * O que o modal oferece. Pedido que já é cópia só aceita Retrabalho. Quando não
 * deu para saber (`null`), as duas aparecem e quem decide é o banco.
 */
export function motivosPermitidos(ehCopia: boolean | null): MotivoDaCopia[] {
  return ehCopia === true ? ["RETRABALHO"] : [...MOTIVOS_DA_COPIA];
}

export const ROTULO_DO_MOTIVO: Record<MotivoDaCopia, string> = {
  DUPLICACAO: "Duplicação",
  RETRABALHO: "Retrabalho"
};

/** As duas mensagens de sistema do chat: na proposta de origem e na nova. */
export function mensagensDaCopia(
  motivo: MotivoDaCopia,
  idIntOrigem: number,
  novoIdInt: number
): { naOrigem: string; naNova: string } {
  if (motivo === "RETRABALHO") {
    return {
      naOrigem: `Retrabalho gerado: pedido #${novoIdInt}.`,
      naNova: `Retrabalho do pedido #${idIntOrigem}.`
    };
  }
  return {
    naOrigem: `Proposta duplicada. Nova proposta gerada: #${novoIdInt}.`,
    naNova: `Proposta duplicada a partir da proposta #${idIntOrigem}.`
  };
}
