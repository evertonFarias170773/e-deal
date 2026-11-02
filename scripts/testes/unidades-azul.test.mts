/**
 * Azul só onde há unidade de retirada — src/features/orcamentos/lib/unidades-azul.ts
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/unidades-azul.test.mts
 *
 * O QUE PROVA (02/11/2026), sem chamar a Azul
 *   1. Cidade com unidades dos quatro serviços devolve os quatro.
 *   2. Tabatinga/AM (só EXPRESSO, PREMIUM e STANDARD) devolve esses três, sem ECOMM.
 *   3. Pinhalzinho/SC, sem unidade, devolve vazio; unidade não elegível não conta.
 *   4. Lista vazia ou cidade/UF não resolvida devolve null (não filtra).
 *   5. No mapeamento dos cards: com a verificação desligada nada muda; com a
 *      lista da cidade, o card fora dela some e o ECOMM mantém a margem.
 *   6. A chave ignora acento, maiúsculas e apóstrofo.
 */
import assert from "node:assert/strict";
import { chaveCidadeAzul, servicosAzulDaCidade, type UnidadeAzul } from "../../src/features/orcamentos/lib/unidades-azul.ts";
import { lerCorpoCotacaoAzul, mapearCotacoesAzul, planejarCotacaoAzul } from "../../src/features/orcamentos/lib/cotacao-azul.ts";

const unidades: UnidadeAzul[] = [
  { base: "FLN", cidade: "Florianopolis", uf: "SC", servicos: ["ECOMM", "EXPRESSO", "PREMIUM", "STANDARD"], elegivel: true },
  { base: "FLNT3", cidade: "Florianopolis", uf: "SC", servicos: ["ECOMM", "EXPRESSO", "PREMIUM", "STANDARD"], elegivel: false },
  { base: "TBT", cidade: "Tabatinga", uf: "AM", servicos: ["EXPRESSO", "PREMIUM", "STANDARD"], elegivel: true },
  { base: "XAP", cidade: "Chapeco", uf: "SC", servicos: ["ECOMM", "STANDARD"], elegivel: true },
  { base: "XAP01", cidade: "Chapeco", uf: "SC", servicos: ["EXPRESSO"], elegivel: true },
  { base: "BNU02", cidade: "Blumenau", uf: "SC", servicos: [], elegivel: false }
];

// 1. Quatro serviços; a parceira não elegível não acrescenta nada.
assert.deepEqual(servicosAzulDaCidade(unidades, "Florianópolis", "sc"), ["ECOMM", "EXPRESSO", "PREMIUM", "STANDARD"]);
// União entre unidades da mesma cidade.
assert.deepEqual(servicosAzulDaCidade(unidades, "CHAPECÓ ", "SC"), ["ECOMM", "EXPRESSO", "STANDARD"]);
// 2. Tabatinga: sem ECOMM.
assert.deepEqual(servicosAzulDaCidade(unidades, "Tabatinga", "AM"), ["EXPRESSO", "PREMIUM", "STANDARD"]);
// 3. Sem unidade: vazio. Só unidade não elegível (Blumenau): vazio.
assert.deepEqual(servicosAzulDaCidade(unidades, "Pinhalzinho", "SC"), []);
assert.deepEqual(servicosAzulDaCidade(unidades, "Blumenau", "SC"), []);
// Mesma cidade em outra UF não vale.
assert.deepEqual(servicosAzulDaCidade(unidades, "Tabatinga", "SP"), []);
// 4. Não filtra: lista vazia/ausente ou cidade/UF não resolvida.
assert.equal(servicosAzulDaCidade([], "Florianopolis", "SC"), null);
assert.equal(servicosAzulDaCidade(null, "Florianopolis", "SC"), null);
assert.equal(servicosAzulDaCidade(unidades, "", "SC"), null);
assert.equal(servicosAzulDaCidade(unidades, "Florianopolis", ""), null);
assert.equal(servicosAzulDaCidade(unidades, "Florianopolis", "S"), null);

// 5. Nos cards: resposta simulada com os quatro serviços.
const corpo = JSON.stringify([
  { ID_Cotacao: 1, Prazo: 3, Total: 100, Servico: "ECOMM" },
  { ID_Cotacao: 2, Prazo: 1, Total: 300, Servico: "EXPRESSO" },
  { ID_Cotacao: 3, Prazo: 5, Total: 200, Servico: "STANDARD" },
  { ID_Cotacao: 4, Prazo: 1, Total: 400, Servico: "PREMIUM" }
]);
const itens = lerCorpoCotacaoAzul(corpo);
const planoEcomm = planejarCotacaoAzul(2, "ECOMM");
const planoDemais = planejarCotacaoAzul(2, "DEMAIS");
const base = { id_int: 1, pesoGramas: 2000 };

// Desligada (ausente ou null): igual a antes.
const semVerificacao = [
  ...mapearCotacoesAzul(itens, { ...base, plano: planoEcomm }),
  ...mapearCotacoesAzul(itens, { ...base, plano: planoDemais, servicosPermitidos: null })
];
assert.deepEqual(semVerificacao.map((c) => c.servico), ["ECOMM", "AZUL EXPRESSO", "AZUL STANDARD", "AZUL PREMIUM"]);
assert.equal(semVerificacao[0].valor.toFixed(2), "115.00");

// Tabatinga: o ECOMM some, os outros ficam sem margem.
const tabatinga = servicosAzulDaCidade(unidades, "Tabatinga", "AM");
const comVerificacao = [
  ...mapearCotacoesAzul(itens, { ...base, plano: planoEcomm, servicosPermitidos: tabatinga }),
  ...mapearCotacoesAzul(itens, { ...base, plano: planoDemais, servicosPermitidos: tabatinga })
];
assert.deepEqual(comVerificacao.map((c) => c.servico), ["AZUL EXPRESSO", "AZUL STANDARD", "AZUL PREMIUM"]);
assert.equal(comVerificacao[0].valor, 300);

// Chapecó: ECOMM com margem, EXPRESSO e STANDARD; PREMIUM some.
const chapeco = servicosAzulDaCidade(unidades, "Chapeco", "SC");
const cardsChapeco = [
  ...mapearCotacoesAzul(itens, { ...base, plano: planoEcomm, servicosPermitidos: chapeco }),
  ...mapearCotacoesAzul(itens, { ...base, plano: planoDemais, servicosPermitidos: chapeco })
];
assert.deepEqual(cardsChapeco.map((c) => c.servico), ["ECOMM", "AZUL EXPRESSO", "AZUL STANDARD"]);
assert.equal(cardsChapeco[0].valor.toFixed(2), "115.00");

// Sem unidade: nenhum card.
assert.deepEqual(mapearCotacoesAzul(itens, { ...base, plano: planoDemais, servicosPermitidos: [] }), []);

// 6. Chave.
assert.equal(chaveCidadeAzul("Sant'Ana do Livramento", "rs"), "RS:santanadolivramento");
assert.equal(chaveCidadeAzul("SÃO JOSÉ ", "SC"), chaveCidadeAzul("Sao Jose", "sc"));
assert.equal(chaveCidadeAzul("Florianopolis", "SC"), "SC:florianopolis");
assert.equal(chaveCidadeAzul("", "SC"), "");

console.log("unidades-azul.test.mts: ok (4 serviços; Tabatinga sem ECOMM; Pinhalzinho vazio; lista vazia/cidade não resolvida = null; desligada nada muda)");
