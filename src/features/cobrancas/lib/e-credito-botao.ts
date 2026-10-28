/**
 * BOTAO "GERAR COBRANCA" COM E-CREDITO (28/10/2026).
 *
 * Tudo comparado em CENTAVOS inteiros. Antes a tela comparava reais em ponto
 * flutuante: na 20361, 2.151,37 - 1.360,38 dava 790,9899999999998, o valor da
 * cobranca vinha arredondado (790,99) e "790,99 > 790,98999..." deixava o botao
 * apagado, com a tela dizendo "Pagamento integral com E-Credito".
 *
 * Regra: o credito cobre a cobranca quando saldo de credito >= valor, em
 * centavos. O valor tambem nao pode passar do saldo restante da proposta.
 * So decide o botao; o servidor (/api/cobrancas/usar-credito) confere de novo
 * contra movimento_credito.
 */

/** Reais -> centavos inteiros. */
export function centavos(valor: number): number {
  return Math.round((Number(valor) || 0) * 100);
}

/** O botao de E-Credito fica apagado? */
export function eCreditoBloqueado(input: {
  valor: number;
  saldoCredito: number;
  saldoRestante: number;
  tipoSecundario: string;
  condicaoSecundaria: string;
}): boolean {
  const valor = centavos(input.valor);
  const credito = centavos(input.saldoCredito);
  const restante = centavos(input.saldoRestante);
  if (valor <= 0) return true;
  if (valor > credito) return true;
  if (valor > restante) return true;
  // Pagamento combinado com E-Faturado exige a condicao secundaria.
  if (valor < restante && input.tipoSecundario === "E-FATURADO" && !input.condicaoSecundaria) return true;
  return false;
}
