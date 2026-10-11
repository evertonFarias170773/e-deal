/**
 * Testes da lateral da edicao da proposta: quais boxes aparecem em cada aba.
 *
 *   node --experimental-strip-types scripts/testes/boxes-da-lateral.test.mts
 *
 * Confere (1) o mapa contra a regra do dono, (2) que toda aba do editor tem
 * entrada, e (3) a estrutura da pagina: o box 5 e desenhado por UMA funcao, usada
 * so na aba Geral e na lateral, e a lateral decide pelo mapa — sem `activeFormTab
 * ===` dentro dela.
 */
import { readFileSync } from "node:fs";
import {
  BOXES_DA_LATERAL_POR_ABA,
  box10Expandido,
  boxEstaNaLateral,
  boxesDaLateral
} from "../../src/features/orcamentos/lib/boxes-da-lateral.ts";

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

// ── 1. O mapa e a regra do dono ──
const REGRA: Record<string, number[]> = {
  geral: [8, 9, 10],
  produtos: [8, 9, 10], // aba "Orcamento"
  fretes: [5, 10],
  pedido: [9, 10],
  artes: [10],
  producao: [10], // "Producao / Expedicao"
  pagamentos: [8, 10],
  historico: [9, 10]
};
for (const [aba, boxes] of Object.entries(REGRA)) {
  checar(`aba ${aba}: boxes ${boxes.join(", ")}`, [...boxesDaLateral(aba as never)], boxes);
}
checar("so Fretes tem o box 5 na lateral", Object.entries(BOXES_DA_LATERAL_POR_ABA).filter(([, b]) => b.includes(5)).map(([a]) => a), ["fretes"]);
checar("Fretes: tira 8 e 9, mantem o 10", [boxEstaNaLateral("fretes", 8), boxEstaNaLateral("fretes", 9), boxEstaNaLateral("fretes", 10)], [false, false, true]);
checar("box 10 expandido so em Artes e Producao", ["artes", "producao", "geral", "produtos", "fretes", "pedido", "pagamentos", "historico"].map((a) => box10Expandido(a as never)), [true, true, false, false, false, false, false, false]);
checar("Geral e Orcamento nao mudaram (8, 9, 10)", [boxesDaLateral("geral"), boxesDaLateral("produtos")].map((b) => [...b]), [[8, 9, 10], [8, 9, 10]]);
checar("aba legada boletim fica como era", [...boxesDaLateral("boletim")], [8, 9, 10]);
checar("todos os boxes do mapa sao 5, 8, 9 ou 10", [...new Set(Object.values(BOXES_DA_LATERAL_POR_ABA).flat())].sort((a, b) => a - b), [5, 8, 9, 10]);

// ── 2. Toda aba do editor tem entrada no mapa ──
const pagina = readFileSync("src/features/orcamentos/OrcamentoFormPage.tsx", "utf8").replace(/\r\n/g, "\n");
const abasDaPagina = [...(/const ABAS_EDITOR = \[([\s\S]*?)\] as const;/.exec(pagina)?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
checar("a pagina lista abas", abasDaPagina.length > 0, true);
checar("toda aba de ABAS_EDITOR tem entrada no mapa", abasDaPagina.filter((a) => !(a in BOXES_DA_LATERAL_POR_ABA)), []);
checar("o mapa nao tem aba que a pagina nao conhece", Object.keys(BOXES_DA_LATERAL_POR_ABA).filter((a) => !abasDaPagina.includes(a)), []);

// ── 3. Estrutura da pagina ──
const contar = (trecho: string) => pagina.split(trecho).length - 1;
checar('o titulo "5. Endereço de entrega" existe uma vez so (sem copia)', contar('title="5. Endereço de entrega"'), 1);
checar('"Salvar endereço" existe uma vez so', contar("Salvar endereço"), 1);
checar("a funcao do box 5 e definida uma vez", contar("const renderBoxEnderecoEntrega = () =>"), 1);
checar("a funcao do box 5 e chamada em dois lugares (Geral e lateral de Fretes)", contar("renderBoxEnderecoEntrega()"), 2);

const lateralIni = pagina.indexOf("{boxEstaNaLateral(activeFormTab, 5) && renderBoxEnderecoEntrega()}");
const lateralFim = pagina.indexOf("</section>", lateralIni);
const lateral = pagina.slice(lateralIni, lateralFim);
checar("a lateral decide cada box pelo mapa (5, 8, 9, 10)", [5, 8, 9, 10].map((n) => lateral.includes(`boxEstaNaLateral(activeFormTab, ${n})`)), [true, true, true, true]);
checar("a lateral nao tem condicional por aba espalhada", lateral.includes("activeFormTab ==="), false);
checar("a lateral guarda os titulos 8, 9 e 10 de sempre", ['title="8. Resumo do orçamento"', 'title="9. Envio do orçamento"', 'title="10. Observações e Condições"'].map((t) => lateral.includes(t)), [true, true, true]);

// o box 5 da aba Geral continua onde estava: dentro do bloco `activeFormTab === "geral"`, entre o box 4 e a aba Produtos
const iGeral = pagina.indexOf('{activeFormTab === "geral" && (\n                <div className="space-y-6">');
const iChamadaGeral = pagina.indexOf("{renderBoxEnderecoEntrega()}", iGeral);
const iProdutos = pagina.indexOf('{activeFormTab === "produtos" && (', iGeral);
checar("na aba Geral a chamada do box 5 fica dentro do bloco Geral, antes da aba Produtos", iGeral > 0 && iChamadaGeral > iGeral && iChamadaGeral < iProdutos, true);
checar("o box 5 vem depois do 4 (Dados para nota fiscal) na aba Geral", pagina.indexOf('title="4. Dados para nota fiscal"') < iChamadaGeral, true);

// a rota de salvar/trocar/auditar endereco nao foi tocada: as chamadas continuam so dentro da funcao do box
const iFuncIni = pagina.indexOf("const renderBoxEnderecoEntrega = () =>");
const iFuncFim = pagina.indexOf("return (\n    <div className=\"space-y-6\">\n      <PageHeader", iFuncIni);
const funcao = pagina.slice(iFuncIni, iFuncFim);
checar("a funcao do box 5 usa o mesmo estado e handlers da pagina (selecao, edicao, modal)", ["handleSelectEndereco", "setAddressModalMode", "setEditingAddressId", "setAddressDraft", "setIsAddressModalOpen"].map((n) => funcao.includes(n)), [true, true, true, true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
