/**
 * Carta de correção no menu da nota: PDF e XML por carta (17/11/2026, NF 41390).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/carta-correcao-arquivo.test.mts
 *
 * Sem banco e sem Focus: procEventoNFe de CC-e montado aqui (valores fictícios)
 * e as regras puras de lib/fiscal/carta-correcao-arquivo.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  caminhoDoXmlDaCarta,
  cartasDaNota,
  lerEventoCartaCorrecao,
  nomeDaCartaDeCorrecao,
  rotulosDaCarta,
  sequenciaDaCarta
} from "@/lib/fiscal/carta-correcao-arquivo";

let ok = 0;
function caso(nome: string, fn: () => void) {
  fn();
  ok += 1;
  console.log(`ok - ${nome}`);
}

const CHAVE = "43261199888777000166550020000413901999999999";
function cce(op: { seq?: string; tpEvento?: string; cStat?: string; chaveResposta?: string } = {}) {
  const seq = op.seq ?? "2";
  return `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe versao="1.00"><evento versao="1.00"><infEvento Id="ID110110${CHAVE}0${seq}"><cOrgao>43</cOrgao><tpAmb>1</tpAmb><CNPJ>99888777000166</CNPJ><chNFe>${CHAVE}</chNFe><dhEvento>2026-11-17T12:56:57-03:00</dhEvento><tpEvento>${op.tpEvento ?? "110110"}</tpEvento><nSeqEvento>${seq}</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Carta de Correcao</descEvento><xCorrecao>informações adicionais : TP 002/2022 &amp; outro</xCorrecao><xCondUso>A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N.</xCondUso></detEvento></infEvento></evento><retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><cOrgao>43</cOrgao><cStat>${op.cStat ?? "135"}</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${op.chaveResposta ?? CHAVE}</chNFe><tpEvento>110110</tpEvento><nSeqEvento>${seq}</nSeqEvento><dhRegEvento>2026-11-17T12:56:57-03:00</dhRegEvento><nProt>999000000000333</nProt></infEvento></retEvento></procEventoNFe>`;
}

caso("lê a carta: texto da correção, condições, sequência e protocolo", () => {
  const r = lerEventoCartaCorrecao(cce());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.evento.chave, CHAVE);
  assert.equal(r.evento.sequencia, "2");
  assert.equal(r.evento.protocolo, "999000000000333");
  assert.equal(r.evento.cStat, "135");
  assert.equal(r.evento.correcao, "informações adicionais : TP 002/2022 & outro");
  assert.match(r.evento.condicoesDeUso, /Convenio/);
  assert.equal(r.evento.ambiente, "producao");
});

caso("recusa o que não é carta registrada", () => {
  for (const [nome, xml] of [
    ["cancelamento", cce({ tpEvento: "110111" })],
    ["rejeitada", cce({ cStat: "573" })],
    ["chave diferente", cce({ chaveResposta: CHAVE.slice(0, 43) + "0" })],
    ["vazio", ""]
  ] as const) assert.equal(lerEventoCartaCorrecao(xml).ok, false, nome);
});

// Eventos como estão no banco para a NF 41390 (NFE-24253-004) + casos de borda.
const E1 = { tipo_evento: "CARTA_CORRECAO", status_sefaz: "135", sequencia_evento: null, payload_retorno: { numero_carta_correcao: 1 }, caminho_xml: "/arquivos/x/43...674-cce-01.xml" };
const E2 = { tipo_evento: "CARTA_CORRECAO", status_sefaz: "135", sequencia_evento: null, payload_retorno: { numero_carta_correcao: 2 }, caminho_xml: "/arquivos/x/43...674-cce-02.xml" };

caso("sequência: coluna, retorno da Focus ou nome do XML", () => {
  assert.equal(sequenciaDaCarta({ sequencia_evento: 3 }), 3);
  assert.equal(sequenciaDaCarta(E2), 2);
  assert.equal(sequenciaDaCarta({ caminho_xml: "/a/b-cce-07.xml" }), 7);
  assert.equal(sequenciaDaCarta({}), null);
});

caso("cartas da nota: só 135, uma por sequência, em ordem", () => {
  assert.deepEqual(cartasDaNota([E2, E1]), [1, 2]);
  assert.deepEqual(cartasDaNota([E2, E2, E1]), [1, 2]);
  assert.deepEqual(cartasDaNota([{ ...E1, status_sefaz: "573" }]), []);
  assert.deepEqual(cartasDaNota([{ ...E1, tipo_evento: "CANCELAMENTO" }]), []);
  assert.deepEqual(cartasDaNota(null), []);
});

caso("rótulos, caminho e nome", () => {
  assert.deepEqual(rotulosDaCarta(1, 1), { pdf: "Baixar carta de correção (PDF)", xml: "Baixar carta de correção (XML)" });
  assert.deepEqual(rotulosDaCarta(2, 2), { pdf: "Baixar carta de correção nº 2 (PDF)", xml: "Baixar carta de correção nº 2 (XML)" });
  assert.equal(caminhoDoXmlDaCarta("NFE-24253-004", 2), "NFE-24253-004/cce-02.xml");
  assert.equal(caminhoDoXmlDaCarta("NFE-1-001", 12), "NFE-1-001/cce-12.xml");
  assert.equal(nomeDaCartaDeCorrecao({ numero: "41390", idInt: 24253, ref: "NFE-24253-004", sequencia: 2 }, "pdf"), "Carta-de-Correcao-2-NF-e-41390-Pedido-24253.pdf");
});

caso("rota e tela: sem link direto da Focus, eventos lidos em lotes", () => {
  const rota = readFileSync("src/app/api/fiscal/carta-correcao/arquivo/route.ts", "utf8");
  assert.doesNotMatch(rota, /focusnfe\.com/);
  assert.match(rota, /cartasDaNota\(/);
  assert.match(rota, /lerEventoCartaCorrecao\(/);
  const tela = readFileSync("src/features/fiscal/NotasFiscaisPage.tsx", "utf8");
  assert.doesNotMatch(tela, /Abrir Carta de Correção \(PDF\)/);
  assert.doesNotMatch(tela, /cartas_correcao|caminho_pdf_carta_correcao/);
  assert.match(tela, /itensDasCartasDeCorrecao\(item\)/);
  const servico = readFileSync("src/features/nfe/services/nfe.service.ts", "utf8");
  const trecho = servico.slice(servico.indexOf("export async function getNotaEventosForRefs"), servico.indexOf("export async function getNotaEventosForRefs") + 1500);
  assert.match(trecho, /lerPorIds</);
});

console.log(`\n${ok} casos passaram.`);
