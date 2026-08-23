/**
 * Testes da leitura tolerante do transporte.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/transporte-categoria.test.mts
 *
 * A lista abaixo NAO e inventada: sao os 62 valores distintos que
 * `propostas.frete_escolhido` tem em producao (levantados em 22/08/2026), com a
 * categoria que cada um deve produzir. Classificar texto livre errado joga o
 * valor do frete na opcao errada da tela — foi isso que motivou a coluna
 * `transporte_categoria`.
 *
 * Rode depois de mexer em src/features/orcamentos/lib/transporte-categoria.ts
 * ou em src/features/expedicao/lib/tipo-frete.ts, que ele reaproveita.
 */
import {
  classificarTransporte,
  categoriaEfetiva,
  ehTransporteCategoria
} from "../../src/features/orcamentos/lib/transporte-categoria.ts";

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

// ── Os 62 valores reais de producao, com a categoria esperada ────────────────
const REAIS: Array<[string, string | null]> = [
  // RETIRA — 4 grafias
  ["RETIRADA", "RETIRA"],
  ["RETIRA BALCÃO", "RETIRA"],
  ["Retirada Local", "RETIRA"],
  ["Retira", "RETIRA"],
  // MOTOBOY — 2 grafias
  ["Motoboy", "MOTOBOY"],
  ["MOTOBOY", "MOTOBOY"],
  // CORREIOS — SEDEX/PAC sao servicos, nao categorias
  ["SEDEX", "CORREIOS"],
  ["sedex", "CORREIOS"],
  ["Sedex", "CORREIOS"],
  ["Correios", "CORREIOS"],
  ["PAC", "CORREIOS"],
  // TRANSPORTADORA — inclusive as "parceiras" com cotacao automatizada
  ["VEPPO", "TRANSPORTADORA"],
  ["veppo", "TRANSPORTADORA"],
  ["Veppo", "TRANSPORTADORA"],
  ["VEPPO-RS", "TRANSPORTADORA"],
  ["AZUL ECOMM", "TRANSPORTADORA"],
  ["AZUL ECOM", "TRANSPORTADORA"],
  ["ECOMM", "TRANSPORTADORA"],
  ["Azul Cargo", "TRANSPORTADORA"],
  ["Azul Cargo Premium", "TRANSPORTADORA"],
  ["EXPRESSO AZUL CARGO", "TRANSPORTADORA"],
  ["AZUL EXPRESSO", "TRANSPORTADORA"],
  ["Azul Expresso", "TRANSPORTADORA"],
  ["AZUL", "TRANSPORTADORA"],
  ["Azul", "TRANSPORTADORA"],
  ["AVI AZUL", "TRANSPORTADORA"],
  ["AÉREO EXPRESSO", "TRANSPORTADORA"],
  ["Transportadora São Miguel", "TRANSPORTADORA"],
  ["SÃO MIGUEL", "TRANSPORTADORA"],
  ["São Miguel", "TRANSPORTADORA"],
  ["Expresso São Miguel", "TRANSPORTADORA"],
  ["Transportadora Parceira", "TRANSPORTADORA"],
  ["Transportadora Unesul", "TRANSPORTADORA"],
  ["UNESUL", "TRANSPORTADORA"],
  ["TRANSPORTADORA", "TRANSPORTADORA"],
  ["Braspress", "TRANSPORTADORA"],
  ["BRASPRESS", "TRANSPORTADORA"],
  ["BRASPESS", "TRANSPORTADORA"],
  ["BRAS PRESS", "TRANSPORTADORA"],
  ["Troca Transportes", "TRANSPORTADORA"],
  ["TROCA", "TRANSPORTADORA"],
  // "Transportadora a definir" e a constante de FOB sem transportadora
  // resolvida. Continua sendo transportadora: o que falta e QUAL, nao o modal.
  ["Transportadora a definir", "TRANSPORTADORA"],

  // ── NULL: estado temporario. Nomeia preco ou combinado, nao transporte ──────
  ["Frete Incluso", null],
  ["À definir", null],
  ["à definir", null],
  ["Sem custo", null],
  ["Por conta de Dseg", null],
  ["ACOMPANHA OUTRO PEDIDO", null],
  ["Acompanha outro pedido", null],
  ["Frete", null],
  ["frete", null],
  // ── NULL: lixo de digitacao ────────────────────────────────────────────────
  ["Não", null],
  ["Não sei", null],
  ["as", null],
  ["dd", null],
  ["12", null],
  ["ede", null],
  ["tt", null],
  ["d", null],
  ["a", null],
  // ── NULL: ausencia ─────────────────────────────────────────────────────────
  ["", null],
  ["   ", null]
];

console.log(`\n— classificacao dos ${REAIS.length} valores reais de producao —`);
for (const [valor, esperado] of REAIS) {
  checar(`classificar(${JSON.stringify(valor)})`, classificarTransporte(valor), esperado);
}

console.log("\n— nulo e indefinido —");
checar("null nao quebra", classificarTransporte(null), null);
checar("undefined nao quebra", classificarTransporte(undefined), null);

console.log("\n— categoriaEfetiva: a coluna manda, o rotulo e a rede de seguranca —");
// Categoria gravada vence o rotulo, mesmo quando os dois discordam: quem
// escolheu na tela sabe mais do que o texto antigo.
checar("categoria gravada vence o rotulo", categoriaEfetiva("MOTOBOY", "SEDEX"), "MOTOBOY");
checar("categoria nula cai no rotulo", categoriaEfetiva(null, "sedex"), "CORREIOS");
checar("categoria vazia cai no rotulo", categoriaEfetiva("", "Retira"), "RETIRA");
// Valor invalido na coluna NAO e aceito por ser string: cai no rotulo.
checar("categoria invalida cai no rotulo", categoriaEfetiva("QUALQUER COISA", "MOTOBOY"), "MOTOBOY");
checar("sem categoria e sem rotulo", categoriaEfetiva(null, null), null);
checar("rotulo temporario nao vira categoria", categoriaEfetiva(null, "Frete Incluso"), null);

console.log("\n— guarda de tipo —");
checar("RETIRA e categoria", ehTransporteCategoria("RETIRA"), true);
checar("SEDEX nao e categoria", ehTransporteCategoria("SEDEX"), false);
checar("minuscula nao e categoria", ehTransporteCategoria("retira"), false);
checar("null nao e categoria", ehTransporteCategoria(null), false);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
