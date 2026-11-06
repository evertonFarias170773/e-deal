/**
 * Aviso "pedido pronto" pelo ChatGuru (06/11/2026): regras puras da Edge Function
 * supabase/functions/expedicao-pedido-pronto/logica.ts.
 *
 *   node --experimental-strip-types scripts/testes/expedicao-aviso-pronto.test.mts
 *
 * SEM rede e SEM banco.
 *   A. modo teste: ligado sem variável e com qualquer valor que não seja "desligado";
 *   B. modo teste troca o destino pelo número de teste;
 *   C. telefone: tira formatação, põe 55, não mexe no nono dígito, recusa lixo;
 *   D. forma de envio: retirada, Correios, motoboy, transportadora com nome;
 *   E. mensagem padrão e itens (cancelado fica fora);
 *   F. aceite: só 2xx + success + 201 + message_id.
 */
import assert from "node:assert/strict";
import {
  NUMERO_TESTE,
  destinoFinal,
  envioAceito,
  envioRecusado,
  formaDeEnvio,
  linhasDeItens,
  modoTesteLigado,
  montarMensagem,
  telefoneWhatsApp
} from "../../supabase/functions/expedicao-pedido-pronto/logica.ts";

let n = 0;
function caso(nome: string, fn: () => void) {
  fn();
  n++;
  console.log(`ok - ${nome}`);
}

caso("A. modo teste ligado por padrão", () => {
  assert.equal(modoTesteLigado(undefined), true);
  assert.equal(modoTesteLigado(""), true);
  assert.equal(modoTesteLigado("false"), true);
  assert.equal(modoTesteLigado("0"), true);
  assert.equal(modoTesteLigado(" Desligado "), false);
});

caso("B. modo teste troca qualquer destino pelo número de teste", () => {
  assert.equal(destinoFinal("5551991107694", true), NUMERO_TESTE);
  assert.equal(destinoFinal("5511999998888", true), "5551984608848");
  assert.equal(destinoFinal("5511999998888", false), "5511999998888");
});

caso("C. telefone", () => {
  assert.equal(telefoneWhatsApp("51985018848", "55"), "5551985018848");
  assert.equal(telefoneWhatsApp("(51) 98501-8848", "55"), "5551985018848");
  assert.equal(telefoneWhatsApp("5551984608848", "55"), "5551984608848");
  assert.equal(telefoneWhatsApp("+55 (51) 84608848", "55"), "555184608848"); // sem nono dígito: fica sem
  assert.equal(telefoneWhatsApp("5184608848", "55"), "555184608848");
  assert.throws(() => telefoneWhatsApp("", "55"));
  assert.throws(() => telefoneWhatsApp(null, "55"));
  assert.throws(() => telefoneWhatsApp("abc", "55"));
  assert.throws(() => telefoneWhatsApp("123", "55"));
  assert.throws(() => telefoneWhatsApp("51985018848", ""));
  assert.throws(() => telefoneWhatsApp("+1 415 555 0100", "55"));
});

caso("D. forma de envio", () => {
  const base = { expedicao: null, modalidadeOrcamento: null, servicoCotacao: null, nomeTransportadoraCadastro: null };
  assert.equal(formaDeEnvio({ ...base, expedicao: { modalidade_frete: "RETIRA", tipo_frete: "RETIRA_BALCAO" } }), "Retirada no balcão");
  assert.equal(formaDeEnvio({ ...base, expedicao: { modalidade_frete: "CIF", tipo_frete: "CORREIOS" } }), "Entrega pelos Correios");
  assert.equal(formaDeEnvio({ ...base, expedicao: { modalidade_frete: "CIF", tipo_frete: "MOTOBOY" } }), "Entrega por motoboy");
  assert.equal(
    formaDeEnvio({ ...base, expedicao: { modalidade_frete: "FOB", tipo_frete: "TRANSPORTADORA", transportadora_nome: "Braspress" } }),
    "Entrega pela transportadora Braspress"
  );
  assert.equal(
    formaDeEnvio({ ...base, expedicao: { tipo_frete: "TRANSPORTADORA" }, nomeTransportadoraCadastro: "Rodonaves" }),
    "Entrega pela transportadora Rodonaves"
  );
  assert.equal(formaDeEnvio({ ...base, modalidadeOrcamento: "RETIRA" }), "Retirada no balcão");
  assert.equal(formaDeEnvio({ ...base, servicoCotacao: "RETIRADA" }), "Retirada no balcão");
  assert.equal(formaDeEnvio({ ...base, servicoCotacao: "SEDEX" }), "Entrega (SEDEX)");
  assert.equal(formaDeEnvio(base), "Entrega");
});

caso("E. mensagem padrão", () => {
  const itens = linhasDeItens([
    { nome_produto: "Ingresso", qtd: 1500, status_item: "PENDENTE" },
    { nome_produto: "Pulseira", qtd: 200, status_item: "CANCELADO" },
    { nome_produto: "Cartão\nde visita", qtd: 1000, status_item: null }
  ]);
  assert.deepEqual(itens, ["• 1.500 x Ingresso", "• 1.000 x Cartão de visita"]);
  const texto = montarMensagem({ nomeContato: "Edison Junior", idInt: 24880, itens, formaEnvio: "Retirada no balcão" });
  assert.equal(
    texto,
    [
      "Olá, Edison Junior!",
      "Seu pedido 24880 está pronto. ✅",
      "• 1.500 x Ingresso",
      "• 1.000 x Cartão de visita",
      "Forma de envio: Retirada no balcão",
      "Qualquer dúvida, é só responder esta mensagem."
    ].join("\n")
  );
});

caso("F. aceite e recusa do ChatGuru", () => {
  assert.equal(envioAceito(201, { result: "success", code: 201, message_id: "abc_123" }), "abc_123");
  assert.equal(envioAceito(200, { result: "success", code: 201, message_id: "abc" }), "abc");
  assert.equal(envioAceito(200, { result: "success", code: 200, message_id: "abc" }), null);
  assert.equal(envioAceito(200, { result: "success", code: 201 }), null);
  assert.equal(envioAceito(302, { result: "success", code: 201, message_id: "abc" }), null);
  assert.equal(envioAceito(200, { result: "success", code: 201, message_id: "a b" }), null);
  assert.equal(envioRecusado(400, { result: "error", code: 400 }), true);
  assert.equal(envioRecusado(500, { result: "error", code: 400 }), false);
  assert.equal(envioRecusado(200, { result: "success", code: 201 }), false);
});

console.log(`\n${n} casos ok`);
