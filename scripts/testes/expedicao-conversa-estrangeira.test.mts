/**
 * v30 da expedicao-pedido-pronto (16/11/2026): conversa com número de fora do Brasil.
 *
 *   node --experimental-strip-types scripts/testes/expedicao-conversa-estrangeira.test.mts
 *
 * Caso real: pedido 25289, conversa "Olga Lencina - 58011", +598 95038797. A regra
 * é cópia de numeroEstrangeiro (src/lib/telefone/telefone-br.ts, 084ba9c5); aqui
 * também se confere que as duas dão o mesmo resultado. Brasileiro igual a antes.
 */
import assert from "node:assert/strict";
import {
  numeroDaConversa,
  numeroEstrangeiro,
  conversasEscolhidas,
  conversaDaProposta,
  conversasDoOrcamento,
  decidirConversa,
  dddFinal8
} from "../../supabase/edge-no-ar/expedicao-pedido-pronto/logica.ts";
import { numeroEstrangeiro as doVibe } from "../../src/lib/telefone/telefone-br.ts";

let n = 0;
function caso(nome: string, fn: () => void) {
  fn();
  n++;
  console.log(`ok - ${nome}`);
}

const OLGA = "59895038797";
const olga = { chat_id: "chat-olga", nome: "Olga Lencina - 58011", numero: OLGA };
const edison = { chat_id: "chat-edison", nome: "Edison Junior - 14", numero: "555184608848" };

caso("número da Olga aceito, sem mudança", () => {
  assert.equal(numeroDaConversa(OLGA), OLGA);
  assert.equal(numeroDaConversa("+598 95038797"), OLGA);
  assert.deepEqual(["595981234567", "351912345678", "5491123456789"].map(numeroDaConversa), ["595981234567", "351912345678", "5491123456789"]);
});

caso("brasileiro igual a antes", () => {
  // Aceitos como antes (com e sem o 9).
  assert.deepEqual(["5551991010423", "555184608848", "5516996256252"].map(numeroDaConversa), ["5551991010423", "555184608848", "5516996256252"]);
  // Sem o 55 continua fora (10 e 11 dígitos com DDD do Brasil).
  assert.deepEqual(["5184608848", "51984608848", "41712345678"].map(numeroDaConversa), [null, null, null]);
  // Ids de 14/15 dígitos e lixo continuam fora.
  assert.deepEqual(["193123456789012", "98512345678901", "", "abc", "0598950387970", "123"].map(numeroDaConversa), [null, null, null, null, null, null]);
  assert.equal(numeroDaConversa(59895038797 as unknown), null);
  // Casamento automático pelo telefone do contato: igual.
  assert.deepEqual(decidirConversa("51984608848", [edison, olga]), { modo: "automatica", conversa: edison });
  assert.equal(dddFinal8("555184608848"), "5184608848");
});

caso("cópia da função igual à do Vibe", () => {
  for (const v of [OLGA, "+598 95038797", "595981234567", "5491123456789", "51984608848", "41712345678", "5551991010423", "193123456789012", "", "abc"]) {
    assert.equal(numeroEstrangeiro(v), doVibe(v), v);
  }
});

caso("conversa da Olga escolhida: avisos e orçamento vão para ela", () => {
  // Aviso com a principal (aba Artes / Contatos do pedido).
  assert.deepEqual(conversaDaProposta("chat-olga", [edison, olga]), olga);
  // Escolha na tela (chat_ids) e "todas".
  assert.deepEqual(conversasEscolhidas(["chat-olga"], [edison, olga]), [olga]);
  assert.deepEqual(conversasEscolhidas(null, [olga], true), [olga]);
  // Enviar pelo ChatGuru do box 9.
  assert.deepEqual(conversasDoOrcamento([{ chat_id: "chat-olga", principal: true }], [edison, olga]), { validas: [olga], fora: [] });
  // Sem principal e sem telefone que case: a Olga aparece na escolha.
  assert.deepEqual(decidirConversa("", [olga]), { modo: "escolha", motivo: "nenhuma", conversas: [olga] });
});

console.log(`\n${n} casos ok`);
