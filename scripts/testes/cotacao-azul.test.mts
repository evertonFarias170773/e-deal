/**
 * Cotação automática da Azul — src/features/orcamentos/lib/cotacao-azul.ts
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/cotacao-azul.test.mts
 *
 * O QUE PROVA (27/10/2026), sem chamar a Azul
 *   1. A caixa sai do peso: ECOMM (limite 30 kg por envio, divisor d) e DEMAIS
 *      (EXPRESSO/STANDARD/PREMIUM, d = 1) — volumes, peso enviado e altura dos
 *      casos combinados, e o ValorTotal dividido por d no corpo.
 *   2. Respostas simuladas das duas cotações viram ECOMM, EXPRESSO e STANDARD
 *      distintos, sem ECOMM duplicado, com o Total do ECOMM multiplicado por d
 *      antes da margem de 1,15 e os ids por posição final; os _CORP ficam de
 *      fora; corpo vazio e falha de um grupo não derrubam o outro.
 *   3. Os três nomes gravados são reconhecidos como Azul por quem lê o frete.
 */
import assert from "node:assert/strict";
import {
  juntarCotacoesAzul,
  lerCorpoCotacaoAzul,
  mapearCotacoesAzul,
  montarCorpoCotacaoAzul,
  planejarCotacaoAzul
} from "../../src/features/orcamentos/lib/cotacao-azul.ts";
import { resolverTransportadoraParceira, TRANSPORTADORAS_PARCEIRAS } from "../../src/features/orcamentos/lib/transportadoras-parceiras.ts";
import { servicoDoFrete } from "../../src/features/orcamentos/lib/servicos-transportadora.ts";
import { categoriaDoServico } from "../../src/features/orcamentos/lib/categoria-frete.ts";
import { normalizarTipoFrete } from "../../src/features/expedicao/lib/tipo-frete.ts";

// 1. Plano por peso.
const casosEcomm: [number, { d: number; v: number; peso: number; a: number }][] = [
  [0.2466, { d: 1, v: 1, peso: 0.247, a: 1 }],
  [0.45, { d: 1, v: 1, peso: 0.45, a: 1 }],
  [2.25, { d: 1, v: 1, peso: 2.25, a: 5 }],
  [6, { d: 1, v: 1, peso: 6, a: 14 }],
  [16, { d: 1, v: 1, peso: 16, a: 36 }],
  [20, { d: 1, v: 2, peso: 20, a: 23 }],
  [30, { d: 1, v: 2, peso: 30, a: 34 }],
  [31, { d: 2, v: 1, peso: 15.5, a: 35 }],
  [48, { d: 2, v: 2, peso: 24, a: 27 }]
];
for (const [kg, esperado] of casosEcomm) {
  const p = planejarCotacaoAzul(kg, "ECOMM");
  assert.deepEqual(
    { d: p.divisor, v: p.volumes, peso: p.pesoEnviadoKg, a: p.altura },
    esperado,
    `ECOMM ${kg} kg`
  );
  const corpo = montarCorpoCotacaoAzul(p, { cep: "01310-100", valorTotal: 100 });
  assert.equal(corpo.SiglaServico, "ECOMM");
  assert.deepEqual(corpo.Itens, [{ Volume: esperado.v, Peso: esperado.peso, Altura: esperado.a, Comprimento: 32, Largura: 23 }]);
  assert.equal(corpo.ValorTotal, Number((100 / esperado.d).toFixed(2)), `ValorTotal ${kg} kg`);
}
const demais48 = planejarCotacaoAzul(48, "DEMAIS");
assert.deepEqual(
  { d: demais48.divisor, v: demais48.volumes, peso: demais48.pesoEnviadoKg, a: demais48.altura },
  { d: 1, v: 3, peso: 48, a: 36 }
);
const corpoDemais = montarCorpoCotacaoAzul(demais48, { cep: "01310100", valorTotal: 100 });
assert.equal(corpoDemais.SiglaServico, "");
assert.equal(corpoDemais.ValorTotal, 100);
assert.equal(corpoDemais.CEPDestino, "01310100");

