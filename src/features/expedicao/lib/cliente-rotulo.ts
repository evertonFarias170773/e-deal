/**
 * Rótulo do cliente na Expedição: "8469 - Lisiton Documentos Seguros".
 *
 * O número (`clientes.id_cliente`) é como a operação identifica o cliente na
 * conferência e no atendimento — o nome sozinho ambigua entre cadastros
 * parecidos. Fica aqui, e não em cada tela, para a lista e a etiqueta 10x15
 * nunca divergirem no formato.
 *
 * Sem número (cadastro não vinculado), devolve o nome puro — prefixo vazio na
 * etiqueta seria pior do que prefixo nenhum.
 */
export function rotuloClienteComNumero(
  idCliente: number | null | undefined,
  nome: string | null | undefined
): string {
  const nomeLimpo = String(nome ?? "").trim();
  if (idCliente === null || idCliente === undefined || !Number.isFinite(Number(idCliente))) {
    return nomeLimpo;
  }
  const numero = Number(idCliente);
  if (numero <= 0) return nomeLimpo;
  return nomeLimpo ? `${numero} - ${nomeLimpo}` : String(numero);
}
