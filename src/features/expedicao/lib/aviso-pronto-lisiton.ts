/**
 * "Pedido pronto" da Lisiton para TODAS as conversas do pedido (27/11/2026,
 * decisão do Everton).
 *
 * A Edge do ChatGuru (expedicao-pedido-pronto) manda o aviso para a conversa
 * principal do pedido, a não ser que a tela mande `chat_ids`: aí vai para essas
 * conversas, conferidas contra as do cliente no Guru. Para o cliente 8469
 * (Lisiton) a tela manda as conversas gravadas no pedido
 * (propostas_contatos_chatguru) — hoje as duas: Lisiane (principal) e Everton.
 * Os outros clientes continuam como estão: só a principal (ou a escolha da tela).
 * A Edge não muda.
 */

export const ID_CLIENTE_AVISO_TODAS_AS_CONVERSAS = 8469;

export function avisoVaiParaTodasAsConversas(idCliente: number | null | undefined): boolean {
  return Number(idCliente) === ID_CLIENTE_AVISO_TODAS_AS_CONVERSAS;
}

/**
 * A seleção que a tela manda à Edge. Lisiton com conversas gravadas: todas elas.
 * Senão, a escolha da tela quando a Edge pediu escolha; senão nada (a principal).
 */
export function selecaoDoAvisoPronto(opcoes: {
  idCliente: number | null | undefined;
  conversasDoPedido: readonly string[];
  edgePediuEscolha: boolean;
  selecionadasNaTela: readonly string[];
}): { chatIds: string[] } | undefined {
  if (avisoVaiParaTodasAsConversas(opcoes.idCliente) && opcoes.conversasDoPedido.length > 0) {
    return { chatIds: [...new Set(opcoes.conversasDoPedido)] };
  }
  return opcoes.edgePediuEscolha ? { chatIds: [...opcoes.selecionadasNaTela] } : undefined;
}
