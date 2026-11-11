/**
 * Comprador da arte: o que continua valendo da regra de 06/11/2026.
 *
 * Desde 10/11/2026 o Comprador é uma conversa do WhatsApp (ChatGuru) do cliente,
 * regra em lib/conversa-whatsapp. Até então era um contato com cargo Comprador
 * (nome, fone e e-mail) gravado em `propostas.id_contato`; esse caminho saiu, e o
 * Contato responsável da aba Geral voltou a ser só do cadastro.
 *
 * Fica aqui o corte do primeiro envio: pedido que já foi enviado para a arte não
 * é travado.
 */

/**
 * Arte ainda não enviada: sem linha em `pedidos_artes` ou com status vazio,
 * AGUARDANDO (rascunho salvo sem designer) ou PENDENTE. Qualquer outro status
 * (EM ARTE, Em Aprovação, APROVADO...) é pedido já enviado e fica como está.
 */
export function arteJaEnviada(statusArte: string | null | undefined): boolean {
  const s = String(statusArte ?? "").trim().toUpperCase();
  return s !== "" && s !== "AGUARDANDO" && s !== "PENDENTE";
}
