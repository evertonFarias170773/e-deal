/**
 * QUEM PAGA o pedido, e portanto em nome de quem sai o documento fiscal.
 *
 * `propostas.id_faturado` (o pagador / sócio comercial escolhido no pedido)
 * quando existe e difere de `id_cliente`; senão, o próprio cliente do pedido.
 *
 * Regra única de três chamadores, que têm de concordar:
 *   - `resolverPagador` e `resolverDestinoFiscal` (nfe.service): destinatário e
 *     UF de destino da NF-e de produto;
 *   - `lerContextoNfseDoPedido` (nfse-pedido.server): o TOMADOR da NFS-e e os
 *     endereços oferecidos para ele (04/11/2026, pedido 23991: a NFS-e saía
 *     contra o cliente do cadastro enquanto a NF-e já saía contra o pagador).
 *
 * Função pura: quem chama lê a proposta com o cliente que tiver (navegador ou
 * servidor).
 */
export function idDoPagadorDoPedido(proposta: {
  id_cliente: number | string | null | undefined;
  id_faturado: number | string | null | undefined;
}): number | null {
  const idCliente = paraId(proposta.id_cliente);
  const idFaturado = paraId(proposta.id_faturado);
  return idFaturado && idFaturado !== idCliente ? idFaturado : idCliente;
}

function paraId(valor: number | string | null | undefined): number | null {
  const numero = Number(valor);
  return valor != null && Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}
