/**
 * Conversa do ChatGuru com número de fora do Brasil (16/11/2026, pedido 25289,
 * cliente 58011, Olga Lencina, 598 95038797). A aba Geral descartava qualquer
 * número sem o 55; a função do 9 devolvia vazio.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/conversa-estrangeira.test.mts
 */
import { numeroEstrangeiro, telefoneParaApi } from "../../src/lib/telefone/telefone-br.ts";
import { telefoneDaCobranca } from "../../src/features/cobrancas/lib/contato-da-cobranca.ts";
import { numeroDaConversa, numeroParaExibir, situacaoDaConversa } from "../../src/features/orcamentos/lib/conversa-whatsapp.ts";

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

const OLGA = "59895038797";

// ── Lista da aba Geral ──
checar("conversa da Olga (Uruguai) entra na lista", numeroDaConversa(OLGA), OLGA);
checar("Paraguai (595, 12 dígitos), Portugal (351) e Argentina (549, 13) entram",
  ["595981234567", "351912345678", "5491123456789"].map(numeroDaConversa), ["595981234567", "351912345678", "5491123456789"]);
checar("brasileiros continuam iguais (com e sem o 9)", ["5551991010423", "555184608848", "5516996256252"].map(numeroDaConversa), ["5551991010423", "555184608848", "5516996256252"]);
checar("brasileiro sem o 55 continua fora (10 e 11 dígitos com DDD)", ["5184608848", "51984608848", "41712345678"].map(numeroDaConversa), [null, null, null]);
checar("ids de 14/15 dígitos e lixo continuam fora", ["193123456789012", "98512345678901", "", "abc", "0598950387970"].map(numeroDaConversa), [null, null, null, null, null]);
checar("situação: a conversa da Olga é a única, já vem escolhida e libera",
  (() => { const s = situacaoDaConversa([{ chat_id: "648f8482656d3b4a963b63dc", nome: "Olga Lencina - 58011", numero: OLGA }], null); return [s.conversas.length, s.escolhida?.numero, s.liberado, s.semConversa]; })(),
  [1, OLGA, true, false]);
checar("exibição", [numeroParaExibir(OLGA), numeroParaExibir("5551991010423"), numeroParaExibir("555184608848")], ["+598 95038797", "(51) 99101-0423", "(51) 8460-8848"]);

// ── Função do 9 (PIX, boleto à vista) ──
checar("função do 9 devolve 59895038797 sem mudança", telefoneParaApi(OLGA), OLGA);
checar("estrangeiro de 12 e 13 dígitos sem mudança", ["595981234567", "5491123456789"].map(telefoneParaApi), ["595981234567", "5491123456789"]);
checar("brasileiro: celular sem o 9 ganha o 9, com o 9 e fixo não mudam",
  ["555199101042", "5551991010423", "555130932840"].map(telefoneParaApi), ["51999101042", "51991010423", "5130932840"]);
checar("brasileiro sem o 55 de 11 dígitos continua pela regra nacional", [telefoneParaApi("51984608848"), telefoneParaApi("51884608848")], ["51984608848", ""]);
checar("cobrança: a principal estrangeira vai como está (origem CHATGURU)", telefoneDaCobranca(OLGA, "51999999999"), { telefone: OLGA, origemTelefone: "CHATGURU" });
checar("numeroEstrangeiro recusa número com 55", [numeroEstrangeiro("5551991010423"), numeroEstrangeiro("55123456789")], [null, null]);

if (falhas) {
  console.log(`\n${falhas} falha(s)`);
  process.exit(1);
}
console.log("\ntodos passaram");
