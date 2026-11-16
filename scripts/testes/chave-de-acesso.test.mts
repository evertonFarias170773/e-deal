/**
 * Copiar chave de acesso e nome do comprovante de cancelamento (16/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/chave-de-acesso.test.mts
 *
 * Sem banco: valores no formato real das colunas (chave_nfe com "NFe",
 * payload_retorno da NFS-e Nacional com a chave na url da consulta pública).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chaveDaNfe, chaveDaNfse, chaveParaCopiar } from "@/lib/fiscal/chave-de-acesso";
import { nomeDoComprovanteDeCancelamento } from "@/lib/fiscal/comprovante-cancelamento";

let ok = 0;
function caso(nome: string, fn: () => void) {
  fn();
  ok += 1;
  console.log(`ok - ${nome}`);
}

const CHAVE = "43261114152597000102550020000485971261112851";
const CHAVE_NFSE = "43149022233413131000150000000000016126118433851813";
const URL_NFSE = `https://www.nfse.gov.br/consultapublica/?tpc=1&chave=${CHAVE_NFSE}`;

caso("NF-e: tira o prefixo NFe e devolve 44 dígitos", () => {
  assert.equal(chaveDaNfe(`NFe${CHAVE}`), CHAVE);
  assert.equal(chaveDaNfe(CHAVE), CHAVE);
  assert.equal(chaveDaNfe(` NFe${CHAVE} `), CHAVE);
});

caso("NF-e: fora do formato não copia", () => {
  assert.equal(chaveDaNfe(null), null);
  assert.equal(chaveDaNfe(""), null);
  assert.equal(chaveDaNfe(`NFe${CHAVE.slice(1)}`), null);
  assert.equal(chaveDaNfe(`${CHAVE}0`), null);
});

caso("NFS-e: chave de 50 dígitos lida da url da consulta", () => {
  assert.equal(chaveDaNfse({ url: URL_NFSE }), CHAVE_NFSE);
  assert.equal(chaveDaNfse({ url: `${URL_NFSE}&x=1` }), CHAVE_NFSE);
  assert.equal(chaveDaNfse({ chave: CHAVE_NFSE }), CHAVE_NFSE);
  assert.equal(chaveDaNfse({ url: "https://www.nfse.gov.br/consultapublica/?tpc=1" }), null);
  assert.equal(chaveDaNfse(null), null);
});

caso("só AUTORIZADA e CANCELADA oferecem a ação", () => {
  for (const status of ["AUTORIZADA", "autorizada", "CANCELADA"]) {
    assert.equal(chaveParaCopiar({ modelo: "nfe", status, chave_nfe: `NFe${CHAVE}` }), CHAVE, status);
    assert.equal(chaveParaCopiar({ modelo: "nfse", status, payload_retorno: { url: URL_NFSE } }), CHAVE_NFSE, status);
  }
  for (const status of ["RASCUNHO", "PENDENTE", "ERRO", "DENEGADA", "PROCESSANDO", "", null]) {
    assert.equal(chaveParaCopiar({ modelo: "nfe", status, chave_nfe: `NFe${CHAVE}` }), null, String(status));
    assert.equal(chaveParaCopiar({ modelo: "nfse", status, payload_retorno: { url: URL_NFSE } }), null, String(status));
  }
});

caso("nome do comprovante de cancelamento", () => {
  assert.equal(nomeDoComprovanteDeCancelamento({ numero: 48597, idInt: 25028, ref: "NFE-25028-001" }), "Cancelamento-NF-e-48597-Pedido-25028.xml");
  assert.equal(nomeDoComprovanteDeCancelamento({ numero: null, idInt: null, ref: "NFE-25028-001" }), "Cancelamento-NF-e-NFE-25028-001.xml");
});

caso("a rota só aceita NF-e cancelada e não fala com a Focus", () => {
  const fonte = readFileSync("src/app/api/fiscal/comprovante-cancelamento/route.ts", "utf8");
  assert.match(fonte, /\.eq\("ref", ref\)/);
  assert.match(fonte, /!== "CANCELADA"/);
  assert.match(fonte, /`\$\{ref\}\/cancelamento\.xml`/);
  assert.doesNotMatch(fonte, /focusnfe/i);
});

console.log(`\n${ok} casos passaram.`);
