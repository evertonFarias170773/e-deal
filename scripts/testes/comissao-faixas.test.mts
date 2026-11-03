/**
 * Tabela de faixas da comissão (03/11/2026): `src/features/relatorios/lib/comissao.ts`.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/comissao-faixas.test.mts
 *
 * O QUE PROVA
 *   1. O exemplo conferido: R$ 161.257,99 cai em 5,30% e dá R$ 8.546,67.
 *   2. O limite fica na faixa de baixo: 100.000,00 é 5% e 100.000,01 é 5,15% (idem em cada degrau).
 *   3. A faixa vale sobre o total inteiro (não é por degrau) e a comissão sai em centavos.
 *   4. A linha do relatório só calcula %, ticket e comissão depois de escolhida a base.
 */
import assert from "node:assert/strict";
import { percentualDaComissao, valorDaComissao, textoDasFaixas } from "../../src/features/relatorios/lib/comissao.ts";
import { calcularLinha } from "../../src/features/relatorios/definicoes/pagamento-comissao.ts";

let ok = 0;
const caso = (nome: string, fn: () => void) => {
  fn();
  ok++;
  console.log(`ok - ${nome}`);
};

caso("161.257,99 -> 5,30% e R$ 8.546,67", () => {
  assert.equal(percentualDaComissao(161257.99), 5.3);
  assert.equal(valorDaComissao(161257.99), 8546.67);
});

caso("100.000,00 e 100.000,01 em faixas diferentes", () => {
  assert.equal(percentualDaComissao(100000), 5);
  assert.equal(percentualDaComissao(100000.01), 5.15);
  assert.equal(valorDaComissao(100000), 5000);
  assert.equal(valorDaComissao(100000.01), 5150);
});

caso("cada limite fica na faixa de baixo", () => {
  const degraus: [number, number, number][] = [
    [150000, 5.15, 5.3],
    [200000, 5.3, 5.4],
    [250000, 5.4, 5.5],
    [300000, 5.5, 5.6],
    [350000, 5.6, 5.7],
    [400000, 5.7, 5.75]
  ];
  for (const [limite, abaixo, acima] of degraus) {
    assert.equal(percentualDaComissao(limite), abaixo, `limite ${limite}`);
    assert.equal(percentualDaComissao(limite + 0.01), acima, `limite ${limite} + 0,01`);
  }
  assert.equal(percentualDaComissao(2_000_000), 5.75);
  assert.equal(percentualDaComissao(0), 5);
});

caso("faixa sobre o total inteiro, arredondada em centavos", () => {
  // 250.000,01 x 5,50% = 13.750,00055 -> 13.750,00 (não é 5% dos primeiros 100 mil + ...)
  assert.equal(valorDaComissao(250000.01), 13750);
  // 123.456,78 x 5,15% = 6.358,0242 -> 6.358,02
  assert.equal(valorDaComissao(123456.78), 6358.02);
  // 408.041,77 x 5,75% = 23.462,40177 -> 23.462,40
  assert.equal(valorDaComissao(408041.77), 23462.4);
});

caso("linha sem base: só os dois totais", () => {
  const t = { quantidade_vendas: 10, total_com_frete: 161500, total_sem_frete: 161257.99 };
  const vazia = calcularLinha("Fulano", "01/10/2026 a 31/10/2026", t, null);
  assert.equal(vazia.com_frete, 161500);
  assert.equal(vazia.sem_frete, 161257.99);
  assert.equal(vazia.percentual, null);
  assert.equal(vazia.ticket_medio, null);
  assert.equal(vazia.comissao, null);
  const sem = calcularLinha("Fulano", "", t, "SEM_FRETE");
  assert.equal(sem.percentual, 5.3);
  assert.equal(sem.comissao, 8546.67);
  assert.equal(sem.ticket_medio, 16125.8);
  const com = calcularLinha("Fulano", "", t, "COM_FRETE");
  assert.equal(com.comissao, valorDaComissao(161500));
});

caso("texto das faixas", () => {
  const texto = textoDasFaixas();
  assert.match(texto, /^até R\$ 100 mil inclusive, 5,00%/);
  assert.match(texto, /acima de R\$ 400 mil, 5,75%$/);
});

console.log(`\n${ok} casos ok`);
