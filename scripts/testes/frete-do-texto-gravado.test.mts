/**
 * Texto do box 9 x texto gravado no Salvar (14/11/2026, casos 25281 e 25282).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/frete-do-texto-gravado.test.mts
 *
 * Quando o Salvar regrava `cotacao_frete`, o frete do texto é a linha gravada
 * relida por `mapCotacaoRowToPropostaFrete`, o mesmo card que o box 9 mostra
 * depois de recarregar. Vale para todo frete. Sem regravar, o card fica como está.
 */
import assert from "node:assert/strict";
import { buildPropostaInformalText } from "../../src/features/orcamentos/orcamento-utils.ts";
import { freteDoTextoGravado, mapCotacaoRowToPropostaFrete } from "../../src/features/orcamentos/lib/frete-do-texto.ts";

let n = 0;
function caso(nome: string, fn: () => void) {
  fn();
  n++;
  console.log(`ok - ${nome}`);
}

const resumo = { subtotalBruto: 109, subtotalProdutos: 98.1, desconto: 0, frete: 0, pesoTotal: 231, valorTotal: 98.1, acrescimoBonus: 0 } as never;
const linhaDoFrete = (frete: unknown, modalidade: "CIF" | "FOB" | "RETIRA" | null = "CIF") =>
  buildPropostaInformalText({ id_int: 25282, clienteNome: "Cliente", itens: [], frete: frete as never, resumo, formaPagamento: "PIX", modalidade })
    .split("\n")
    .find((l) => l.startsWith("Frete")) ?.replace(/\s/g, " ") ?? null;

const base = { id_int: 25282, prazo: "Sob consulta", observacao: "", escolhido: true, pesoUsado: 231 };
// Os cards como as cotações os criam na tela (antes do Salvar).
const cards = [
  { ...base, id: "frete_transp_sm", transportadora: "Transportadora São Miguel", servico: "SÃO MIGUEL", valor: 58 },
  { ...base, id: "frete_transp_mb", transportadora: "Motoboy", servico: "MOTOBOY", valor: 25 },
  { ...base, id: "azul_standard_0", transportadora: "Azul Cargo", servico: "STANDARD", valor: 71.5 },
  { ...base, id: "frete_veppo", transportadora: "VEPPO", servico: "VEPPO", valor: 39.17 },
  { ...base, id: "frete_sedex_1", transportadora: "Correios SEDEX", servico: "SEDEX", valor: 19.41 },
  { ...base, id: "frete_transportadora", transportadora: "Transportadora Parceira", servico: "Entrega Padrão", valor: 0, pesoUsado: 0 }
];

/** O que o Salvar grava na cotação para o card (mesma forma de `linhaDaCotacao`). */
const linhaGravada = (c: (typeof cards)[number], valor = c.valor) => ({ servico: c.servico, valor, prazo: c.prazo, peso: c.pesoUsado || 231, origem: "COTACAO" });

caso("todo frete: texto gravado = box 9 depois de recarregar", () => {
  for (const c of cards) {
    const linha = linhaGravada(c);
    const gravado = freteDoTextoGravado(c, { regravaCotacao: true, linha });
    // O box 9 depois do Salvar: o card relido da linha gravada (id novo do banco).
    const relido = mapCotacaoRowToPropostaFrete({ ...linha, id: 901, id_int: 25282, escolhido: true });
    assert.equal(linhaDoFrete(gravado), linhaDoFrete(relido), c.transportadora);
  }
});

caso("os nomes que voltam do banco (por isso o texto antigo recusava)", () => {
  const esperado: Record<string, string> = {
    "Transportadora São Miguel": "Frete via *SÃO MIGUEL: R$ 58,00*",
    Motoboy: "Frete via *MOTOBOY: R$ 25,00*",
    "Azul Cargo": "Frete via *STANDARD: R$ 71,50*",
    VEPPO: "Frete via *VEPPO: R$ 39,17*",
    "Correios SEDEX": "Frete via *Correios SEDEX: R$ 19,41*",
    "Transportadora Parceira": "Frete via *Entrega Padrão: R$ 0,00*"
  };
  for (const c of cards) {
    assert.equal(linhaDoFrete(freteDoTextoGravado(c, { regravaCotacao: true, linha: linhaGravada(c) })), esperado[c.transportadora], c.transportadora);
  }
  // Antes da correção, São Miguel e Motoboy iam com o nome da tela.
  assert.equal(linhaDoFrete(cards[0]), "Frete via *Transportadora São Miguel: R$ 58,00*");
  assert.equal(linhaDoFrete(cards[1]), "Frete via *Motoboy: R$ 25,00*");
});

caso("valor do texto = valor gravado na cotação", () => {
  const c = cards[1];
  const gravado = freteDoTextoGravado(c, { regravaCotacao: true, linha: linhaGravada(c, 30) });
  assert.equal(linhaDoFrete(gravado), "Frete via *MOTOBOY: R$ 30,00*");
});

caso("Salvar que não regrava a cotação (liberado, complemento) e sem card: como está", () => {
  assert.equal(freteDoTextoGravado(cards[0], { regravaCotacao: false, linha: linhaGravada(cards[0]) }), cards[0]);
  assert.equal(freteDoTextoGravado(undefined, { regravaCotacao: true, linha: { servico: "x" } }), undefined);
});

caso("FOB e retirada: a linha não usa o nome do card", () => {
  const g = freteDoTextoGravado(cards[0], { regravaCotacao: true, linha: { servico: "RETIRADA", valor: 0 } });
  assert.equal(linhaDoFrete(g, "RETIRA"), "Frete via *Retirada Local: Grátis*");
  assert.equal(linhaDoFrete(cards[0], "FOB"), "Frete *por conta do cliente (FOB)*");
});

console.log(`\n${n} casos ok`);
