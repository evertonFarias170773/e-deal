/**
 * Lista de Pedidos: o que o selo do STATUS DO PEDIDO mostra.
 *
 * 1. SEM O COMPLEMENTO DE ARTE (10/10/2026). O rótulo do status chega com
 *    " / EM ARTE" ou " / Arte aprovada" (`getStatusLabel`, em mappers). Na lista
 *    isso é redundante: a tabela tem a coluna Status Arte, e o cartão passou a
 *    mostrar o mesmo selo de arte. O complemento sai SÓ AQUI, na exibição —
 *    `getStatusLabel` e `composeStatusEmArte` não mudam, porque o Maestro, a
 *    tela da proposta e a produção usam os dois.
 *
 * 2. "AGUARDANDO" SOME QUANDO O PEDIDO ESTÁ PAGO A CONFERIR. Os dois selos
 *    juntos — "Aguardando" e "Pago / A liberar" — diziam coisas opostas na
 *    mesma linha. A condição é a MESMA que acende "Pago / A liberar"
 *    (`pagoAConfirmar`, calculada no servidor da lista). Como o complemento de
 *    arte não aparece mais no selo, não há exceção: "Aguardando / Arte
 *    aprovada" e "Aguardando / EM ARTE" também são só "Aguardando" aqui.
 *
 * O status gravado não muda: é só a exibição.
 */
export const ROTULO_AGUARDANDO = "Aguardando";

const COMPLEMENTO_DE_ARTE = /\s*\/\s*(em arte|arte aprovada)\s*$/i;

/** O rótulo do status do pedido, sem " / EM ARTE" nem " / Arte aprovada". */
export function statusDoPedidoSemArte(statusLabel: string | null | undefined): string {
  return String(statusLabel ?? "").replace(COMPLEMENTO_DE_ARTE, "").trim();
}

export function mostraSeloDoStatusNaLista(statusLabel: string | null | undefined, pagoAConfirmar: boolean): boolean {
  if (!pagoAConfirmar) return true;
  return statusDoPedidoSemArte(statusLabel) !== ROTULO_AGUARDANDO;
}
