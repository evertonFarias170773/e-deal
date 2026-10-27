/**
 * Cotação automática da Azul com todos os serviços — src/features/orcamentos/lib/cotacao-azul.ts
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/cotacao-azul.test.mts
 *
 * O QUE PROVA (27/10/2026)
 *   1. Resposta com três serviços vira três cards distintos, com ids distintos e
 *      os nomes gravados "ECOMM", "AZUL EXPRESSO" e "AZUL STANDARD"; os _CORP
 *      ficam de fora; a margem continua 1,15.
 *   2. Corpo vazio vira zero cards, sem erro.
 *   3. Os três nomes são reconhecidos como Azul por quem lê o frete depois.
 */
import assert from "node:assert/strict";
import { lerCorpoCotacaoAzul, mapearCotacoesAzul } from "../../src/features/orcamentos/lib/cotacao-azul.ts";
import { resolverTransportadoraParceira, TRANSPORTADORAS_PARCEIRAS } from "../../src/features/orcamentos/lib/transportadoras-parceiras.ts";
import { servicoDoFrete } from "../../src/features/orcamentos/lib/servicos-transportadora.ts";
import { categoriaDoServico } from "../../src/features/orcamentos/lib/categoria-frete.ts";
import { normalizarTipoFrete } from "../../src/features/expedicao/lib/tipo-frete.ts";

const entrada = { id_int: 1, volumes: 1, pesoKg: 1.5, pesoGramas: 1500 };

// 1. Três serviços (formato real do webhook em 27/10/2026, Token omitido) + um _CORP a ignorar.
const corpo = JSON.stringify([
  { ID_Cotacao: 906326, Prazo: 3, Total: 40.19, Servico: "ECOMM" },
  { ID_Cotacao: 907568, Prazo: 1, Total: 139.82, Servico: "EXPRESSO" },
  { ID_Cotacao: 935927, Prazo: 5, Total: 231.2, Servico: "STANDARD" },
  { ID_Cotacao: 1, Prazo: 2, Total: 10, Servico: "ECOMM_CORP" }
]);
const cards = mapearCotacoesAzul(lerCorpoCotacaoAzul(corpo), entrada);
assert.deepEqual(cards.map((c) => c.servico), ["ECOMM", "AZUL EXPRESSO", "AZUL STANDARD"]);
assert.deepEqual(cards.map((c) => c.id), ["frete_azul_ecomm_0", "frete_azul_azul_expresso_1", "frete_azul_azul_standard_2"]);
assert.equal(new Set(cards.map((c) => c.id)).size, 3);
assert.ok(cards.every((c) => c.transportadora === "Azul Cargo"));
assert.equal(cards[0].valor, 40.19 * 1.15);
assert.equal(cards[1].prazo, "1 dia útil");
assert.equal(cards[2].id_cotacao, 935927);

// 2. Corpo vazio: zero cards, sem lançar.
assert.deepEqual(mapearCotacoesAzul(lerCorpoCotacaoAzul(""), entrada), []);
// Formato antigo (objeto único) segue aceito.
assert.equal(mapearCotacoesAzul(lerCorpoCotacaoAzul('{"ID_Cotacao":1,"Prazo":3,"Total":10,"Servico":"ECOMM"}'), entrada).length, 1);

// 3. Reconhecimento por texto dos três nomes gravados.
for (const c of cards) {
  const frete = { transportadora: c.transportadora, servico: c.servico };
  assert.equal(resolverTransportadoraParceira(frete), TRANSPORTADORAS_PARCEIRAS.AZUL, c.servico);
  assert.equal(normalizarTipoFrete(c.servico), "TRANSPORTADORA", c.servico);
  assert.equal(categoriaDoServico(c.transportadora, c.servico, "CIF"), "AEREO", c.servico);
  assert.ok(servicoDoFrete(TRANSPORTADORAS_PARCEIRAS.AZUL, frete) !== null, c.servico);
}

console.log("cotacao-azul.test.mts: ok (3 cards distintos; corpo vazio = 0 cards; nomes reconhecidos como Azul)");
