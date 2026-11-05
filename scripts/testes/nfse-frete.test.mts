/**
 * NFS-e: frete na nota integral (04/11/2026, decisão do dono; modelo pedido 23991).
 *
 *   node --experimental-strip-types scripts/testes/nfse-frete.test.mts
 *
 * O QUE PROVA
 *   1. Com todos os itens marcados, a descrição traz "Frete - R$ x,xx" depois dos itens
 *      e termina nele (desde 05/11/2026 sem natureza e sem frase do pagamento).
 *   2. O valor sugerido é itens marcados (com o desconto proporcional) + frete sem desconto.
 *   3. Nota parcial (item desmarcado): sem frete na descrição e no valor.
 *   4. Pedido sem frete: nenhuma linha.
 *   5. A janela liga tudo isso e mostra o aviso da NF-e de venda com frete; o servidor o calcula.
 */
import { readFileSync } from "node:fs";
import {
  descricaoDaNfse,
  ehNotaParcial,
  freteQueEntraNaNota,
  linhaDoFrete,
  valorSugeridoComFrete,
  type ItemDoPedido
} from "../../src/features/nfse/lib/composicao-nfse.ts";
import { descricaoDosItens } from "../../src/features/nfse/lib/regras-emissao.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${ok ? "" : `\n      obtido:   ${JSON.stringify(obtido)}\n      esperado: ${JSON.stringify(esperado)}`}`);
}

// 23991: 1 item de R$ 353,00, frete R$ 25,00 (dados de 04/11/2026)
const itens23991: ItemDoPedido[] = [{ id: 1, nome: "Ingresso MOBI", quantidade: 400, valorUnitario: 0.23, subtotal: 353 }];
const todos = new Set([1]);

checar("linha do frete no formato dos itens", linhaDoFrete(25), "Frete - R$ 25,00");
checar("sem frete: sem linha", linhaDoFrete(0), "");
checar("23991 integral: frete entra", freteQueEntraNaNota(itens23991, todos, 25), 25);
checar("23991 integral: valor 353 + 25 = 378", valorSugeridoComFrete(itens23991, todos, 353, 25), 378);
const desc = descricaoDaNfse(descricaoDosItens(23991, itens23991), freteQueEntraNaNota(itens23991, todos, 25)).split("\n");
checar("23991: itens e frete, terminando no frete", desc, [
  "Pedido 23991",
  "400 x Ingresso MOBI - R$ 0,23 un.",
  "Frete - R$ 25,00"
]);

// Nota parcial: pedido com 2 itens, um desmarcado
const dois: ItemDoPedido[] = [
  { id: 1, nome: "Ingresso MOBI", quantidade: 1000, valorUnitario: 0.2, subtotal: 200 },
  { id: 2, nome: "Pulseira", quantidade: 1000, valorUnitario: 0.1, subtotal: 100 }
];
const so1 = new Set([1]);
checar("parcial: é nota parcial", ehNotaParcial(dois, so1), true);
checar("parcial: frete não entra", freteQueEntraNaNota(dois, so1, 30), 0);
checar("parcial: valor só do item marcado", valorSugeridoComFrete(dois, so1, 300, 30), 200);
checar("parcial: descrição sem a linha do frete", descricaoDaNfse(descricaoDosItens(1, dois.filter((i) => so1.has(i.id))), freteQueEntraNaNota(dois, so1, 30)).includes("Frete"), false);
checar("remarcando tudo: frete volta", valorSugeridoComFrete(dois, new Set([1, 2]), 300, 30), 330);

// Desconto proporcional nos itens, frete sem desconto: itens 300 com 10% -> 270, + frete 30
checar("desconto só nos itens, frete inteiro", valorSugeridoComFrete(dois, new Set([1, 2]), 270, 30), 300);

// Pedido sem frete (retirada)
checar("sem frete: nada na descrição", descricaoDaNfse(descricaoDosItens(1, dois), freteQueEntraNaNota(dois, new Set([1, 2]), 0)).includes("Frete"), false);
checar("sem frete: valor só dos itens", valorSugeridoComFrete(dois, new Set([1, 2]), 300, 0), 300);
checar("frete nulo não quebra", freteQueEntraNaNota(dois, new Set([1, 2]), null), 0);

// Janela e servidor
const modal = readFileSync("src/features/nfse/components/GerarNfseModal.tsx", "utf8");
const servidor = readFileSync("src/features/nfse/services/nfse-pedido.server.ts", "utf8");
checar("janela: as três montagens da descrição passam o frete", (modal.match(/freteQueEntraNaNota\((lido|contexto)\.itens, (todos|novo), (lido|contexto)\.freteDoPedido\)|\), freteNaNota\)\);/g) ?? []).length, 3);
checar("janela: valor sugerido com frete ao abrir e ao marcar", (modal.match(/valorSugeridoComFrete\(/g) ?? []).length, 2);
checar("janela: texto da nota parcial", /nota parcial/.test(modal) && !/não entra na nota de serviço/.test(modal), true);
checar("janela: aviso amarelo da NF-e com frete, só quando o frete entra", /freteNaNota > 0 && contexto\.nfeDeVendaComFrete/.test(modal) && /já inclui o frete; confira para não cobrá-lo duas vezes/.test(modal), true);
checar("servidor: NF-e viva (não cancelada/denegada, não remessa) com frete > 0", /\["CANCELADA", "DENEGADA"\]/.test(servidor) && /"REMESSA"/.test(servidor) && /Number\(n\.valor_frete\) > 0/.test(servidor), true);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
