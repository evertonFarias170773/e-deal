/**
 * Lista de Pedidos: o selo do status some quando ele é só "Aguardando" e o
 * pedido já está pago, esperando a conferência (10/10/2026).
 *
 * Os dois selos juntos — "Aguardando" e "Pago / A liberar" — diziam coisas
 * opostas na mesma linha. O status gravado não muda: é só a exibição. A
 * condição é a MESMA que acende "Pago / A liberar" (`pagoAConfirmar`, calculada
 * no servidor da lista); não há critério novo.
 *
 * Só o "Aguardando" puro some. "Aguardando / Arte aprovada" e
 * "Aguardando / EM ARTE" continuam: eles dizem em que ponto está a arte, e
 * isso o "Pago / A liberar" não diz. Qualquer outro status também continua.
 */
export const ROTULO_AGUARDANDO = "Aguardando";

export function mostraSeloDoStatusNaLista(statusLabel: string | null | undefined, pagoAConfirmar: boolean): boolean {
  if (!pagoAConfirmar) return true;
  return String(statusLabel ?? "").trim() !== ROTULO_AGUARDANDO;
}
