/**
 * A regra do total da proposta — a mesma da lista e da API da Lisiton.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/total-da-proposta.test.mts
 *
 * Quando a regra foi extraida do laco da lista (29/09/2026), 1.075 propostas
 * foram comparadas antes e depois, sem nenhuma diferenca. Este teste guarda
 * os casos que definem a regra.
 */
const { totalDaProposta } = await import("../../src/features/orcamentos/lib/total-da-proposta.ts");

let falhas = 0;
function checar(nome: string, real: number, esperado: number) {
  const ok = Math.abs(real - esperado) < 0.005;
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `  — esperado ${esperado}, veio ${real}`}`);
}

const base = { isAvulso: false, valorTotalGravado: 999, valor: 100, valorFrete: 20, bonusPercent: 0, descontoGeral: null };

checar("avulsa usa o total gravado", totalDaProposta({ ...base, isAvulso: true, itens: [{ qtd: 1, valor_unt: 1, fixo: 0 }] }), 999);
checar("avulsa sem total gravado: valor + frete", totalDaProposta({ ...base, isAvulso: true, valorTotalGravado: null, itens: [] }), 120);
checar("sem itens usa o total gravado", totalDaProposta({ ...base, itens: [] }), 999);
checar("com itens: qtd x unit + fixo + frete (o gravado e ignorado)",
  totalDaProposta({ ...base, itens: [{ qtd: 120, valor_unt: 0.72, fixo: 60 }] }), 166.4);
checar("dois itens somam",
  totalDaProposta({ ...base, valorFrete: 0, itens: [{ qtd: 10, valor_unt: 2, fixo: 0 }, { qtd: 1, valor_unt: 0, fixo: 5 }] }), 25);
checar("bonus do cliente abate do subtotal",
  totalDaProposta({ ...base, valorFrete: 0, bonusPercent: 10, itens: [{ qtd: 10, valor_unt: 10, fixo: 0 }] }), 90);
checar("desconto geral percentual incide sobre os produtos, nao sobre o frete",
  totalDaProposta({ ...base, descontoGeral: { valor_percentual: 10, valor_nominal: 0 }, itens: [{ qtd: 10, valor_unt: 10, fixo: 0 }] }), 110);
checar("desconto geral nominal",
  totalDaProposta({ ...base, descontoGeral: { valor_percentual: 0, valor_nominal: 15 }, itens: [{ qtd: 10, valor_unt: 10, fixo: 0 }] }), 105);
checar("nunca abaixo de zero",
  totalDaProposta({ ...base, valorFrete: 0, descontoGeral: { valor_percentual: 0, valor_nominal: 500 }, itens: [{ qtd: 1, valor_unt: 10, fixo: 0 }] }), 0);
checar("valor ausente conta como zero",
  totalDaProposta({ ...base, valorFrete: null, itens: [{ qtd: 2, valor_unt: null, fixo: 7 }] }), 7);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
