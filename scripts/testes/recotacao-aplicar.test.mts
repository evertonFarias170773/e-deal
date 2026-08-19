/**
 * Testes da aritmética da Etapa 2 (aplicar recotação de frete).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/recotacao-aplicar.test.mts
 *
 * O QUE ESTE ARQUIVO FIXA
 *   A Etapa 2 grava `propostas.valor_total = valor_total_atual + diferenca`, e
 *   NÃO o retorno de `cc__total_soberano_proposta`. Isso só é legítimo enquanto
 *   as fórmulas em uso forem LINEARES no frete, com coeficiente 1 — ou seja,
 *   enquanto somar Δ ao frete somar exatamente Δ ao total, em qualquer uma
 *   delas. É essa propriedade que os testes abaixo fixam.
 *
 * O QUE ELE NÃO SUBSTITUI
 *   As funções aqui são RÉPLICAS em TypeScript do que roda no banco e na tela.
 *   Réplica pode divergir do original sem ninguém notar. A proteção de verdade
 *   é a asserção dentro de `exp_aplicar_recotacao`, que mede o total soberano
 *   antes e depois de escrever e aborta a transação com EXP_RECOT_NAO_LINEAR se
 *   a diferença não for o delta do frete. Este arquivo é a documentação
 *   executável dessa regra, e o retorno rápido em CI.
 */

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

type Caso = {
  nome: string;
  isAvulso: boolean;
  /** SUM(produtos_proposta.valor_sub_total) dos itens não cancelados — o BRUTO. */
  subtotal: number;
  /** propostas.valor, usado só em avulsa. */
  valorAvulso: number;
  descontoPercentual: number;
  descontoNominal: number;
  /** clientes.percentual_bunus quando is_bonus e não usa_preco_fixo. */
  bonusPercent: number;
};

/**
 * Réplica de `public.cc__total_soberano_proposta`.
 * Fiel de propósito, INCLUSIVE no defeito: ela não conhece o bônus do cliente
 * (ver docs/business/CONTA-CORRENTE-CREDITO.md §4.2, item 13).
 */
function totalSoberano(c: Caso, frete: number): number {
  if (c.isAvulso) return Math.max(0, round2(c.valorAvulso + frete));
  const desconto =
    c.descontoPercentual > 0
      ? Math.max(0, (c.subtotal * c.descontoPercentual) / 100)
      : Math.max(0, c.descontoNominal);
  const descontoLimitado = Math.min(c.subtotal, desconto);
  return Math.max(0, round2(c.subtotal + frete - descontoLimitado));
}

/**
 * Réplica de `calculateResumo` (src/features/orcamentos/orcamento-utils.ts):
 * o subtotal já vem líquido do bônus, porque `calculateItemSubtotal` subtrai
 * `subtotalBruto × bonusPercent/100` item a item.
 */
function totalApp(c: Caso, frete: number): number {
  const subtotalLiquido = c.subtotal - c.subtotal * (c.bonusPercent / 100);
  const descontoGeral = Math.min(
    subtotalLiquido,
    c.descontoPercentual > 0
      ? Math.max(0, (subtotalLiquido * c.descontoPercentual) / 100)
      : Math.max(0, c.descontoNominal)
  );
  return Math.max(0, round2(subtotalLiquido - descontoGeral + frete));
}

const CASOS: Caso[] = [
  { nome: "sem desconto", isAvulso: false, subtotal: 650, valorAvulso: 0, descontoPercentual: 0, descontoNominal: 0, bonusPercent: 0 },
  { nome: "desconto percentual", isAvulso: false, subtotal: 650, valorAvulso: 0, descontoPercentual: 10, descontoNominal: 0, bonusPercent: 0 },
  { nome: "desconto nominal", isAvulso: false, subtotal: 650, valorAvulso: 0, descontoPercentual: 0, descontoNominal: 55.5, bonusPercent: 0 },
  { nome: "cliente com tabela especial de 8%", isAvulso: false, subtotal: 120, valorAvulso: 0, descontoPercentual: 0, descontoNominal: 0, bonusPercent: 8 },
  { nome: "cliente de teste com 99%", isAvulso: false, subtotal: 107.2, valorAvulso: 0, descontoPercentual: 0, descontoNominal: 0, bonusPercent: 99 },
  { nome: "bonus + desconto geral juntos", isAvulso: false, subtotal: 900, valorAvulso: 0, descontoPercentual: 5, descontoNominal: 0, bonusPercent: 10 },
  { nome: "avulsa", isAvulso: true, subtotal: 0, valorAvulso: 480, descontoPercentual: 0, descontoNominal: 0, bonusPercent: 0 },
  { nome: "subtotal zerado (todos os itens cancelados)", isAvulso: false, subtotal: 0, valorAvulso: 0, descontoPercentual: 0, descontoNominal: 0, bonusPercent: 0 }
];

