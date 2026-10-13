/**
 * Peso do item com variacao (pedido 23542): cada variacao conta UMA vez.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/peso-item-variacao.test.mts
 *
 * `produtos_proposta.peso_uni` guarda base + variacoes. Ao reabrir, o formulario somava as
 * variacoes de novo em calculateItemWeight: 150 x (12,93 + 5,45) = 2.757 g em vez de 1.939,5 g.
 */
import {
  calculateItemWeight,
  pesoDivergeDaCotacao,
  pesoUnitarioSemVariacoes
} from "../../src/features/orcamentos/orcamento-utils.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else console.log(`ok      ${nome}`);
}
const arred = (n: number) => Math.round(n * 1000) / 1000;
const variacao = (peso: number) => ({ tipo: { peso } }) as never;

// ── 23542 (dados do banco): qtd 150, peso_uni 12,93 (base 7,48 + variacoes 4 + 1,45), peso_total 1939,50
const variacoes23542 = [variacao(4), variacao(1.45)];
const gravado = 12.93;
const antes = calculateItemWeight({ quantidade: 150, pesoUnitario: gravado, variacoesEscolhidas: variacoes23542 });
checar("ANTES da correcao: 2.757 g (variacao contada duas vezes)", arred(antes), 2757);

const base = pesoUnitarioSemVariacoes(gravado, variacoes23542);
checar("peso base voltou a ser so a base (7,48)", arred(base), 7.48);
const depois = calculateItemWeight({ quantidade: 150, pesoUnitario: base, variacoesEscolhidas: variacoes23542 });
checar("DEPOIS da correcao: 23542 = 1.939,5 g", arred(depois), 1939.5);
checar("bate com o peso_total gravado no banco", arred(depois), 1939.5);

// ── item sem variacao: o mesmo peso de antes
const semVar = { quantidade: 40, pesoUnitario: 0.35, variacoesEscolhidas: [] };
const pesoSemVarAntes = calculateItemWeight(semVar);
const baseSemVar = pesoUnitarioSemVariacoes(0.35, []);
checar("item sem variacao: o peso base e o proprio peso_uni", baseSemVar, 0.35);
checar("item sem variacao: mesmo peso de antes", calculateItemWeight({ ...semVar, pesoUnitario: baseSemVar }), pesoSemVarAntes);
checar("item sem variacao: 40 x 0,35 = 14", arred(pesoSemVarAntes), 14);

// ── item NOVO (pesoUnitario = peso do produto, variacoes escolhidas na tela): nao muda
checar("item novo com variacao: base + variacoes uma vez", arred(calculateItemWeight({ quantidade: 10, pesoUnitario: 7.48, variacoesEscolhidas: variacoes23542 })), arred(10 * 7.48 + 10 * 5.45));

// ── bordas
checar("nunca negativo", pesoUnitarioSemVariacoes(1, [variacao(5)]), 0);
checar("variacao sem peso (nulo) conta zero", pesoUnitarioSemVariacoes(2, [{ tipo: { peso: null } } as never, { tipo: undefined } as never]), 2);
checar("peso gravado nulo", pesoUnitarioSemVariacoes(null as never, []), 0);

// ── a decisao de recotar compara com o peso gravado na COTACAO
checar("23542: 1939,5 atual x 2757 gravado diverge", pesoDivergeDaCotacao(1939.5, 2757), true);
checar("mesmo peso: nao diverge", pesoDivergeDaCotacao(1939.5, 1939.5), false);
checar("dentro da tolerancia de 1 g (0,4 g): nao diverge", pesoDivergeDaCotacao(1939.9, 1939.5), false);
checar("1 g de diferenca ja diverge (igual ao frete-desatualizado)", pesoDivergeDaCotacao(1940.5, 1939.5), true);
checar("sem peso gravado (frete manual/retirada): nao ha o que comparar", [pesoDivergeDaCotacao(1000, 0), pesoDivergeDaCotacao(1000, null), pesoDivergeDaCotacao(1000, undefined)], [false, false, false]);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
