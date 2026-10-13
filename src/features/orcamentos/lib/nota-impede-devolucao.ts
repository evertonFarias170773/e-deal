import { isNotaImpeditiva, type NotaParaElegibilidade } from "@/features/cobrancas/cancelamento-elegibilidade";

/**
 * NOTA EMITIDA TRAVA A VOLTA AO ATENDENTE (13/10/2026) — a regra, em um lugar so.
 *
 * Pedido com nota fiscal emitida nao volta para REVISAO ATENDENTE enquanto a nota
 * nao for cancelada. Vale para as duas portas de volta: "Retirar da Producao" e
 * "Voltar para Revisao Atendente" (tela Producao).
 *
 * "EMITIDA" = a MESMA definicao que ja recusa cancelar cobranca com nota
 * (`isNotaImpeditiva`): status AUTORIZADA e ambiente de PRODUCAO, NF-e (venda ou
 * remessa) ou NFS-e. Cancelada, com erro, pendente, em processamento e toda nota de
 * homologacao NAO travam. Basta UMA nota emitida para travar; com todas canceladas a
 * acao segue o fluxo normal.
 *
 * A trava de verdade e a do servidor (`services/nota-impede-devolucao.server.ts`).
 * A tela so desliga o item, com o motivo.
 */

export const CODIGO_NOTA_EMITIDA = "NOTA_EMITIDA";
export const CODIGO_LEITURA_NOTAS_FALHOU = "LEITURA_NOTAS_FALHOU";

export type NotaDoPedido = NotaParaElegibilidade;

/** As notas que travam a devolucao, na ordem em que vieram. */
export function notasQueImpedemDevolucao(notas: readonly NotaDoPedido[]): NotaDoPedido[] {
  return notas.filter(isNotaImpeditiva);
}

/** "NF-e 1234", "NFS-e 12" ou, sem numero gravado, "NF-e sem número". */
export function rotuloDaNota(nota: NotaDoPedido): string {
  const tipo = nota.tipo === "NFSE" ? "NFS-e" : "NF-e";
  const numero = String(nota.numero ?? "").trim();
  return numero ? `${tipo} ${numero}` : `${tipo} sem número`;
}

function emLista(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * A recusa, dizendo QUAL nota trava. `null` quando nenhuma trava. Recebe as notas do
 * pedido como vieram do banco: quem filtra e esta funcao.
 */
export function mensagemNotaImpedeDevolucao(notas: readonly NotaDoPedido[]): string | null {
  const impeditivas = notasQueImpedemDevolucao(notas);
  if (impeditivas.length === 0) return null;
  const rotulos = Array.from(new Set(impeditivas.map(rotuloDaNota)));
  const plural = impeditivas.length > 1;
  return `Este pedido tem nota fiscal emitida (${emLista(rotulos)}). Cancele ${plural ? "as notas" : "a nota"} antes de devolvê-lo ao atendente.`;
}