// Deltas negativos e zero — o que a Etapa 2 aceita — mais um positivo, porque a
// linearidade tem de valer nos dois sentidos para a Etapa 4 herdar a regra.
const DELTAS = [-11.63, -3.28, -0.01, 0, 8.49];
const FRETE_BASE = 23.4;

// ── A propriedade central ───────────────────────────────────────────────────
for (const c of CASOS) {
  for (const delta of DELTAS) {
    const deltaSoberano = round2(totalSoberano(c, FRETE_BASE + delta) - totalSoberano(c, FRETE_BASE));
    const deltaApp = round2(totalApp(c, FRETE_BASE + delta) - totalApp(c, FRETE_BASE));
    checar(`soberana é linear no frete — ${c.nome}, Δ ${delta}`, deltaSoberano, round2(delta));
    checar(`app é linear no frete — ${c.nome}, Δ ${delta}`, deltaApp, round2(delta));
    checar(`as duas concordam no delta — ${c.nome}, Δ ${delta}`, deltaSoberano, deltaApp);
  }
}

// ── E a divergência que motivou a opção C continua existindo ────────────────
// Se estas asserções passarem a falhar, alguém corrigiu a persistência do
// desconto de tabela especial — e aí a Etapa 2 pode voltar a considerar gravar
// o total soberano direto. Enquanto falharem em produção, o delta é o caminho.
const cliente99 = CASOS[4];
checar(
  "sem bônus as duas fórmulas coincidem",
  totalSoberano(CASOS[0], FRETE_BASE) === totalApp(CASOS[0], FRETE_BASE),
  true
);
checar(
  "com tabela especial elas divergem (é o defeito conhecido)",
  totalSoberano(cliente99, FRETE_BASE) !== totalApp(cliente99, FRETE_BASE),
  true
);
checar("soberana ignora o bônus de 99%", totalSoberano(cliente99, 11.63), round2(107.2 + 11.63));
checar("app aplica o bônus de 99%", totalApp(cliente99, 11.63), 12.7);

// ── Aritmética da aplicação, como a rota e a RPC a calculam ─────────────────
function aplicar(totalAnterior: number, freteAnterior: number, freteNovo: number) {
  const diferenca = round2(freteNovo - freteAnterior);
  return { diferenca, totalNovo: round2(round2(totalAnterior) + diferenca) };
}

checar("barateia: total anda pelo delta", aplicar(118.83, 23.4, 20.12), { diferenca: -3.28, totalNovo: 115.55 });
checar("empata: total não muda", aplicar(118.83, 23.4, 23.4), { diferenca: 0, totalNovo: 118.83 });
checar("total com 3 casas é arredondado só no ledger", aplicar(12.702, 11.63, 8.35), { diferenca: -3.28, totalNovo: 9.42 });
checar("frete a zero (retira no balcão)", aplicar(118.83, 23.4, 0), { diferenca: -23.4, totalNovo: 95.43 });

// O CHECK exp_recot_total_ck do banco expressa exatamente isto:
for (const [totalAnt, freteAnt, freteNovo] of [[118.83, 23.4, 20.12], [95.5, 12, 0], [12.7, 11.63, 11.63]]) {
  const r = aplicar(totalAnt, freteAnt, freteNovo);
  checar(
    `total_novo = total_anterior + diferenca (${totalAnt}, ${freteAnt} → ${freteNovo})`,
    r.totalNovo,
    round2(round2(totalAnt) + r.diferenca)
  );
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
