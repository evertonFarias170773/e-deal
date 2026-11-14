/**
 * Texto do box 9 x texto gravado no Salvar (14/11/2026, caso 25281).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/frete-do-texto-gravado.test.mts
 *
 * Card fabricado de proposta sem cotação: o texto gravado sai com o nome com que
 * o card volta do banco (o que o box 9 mostra depois do Salvar). Outros cards e
 * Salvar que não regrava a cotação ficam como estão.
 */
import assert from "node:assert/strict";
import { buildPropostaInformalText } from "../../src/features/orcamentos/orcamento-utils.ts";
import { freteDoTextoGravado, rotuloDoServicoGravado } from "../../src/features/orcamentos/lib/frete-do-texto.ts";

let n = 0;
function caso(nome: string, fn: () => void) {
  fn();
  n++;
  console.log(`ok - ${nome}`);
}

const resumo = { subtotalBruto: 109, subtotalProdutos: 98.1, desconto: 0, frete: 19.41, pesoTotal: 231, valorTotal: 117.51, acrescimoBonus: 0 } as never;
const linhaDoFrete = (frete: unknown) =>
  buildPropostaInformalText({ id_int: 25281, clienteNome: "Cliente", itens: [], frete: frete as never, resumo, formaPagamento: "PIX" })
    .split("\n")
    .find((l) => l.startsWith("Frete via"))?.replace(/\s/g, " ") ?? null;

const padrao = {
  id: "frete_transportadora",
  id_int: 25281,
  transportadora: "Transportadora Parceira",
  servico: "Entrega Padrão",
  valor: 19.41,
  prazo: "4 a 7 dias úteis",
  observacao: "",
  escolhido: true,
  pesoUsado: 0
};
// O card como o box 9 o mostra depois do Salvar (relido de cotacao_frete).
const relido = { ...padrao, id: "901", ...rotuloDoServicoGravado("Entrega Padrão") };

caso("card padrão sem cotação: gravado = box 9 depois do Salvar", () => {
  assert.equal(linhaDoFrete(padrao), "Frete via *Transportadora Parceira (Entrega Padrão): R$ 19,41*");
  assert.equal(linhaDoFrete(relido), "Frete via *Entrega Padrão: R$ 19,41*");
  const gravado = freteDoTextoGravado(padrao, { regravaCotacao: true, servicoGravado: "Entrega Padrão" });
  assert.equal(linhaDoFrete(gravado), linhaDoFrete(relido));
});

caso("Salvar que não regrava a cotação: card como está", () => {
  assert.equal(freteDoTextoGravado(padrao, { regravaCotacao: false, servicoGravado: "Entrega Padrão" }), padrao);
});

caso("card cotado (SEDEX, São Miguel) e sem card: sem mudança", () => {
  const sedex = { ...padrao, id: "frete_sedex_cotado", transportadora: "Correios SEDEX", servico: "SEDEX" };
  assert.equal(freteDoTextoGravado(sedex, { regravaCotacao: true, servicoGravado: "SEDEX" }), sedex);
  const sm = { ...padrao, id: "frete_transp_sm", transportadora: "Transportadora São Miguel", servico: "SÃO MIGUEL" };
  assert.equal(freteDoTextoGravado(sm, { regravaCotacao: true, servicoGravado: "SÃO MIGUEL" }), sm);
  assert.equal(freteDoTextoGravado(undefined, { regravaCotacao: true, servicoGravado: "x" }), undefined);
});

caso("SEDEX e PAC fabricados: o nome já voltava igual", () => {
  for (const [servico, nome] of [["Entrega Expressa", "Correios SEDEX"], ["Entrega Econômica", "Correios PAC"]]) {
    const card = { ...padrao, id: nome.endsWith("SEDEX") ? "frete_sedex" : "frete_pac", transportadora: nome, servico };
    assert.equal(linhaDoFrete(freteDoTextoGravado(card, { regravaCotacao: true, servicoGravado: servico })), linhaDoFrete(card));
  }
});

console.log(`\n${n} casos ok`);