// 2. Respostas simuladas das duas cotações de um pedido de 48 kg (d = 2 no ECOMM).
const ecomm48 = planejarCotacaoAzul(48, "ECOMM");
const respostaEcomm = JSON.stringify([{ ID_Cotacao: 906326, Prazo: 3, Total: 93.47, Servico: "ECOMM" }]);
const respostaDemais = JSON.stringify([
  { ID_Cotacao: 906326, Prazo: 3, Total: 150.1, Servico: "ECOMM" }, // descartado: o ECOMM vem da outra cotação
  { ID_Cotacao: 907568, Prazo: 1, Total: 384.89, Servico: "EXPRESSO" },
  { ID_Cotacao: 935927, Prazo: 5, Total: 231, Servico: "STANDARD" },
  { ID_Cotacao: 1, Prazo: 2, Total: 10, Servico: "ECOMM_CORP" }
]);
const cardsEcomm = mapearCotacoesAzul(lerCorpoCotacaoAzul(respostaEcomm), { id_int: 1, pesoGramas: 48000, plano: ecomm48 });
const cardsDemais = mapearCotacoesAzul(lerCorpoCotacaoAzul(respostaDemais), { id_int: 1, pesoGramas: 48000, plano: demais48 });
const { cards, erros } = juntarCotacoesAzul([
  { status: "fulfilled", value: cardsEcomm },
  { status: "fulfilled", value: cardsDemais }
]);
assert.equal(erros.length, 0);
assert.deepEqual(cards.map((c) => c.servico), ["ECOMM", "AZUL EXPRESSO", "AZUL STANDARD"]);
assert.deepEqual(cards.map((c) => c.id), ["frete_azul_ecomm_0", "frete_azul_azul_expresso_1", "frete_azul_azul_standard_2"]);
assert.equal(cards.filter((c) => c.servico === "ECOMM").length, 1, "ECOMM não duplica");
assert.equal(cards[0].valorOriginal, 186.94, "Total do ECOMM x d (2 casas)");
assert.equal(cards[0].valor, 186.94 * 1.15, "margem depois da multiplicação");
assert.equal(cards[0].prazo, "3 dias úteis", "prazo não muda");
assert.equal(cards[0].volumes, 4, "2 envios x 2 volumes");
assert.equal(cards[0].pesoKg, 48);
assert.equal(cards[1].valorOriginal, 384.89, "DEMAIS sem multiplicação");
assert.equal(cards[1].valor, 384.89 * 1.15);
assert.equal(cards[2].id_cotacao, 935927);
assert.ok(cards.every((c) => c.transportadora === "Azul Cargo"));

// Um grupo falha ou vem vazio: o outro segue.
const soDemais = juntarCotacoesAzul([{ status: "rejected", reason: new Error("timeout") }, { status: "fulfilled", value: cardsDemais }]);
assert.equal(soDemais.erros.length, 1);
assert.deepEqual(soDemais.cards.map((c) => c.id), ["frete_azul_azul_expresso_0", "frete_azul_azul_standard_1"]);
const vazio = mapearCotacoesAzul(lerCorpoCotacaoAzul(""), { id_int: 1, pesoGramas: 48000, plano: demais48 });
assert.deepEqual(vazio, []);
// Formato antigo (objeto único) segue aceito; abaixo de 30 kg nada é multiplicado.
const leve = planejarCotacaoAzul(1.5, "ECOMM");
const cardLeve = mapearCotacoesAzul(lerCorpoCotacaoAzul('{"ID_Cotacao":1,"Prazo":3,"Total":40.19,"Servico":"ECOMM"}'), { id_int: 1, pesoGramas: 1500, plano: leve });
assert.equal(cardLeve.length, 1);
assert.equal(cardLeve[0].valorOriginal, 40.19);
assert.equal(cardLeve[0].valor, 40.19 * 1.15);
assert.equal(cardLeve[0].volumes, 1);

// 3. Reconhecimento por texto dos três nomes gravados.
for (const c of cards) {
  const frete = { transportadora: c.transportadora, servico: c.servico };
  assert.equal(resolverTransportadoraParceira(frete), TRANSPORTADORAS_PARCEIRAS.AZUL, c.servico);
  assert.equal(normalizarTipoFrete(c.servico), "TRANSPORTADORA", c.servico);
  assert.equal(categoriaDoServico(c.transportadora, c.servico, "CIF"), "AEREO", c.servico);
  assert.ok(servicoDoFrete(TRANSPORTADORAS_PARCEIRAS.AZUL, frete) !== null, c.servico);
}

console.log("cotacao-azul.test.mts: ok (plano por peso nos 10 casos; duas cotações viram 3 cards sem ECOMM duplicado, Total x d antes da margem; nomes reconhecidos como Azul)");
