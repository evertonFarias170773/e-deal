/**
 * Dublê de `@/features/orcamentos/services/orcamentos.service` para testes de
 * rota que só precisam do total da proposta (`getPropostaDetailById`). O teste
 * define o total com `definirTotalDaProposta`.
 */
let totalDaProposta = 0;
export function definirTotalDaProposta(valor: number) {
  totalDaProposta = valor;
}
export async function getPropostaDetailById() {
  return { resumo: { valorTotal: totalDaProposta } };
}
