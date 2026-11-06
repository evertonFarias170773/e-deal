/**
 * Um título do Contas a Receber "pertence" a uma cobrança? — regra única do
 * Registro de recebíveis e da checagem de parcela do Gerar títulos.
 *
 * POR QUE EXISTE (06/11/2026, pedido 24253)
 *   A lista e a checagem olhavam o PEDIDO: qualquer título não cancelado do
 *   `id_int` escondia todas as cobranças faturadas dele. O 24253 tem a entrada
 *   por boleto (24253-B, pago) e a parte faturada (24253-C, R$ 6.719,45, sem
 *   título): a entrada escondia a faturada, e a parcela 1 da entrada barrava a
 *   parcela 1 do faturado.
 *
 * A REGRA
 *   - título CANCELADO não conta;
 *   - título com `id_pagamento` da própria cobrança conta;
 *   - título SEM `id_pagamento` (legado, anterior ao vínculo) conta para todas
 *     as cobranças do pedido — o comportamento antigo, conservador: não dá para
 *     saber de quem é;
 *   - título de OUTRA cobrança (boleto à vista, PIX, outra faturada) não conta.
 */

export type TituloParaVinculo = {
  status: string | null | undefined;
  id_pagamento: string | null | undefined;
};

export function tituloEstaAtivo(titulo: TituloParaVinculo): boolean {
  return String(titulo.status ?? "").trim().toUpperCase() !== "CANCELADO";
}

export function tituloOcupaACobranca(titulo: TituloParaVinculo, idPagamentoDaCobranca: string | null | undefined): boolean {
  if (!tituloEstaAtivo(titulo)) return false;
  const doTitulo = String(titulo.id_pagamento ?? "").trim();
  if (!doTitulo) return true;
  return doTitulo === String(idPagamentoDaCobranca ?? "").trim();
}
