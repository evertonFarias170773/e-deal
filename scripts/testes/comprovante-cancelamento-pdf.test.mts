/**
 * Comprovante de cancelamento em PDF e ícone de DANFE da própria nota (16/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/comprovante-cancelamento-pdf.test.mts
 *
 * Sem banco e sem Focus: procEventoNFe no leiaute da SEFAZ montado aqui (valores
 * fictícios), as funções puras de leitura e `danfeDaNota`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chaveEmBlocos,
  dataHoraDeBrasilia,
  documentoFormatado,
  lerEventoDeCancelamento,
  lerPartesDaNfe,
  nomeDoComprovanteDeCancelamento,
  serieENumeroDaChave
} from "@/lib/fiscal/comprovante-cancelamento";
import { danfeDaNota, danfesDoPedido } from "@/lib/fiscal/danfes-do-pedido";

let ok = 0;
function caso(nome: string, fn: () => void) {
  fn();
  ok += 1;
  console.log(`ok - ${nome}`);
}

const CHAVE = "43261199888777000166550020000123451999999999";
function evento(op: { tpEvento?: string; cStat?: string; chaveResposta?: string; semRet?: boolean } = {}) {
  const ret = op.semRet
    ? ""
    : `<retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><verAplic>RS2026</verAplic><cOrgao>43</cOrgao><cStat>${op.cStat ?? "135"}</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${op.chaveResposta ?? CHAVE}</chNFe><tpEvento>${op.tpEvento ?? "110111"}</tpEvento><xEvento>Cancelamento</xEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-11-12T14:56:59-03:00</dhRegEvento><nProt>999000000000222</nProt></infEvento></retEvento>`;
  return `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><evento versao="1.00"><infEvento Id="ID110111${CHAVE}01"><cOrgao>43</cOrgao><tpAmb>1</tpAmb><CNPJ>99888777000166</CNPJ><chNFe>${CHAVE}</chNFe><dhEvento>2026-11-12T14:56:57-03:00</dhEvento><tpEvento>${op.tpEvento ?? "110111"}</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>999000000000111</nProt><xJust>emitida em duplicidade &amp; valor errado</xJust></detEvento></infEvento><Signature/></evento>${ret}</procEventoNFe>`;
}

caso("lê o evento: protocolos certos em cada seção", () => {
  const r = lerEventoDeCancelamento(evento());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.evento.chave, CHAVE);
  assert.equal(r.evento.cnpjEmitente, "99888777000166");
  assert.equal(r.evento.protocoloAutorizacao, "999000000000111");
  assert.equal(r.evento.protocoloCancelamento, "999000000000222");
  assert.equal(r.evento.cStat, "135");
  assert.equal(r.evento.motivo, "Evento registrado e vinculado a NF-e");
  assert.equal(r.evento.justificativa, "emitida em duplicidade & valor errado");
  assert.equal(r.evento.dataRegistro, "2026-11-12T14:56:59-03:00");
  assert.equal(r.evento.ambiente, "producao");
});

caso("155 também é cancelamento confirmado", () => {
  assert.equal(lerEventoDeCancelamento(evento({ cStat: "155" })).ok, true);
});

caso("recusa o que não é cancelamento confirmado", () => {
  for (const [nome, xml] of [
    ["carta de correção", evento({ tpEvento: "110110" })],
    ["rejeitado", evento({ cStat: "573" })],
    ["sem resposta da SEFAZ", evento({ semRet: true })],
    ["chave diferente na resposta", evento({ chaveResposta: CHAVE.slice(0, 43) + "0" })],
    ["vazio", ""],
    ["lixo", "<html>erro</html>"]
  ] as const) {
    const r = lerEventoDeCancelamento(xml);
    assert.equal(r.ok, false, nome);
  }
});

caso("partes da NF-e e série/número da chave", () => {
  const nfe = `<nfeProc><NFe><infNFe><ide><serie>2</serie><nNF>12345</nNF></ide><emit><CNPJ>99888777000166</CNPJ><xNome>EMPRESA TESTE LTDA</xNome></emit><dest><CPF>12345678909</CPF><xNome>CLIENTE TESTE</xNome></dest></infNFe></NFe></nfeProc>`;
  const p = lerPartesDaNfe(nfe);
  assert.deepEqual(p.emitente, { nome: "EMPRESA TESTE LTDA", documento: "99888777000166" });
  assert.deepEqual(p.destinatario, { nome: "CLIENTE TESTE", documento: "12345678909" });
  assert.deepEqual(serieENumeroDaChave(CHAVE), { serie: "2", numero: "12345" });
  assert.deepEqual(lerPartesDaNfe(null), { emitente: null, destinatario: null, serie: "", numero: "" });
});

caso("formatação", () => {
  assert.equal(chaveEmBlocos(CHAVE), "4326 1199 8887 7700 0166 5500 2000 0123 4519 9999 9999");
  assert.equal(documentoFormatado("99888777000166"), "99.888.777/0001-66");
  assert.equal(documentoFormatado("12345678909"), "123.456.789-09");
  assert.equal(dataHoraDeBrasilia("2026-11-12T14:56:59-03:00"), "12/11/2026 14:56:59");
  assert.equal(dataHoraDeBrasilia("2026-11-11 18:36:14+00"), "11/11/2026 15:36:14");
  assert.equal(dataHoraDeBrasilia(null), "");
  assert.equal(nomeDoComprovanteDeCancelamento({ numero: "48597", idInt: 25028, ref: "NFE-25028-001" }, "pdf"), "Cancelamento-NF-e-48597-Pedido-25028.pdf");
  assert.equal(nomeDoComprovanteDeCancelamento({ numero: "48597", idInt: 25028, ref: "NFE-25028-001" }), "Cancelamento-NF-e-48597-Pedido-25028.xml");
});

// Pedido 25028 como está no banco: 001 cancelada, 002 autorizada substituta.
const N001 = { ref: "NFE-25028-001", numero_nf: "48597", status: "CANCELADA", ambiente: "producao", url_danfe: "https://x/NFE-25028-001/danfe.pdf", data_autorizacao: "2026-11-11T18:36:14Z" };
const N002 = { ref: "NFE-25028-002", numero_nf: "48616", status: "AUTORIZADA", ambiente: "producao", url_danfe: "https://x/NFE-25028-002/danfe.pdf", data_autorizacao: "2026-11-12T18:31:21Z" };

caso("o defeito: o inventário do pedido, na linha da 001, só tinha a 002", () => {
  const doPedido = danfesDoPedido([N001, N002]);
  assert.deepEqual(doPedido.map((d) => d.ref), ["NFE-25028-002"]);
});

caso("ícone da linha: cada nota baixa a própria DANFE", () => {
  assert.deepEqual(danfeDaNota(N001).map((d) => [d.ref, d.rotulo]), [["NFE-25028-001", "NF cancelada"]]);
  assert.deepEqual(danfeDaNota(N002).map((d) => [d.ref, d.rotulo]), [["NFE-25028-002", "NF venda"]]);
  assert.deepEqual(danfeDaNota({ ...N002, tipo_nota: "REMESSA" }).map((d) => d.rotulo), ["NF remessa"]);
});

caso("ícone da linha: sem DANFE, sem botão", () => {
  for (const nota of [
    { ...N002, status: "PENDENTE" },
    { ...N002, status: "DENEGADA" },
    { ...N002, ambiente: "homologacao" },
    { ...N002, numero_nf: null },
    { ...N002, url_danfe: "" },
    null
  ]) assert.deepEqual(danfeDaNota(nota), []);
});

caso("a tela usa danfeDaNota nas duas vistas do Histórico, e a rota aceita pdf", () => {
  const tela = readFileSync("src/features/fiscal/NotasFiscaisPage.tsx", "utf8");
  assert.equal((tela.match(/<BotaoDanfe danfes=\{danfeDaNota\(item\)\} \/>/g) || []).length, 2);
  assert.doesNotMatch(tela, /danfesPorPedido/);
  assert.match(tela, /Baixar comprovante de cancelamento \(PDF\)/);
  assert.match(tela, /Baixar comprovante de cancelamento \(XML\)/);
  const rota = readFileSync("src/app/api/fiscal/comprovante-cancelamento/route.ts", "utf8");
  assert.match(rota, /formato !== "xml" && formato !== "pdf"/);
  assert.match(rota, /lerEventoDeCancelamento/);
  assert.doesNotMatch(rota, /focusnfe/i);
});

console.log(`\n${ok} casos passaram.`);
