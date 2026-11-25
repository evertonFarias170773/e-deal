/**
 * Coluna "Contas a Receber" do Histórico de notas fiscais (25/11/2026).
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/financeiro-status-nfe.test.mts
 *
 * SEM banco. A regra do selo (`statusFinanceiroDaNfe`) e o desenho da leitura
 * (`getNfeFinanceiroStatus` em lotes, com `falhou`).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { statusFinanceiroDaNfe } from "@/features/fiscal/lib/financeiro-status-nfe";

let ok = 0;
function caso(nome: string, fn: () => void) {
  fn();
  ok += 1;
  console.log(`ok - ${nome}`);
}

const boletoC6 = { valor: 7560, deposito_conta: false, id_boleto_c6: "abc", nosso_numero: "123", linha_digitavel: "0019..." };

caso("A. leitura falhou: 'Não foi possível carregar', nunca 'Sem vencimentos'", () => {
  const s = statusFinanceiroDaNfe({ valorTotalNf: 7560, qtdParcelasAtivas: undefined, boletos: undefined, leituraFalhou: true });
  assert.equal(s.status, "ERRO_LEITURA");
  assert.equal(s.label, "Não foi possível carregar");
  // Mesmo com dados velhos na tela, a falha manda.
  assert.equal(statusFinanceiroDaNfe({ valorTotalNf: 7560, qtdParcelasAtivas: 1, boletos: [boletoC6], leituraFalhou: true }).status, "ERRO_LEITURA");
});

caso("B. leitura boa sem parcela: 'Sem vencimentos fiscais' (como antes)", () => {
  const s = statusFinanceiroDaNfe({ valorTotalNf: 100, qtdParcelasAtivas: 0, boletos: [] });
  assert.equal(s.status, "SEM_VENCIMENTOS");
  assert.equal(s.label, "Sem vencimentos fiscais");
});

caso("C. demais selos na mesma ordem de antes", () => {
  assert.equal(statusFinanceiroDaNfe({ valorTotalNf: 100, qtdParcelasAtivas: 1, boletos: [] }).status, "NAO_LANCADO");
  assert.equal(statusFinanceiroDaNfe({ valorTotalNf: 100, qtdParcelasAtivas: 1, boletos: [{ ...boletoC6, valor: 150 }] }).status, "DIVERGENCIA");
  assert.equal(statusFinanceiroDaNfe({ valorTotalNf: 100, qtdParcelasAtivas: 1, boletos: [{ ...boletoC6, valor: 50 }] }).status, "PARCIAL");
  assert.equal(statusFinanceiroDaNfe({ valorTotalNf: 100, qtdParcelasAtivas: 1, boletos: [{ valor: 100, deposito_conta: true, id_boleto_c6: null, nosso_numero: null, linha_digitavel: null }] }).status, "DEPOSITO_CONTA");
  assert.equal(statusFinanceiroDaNfe({ valorTotalNf: 7560, qtdParcelasAtivas: 1, boletos: [boletoC6] }).status, "BOLETO_REGISTRADO");
  assert.equal(statusFinanceiroDaNfe({ valorTotalNf: 100, qtdParcelasAtivas: 1, boletos: [{ valor: 100, deposito_conta: false, id_boleto_c6: "x", nosso_numero: null, linha_digitavel: null }] }).status, "BOLETO_EM_PROCESSAMENTO");
  assert.equal(statusFinanceiroDaNfe({ valorTotalNf: 100, qtdParcelasAtivas: 1, boletos: [{ valor: 100, deposito_conta: false, id_boleto_c6: null, nosso_numero: null, linha_digitavel: null }] }).status, "A_RECEBER_CRIADO");
});

caso("D. leitura em lotes e com 'falhou'; a tela não oferece lançar com erro", () => {
  const servico = readFileSync("src/features/nfe/services/nfe.service.ts", "utf8");
  const corpo = servico.slice(servico.indexOf("export async function getNfeFinanceiroStatus"), servico.indexOf("export async function getNfeFinanceiroStatus") + 4000);
  assert.equal((corpo.match(/lerPorIds</g) ?? []).length, 2);
  assert.doesNotMatch(corpo, /\.in\("ref", refs\)/);
  assert.doesNotMatch(corpo, /\.in\("ext_reference", refs\)/);
  assert.match(corpo, /falhou: true/);
  const tela = readFileSync("src/features/fiscal/NotasFiscaisPage.tsx", "utf8");
  assert.match(tela, /leituraFalhou: financeiroFalhouMap\[ref\] === true/);
  assert.match(tela, /finStatus\.status !== "ERRO_LEITURA"/);
});

console.log(`\n${ok} casos passaram.`);
