/**
 * O bônus de tabela especial de UMA proposta — a linha gravada manda.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/bonus-da-proposta.test.mts
 *
 * Decisão de 19/08/2026 (CONTA-CORRENTE-CREDITO.md §4.2, item 13): o bônus da
 * venda fica gravado como linha `desconto_proposta` TABELA_ESPECIAL. Sem a
 * linha, vale o bônus do cliente, como sempre valeu. Nunca os dois somados.
 */
const { bonusDaProposta, percentualGravado } = await import("../../src/features/orcamentos/lib/bonus-da-proposta.ts");
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
const bonus = (linha: { valor_percentual: unknown } | null, cliente: number) => bonusDaProposta(percentualGravado(linha), cliente);

// ── A regra ─────────────────────────────────────────────────────────────────
checar("SEM LINHA: vale o bônus do cliente (o de sempre)", bonus(null, 5), 5);
checar("sem linha e cliente sem bônus: 0", bonus(null, 0), 0);
checar("COM LINHA: vale a linha, não o cliente", bonus({ valor_percentual: 3 }, 5), 3);
checar("NUNCA SOMA: linha 5 e cliente 5 dão 5, não 10", bonus({ valor_percentual: 5 }, 5), 5);
checar("linha com 0 VALE: vendido sem bônus, cliente com 10% hoje", bonus({ valor_percentual: 0 }, 10), 0);
checar("ex-cliente com bônus: linha 8, cliente 0 hoje (LISITON)", bonus({ valor_percentual: 8 }, 0), 8);
checar("percentual como texto (numeric do PostgREST)", bonus({ valor_percentual: "8" }, 0), 8);
checar("percentual com casas", bonus({ valor_percentual: "2.5" }, 0), 2.5);
checar("linha 100 é válida", bonus({ valor_percentual: 100 }, 5), 100);

// ── Linha quebrada conta como ausente ───────────────────────────────────────
checar("negativo: ignora a linha", bonus({ valor_percentual: -1 }, 5), 5);
checar("acima de 100: ignora a linha", bonus({ valor_percentual: 101 }, 5), 5);
checar("não numérico: ignora a linha", bonus({ valor_percentual: "abc" }, 5), 5);
checar("percentual nulo: ignora a linha", bonus({ valor_percentual: null }, 5), 5);
checar("percentual vazio: ignora a linha", bonus({ valor_percentual: "" }, 5), 5);
checar("bônus do cliente inválido vira 0", bonus(null, Number.NaN), 0);

// ── Com a regra única do total ──────────────────────────────────────────────
// 22930: 4.600 x R$ 0,16 + R$ 40 = R$ 776,00; frete R$ 55,69; 5% => R$ 792,89.
const p22930 = (bonusPercent: number) =>
  totaisDaProposta({
    isAvulso: false, valorTotalGravado: 792.89, valor: 737.2, valorFrete: 55.69, bonusPercent, descontoGeral: null,
    itens: [{ qtd: 4600, valor_unt: 0.16, fixo: 40, status_item: "PENDENTE" }]
  }).total;
checar("22930 sem linha, cliente 5%: R$ 792,89 (o de hoje)", p22930(bonus(null, 5)), 792.89);
checar("22930 com linha 5%: R$ 792,89 — o mesmo", p22930(bonus({ valor_percentual: 5 }, 5)), 792.89);
checar("22930 com linha 5% e cliente mudado para 0%: segue R$ 792,89", p22930(bonus({ valor_percentual: 5 }, 0)), 792.89);
checar("linha 3% com cliente 5%: R$ 808,41 (vale a venda)", p22930(bonus({ valor_percentual: 3 }, 5)), 808.41);
// 19521: bruto R$ 345,00; 10% => R$ 310,50; desconto geral nominal R$ 120,80; sem frete => R$ 189,70.
checar("19521: bônus ANTES do desconto geral => R$ 189,70",
  totaisDaProposta({
    isAvulso: false, valorTotalGravado: 189.7, valor: 345, valorFrete: 0,
    bonusPercent: bonus({ valor_percentual: 10 }, 10),
    descontoGeral: { valor_percentual: 0, valor_nominal: 120.8 },
    itens: [{ qtd: 1, valor_unt: 345, fixo: 0 }]
  }).total, 189.7);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
