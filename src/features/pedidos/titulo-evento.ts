/**
 * Título do evento do pedido — fonte única (lista de OS e boletim).
 *
 * A fonte é `pedidos_artes.nome_evento`, preenchida no briefing de artes. A
 * lista vinha caindo no nome do LOTE (`pedidos_modelos.nome_modelo`) quando o
 * evento estava vazio, e por isso mostrava coisas como "Lote Principal" ou
 * "CAMAROTE" no lugar do evento.
 *
 * Ressalva de prateleira: pedido só com produto de prateleira não tem evento —
 * nesse caso vale o nome do produto, e com mais de um os nomes vão separados
 * por " / ".
 */

export const TITULO_EVENTO_VAZIO = "Evento não informado";

export interface ItemDoPedidoParaTitulo {
  nome: string | null | undefined;
  isPrateleira: boolean;
}

/**
 * `nomeEvento` deve ser o do PRIMEIRO boletim do pedido (o mais antigo): os
 * boletins de setor nascem depois e só o primeiro carrega o briefing.
 */
export function tituloEventoDoPedido(
  nomeEvento: string | null | undefined,
  itens: ItemDoPedidoParaTitulo[]
): string {
  const evento = (nomeEvento || "").trim();
  if (evento) return evento;

  const ativos = itens.filter((i) => (i.nome || "").trim() !== "");
  if (ativos.length > 0 && ativos.every((i) => i.isPrateleira)) {
    const nomes = Array.from(new Set(ativos.map((i) => (i.nome as string).trim())));
    return nomes.join(" / ");
  }

  return TITULO_EVENTO_VAZIO;
}
