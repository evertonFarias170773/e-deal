/**
 * A regra ÚNICA do total da proposta — a do "Salvar alterações".
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/total-da-proposta.test.mts
 *
 * Usada pela lista de propostas, pela lista rápida e pela área do cliente (as
 * duas pelo carregador do servidor) e pela API da Lisiton. Este teste guarda
 * os casos que definem a regra, inclusive os dois em que a lista divergia até
 * 29/09/2026: item cancelado e desconto maior que o subtotal.
 */
const { totaisDaProposta } = await import("../../src/features/orcamentos/lib/total-da-proposta.ts");

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok =
    typeof real === "number" && typeof esperado === "number"
      ? Math.abs(real - esperado) < 0.005
      : JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `  — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)}`}`);
}

const base = { isAvulso: false, valorTotalGravado: 999, valor: 100, valorFrete: 20, bonusPercent: 0, descontoGeral: null };
const total = (e: Parameters<typeof totaisDaProposta>[0]) => totaisDaProposta(e).total;

// ── Sem item ativo: vale o gravado ──────────────────────────────────────────
checar("avulsa usa o total gravado", total({ ...base, isAvulso: true, itens: [{ qtd: 1, valor_unt: 1, fixo: 0 }] }), 999);
checar("avulsa sem total gravado: valor + frete", total({ ...base, isAvulso: true, valorTotalGravado: null, itens: [] }), 120);
checar("sem itens usa o total gravado", total({ ...base, itens: [] }), 999);
checar("todos os itens cancelados: usa o gravado",
  totaisDaProposta({ ...base, itens: [{ qtd: 5, valor_unt: 10, fixo: 0, status_item: "CANCELADO" }] }),
  { subtotalProdutos: 100, total: 999, origem: "gravado" });

// ── Com itens ativos ────────────────────────────────────────────────────────
checar("qtd x unit + fixo + frete (o gravado e ignorado)", total({ ...base, itens: [{ qtd: 120, valor_unt: 0.72, fixo: 60 }] }), 166.4);
checar("dois itens somam",
  total({ ...base, valorFrete: 0, itens: [{ qtd: 10, valor_unt: 2, fixo: 0 }, { qtd: 1, valor_unt: 0, fixo: 5 }] }), 25);
checar("ITEM CANCELADO FICA DE FORA (regra do save)",
  total({ ...base, valorFrete: 0, itens: [{ qtd: 10, valor_unt: 2, fixo: 0 }, { qtd: 99, valor_unt: 99, fixo: 0, status_item: "CANCELADO" }] }), 20);
checar("cancelado em minuscula tambem",
  total({ ...base, valorFrete: 0, itens: [{ qtd: 1, valor_unt: 5, fixo: 0 }, { qtd: 1, valor_unt: 50, fixo: 0, status_item: "cancelado" }] }), 5);
checar("bonus do cliente abate do subtotal",
  total({ ...base, valorFrete: 0, bonusPercent: 10, itens: [{ qtd: 10, valor_unt: 10, fixo: 0 }] }), 90);
checar("desconto percentual incide sobre os produtos, nao sobre o frete",
  total({ ...base, descontoGeral: { valor_percentual: 10, valor_nominal: 0 }, itens: [{ qtd: 10, valor_unt: 10, fixo: 0 }] }), 110);
checar("desconto nominal",
  total({ ...base, descontoGeral: { valor_percentual: 0, valor_nominal: 15 }, itens: [{ qtd: 10, valor_unt: 10, fixo: 0 }] }), 105);
checar("DESCONTO NUNCA PASSA DO SUBTOTAL: o frete continua sendo cobrado",
  total({ ...base, descontoGeral: { valor_percentual: 0, valor_nominal: 500 }, itens: [{ qtd: 1, valor_unt: 10, fixo: 0 }] }), 20);
checar("desconto negativo conta como zero",
  total({ ...base, valorFrete: 0, descontoGeral: { valor_percentual: 0, valor_nominal: -30 }, itens: [{ qtd: 1, valor_unt: 10, fixo: 0 }] }), 10);
checar("valor ausente conta como zero",
  total({ ...base, valorFrete: null, itens: [{ qtd: 2, valor_unt: null, fixo: 7 }] }), 7);
checar("subtotal e o valor SEM desconto (propostas.valor)",
  totaisDaProposta({ ...base, descontoGeral: { valor_percentual: 10, valor_nominal: 0 }, itens: [{ qtd: 10, valor_unt: 10, fixo: 0 }] }).subtotalProdutos, 100);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
