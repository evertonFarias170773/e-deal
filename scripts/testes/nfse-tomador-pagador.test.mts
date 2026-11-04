/**
 * NFS-e: o tomador é o pagador do pedido, pela mesma regra do destinatário da NF-e
 * (04/11/2026, pedido 23991: Companhia Zaffari no cadastro, Maxion como pagador).
 *
 *   node --experimental-strip-types scripts/testes/nfse-tomador-pagador.test.mts
 *
 * O QUE PROVA
 *   1. A regra: id_faturado distinto do cliente vence; sem pagador (nulo, zero ou
 *      igual ao cliente), fica o cliente.
 *   2. A NF-e e a NFS-e usam a MESMA função, e a NF-e não tem mais a regra copiada.
 *   3. A NFS-e lê cadastro e endereços do tomador (não de proposta.id_cliente).
 */
import { readFileSync } from "node:fs";
import { idDoPagadorDoPedido } from "../../src/lib/fiscal/pagador-do-pedido.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${ok ? "" : `\n      obtido:   ${JSON.stringify(obtido)}\n      esperado: ${JSON.stringify(esperado)}`}`);
}

// 1. A regra
checar("23991: Maxion (70107) e o tomador, nao a Zaffari (17610)", idDoPagadorDoPedido({ id_cliente: 17610, id_faturado: 70107 }), 70107);
checar("sem pagador: o cliente", idDoPagadorDoPedido({ id_cliente: 17610, id_faturado: null }), 17610);
checar("pagador igual ao cliente: o cliente", idDoPagadorDoPedido({ id_cliente: 17610, id_faturado: 17610 }), 17610);
checar("pagador zero: o cliente", idDoPagadorDoPedido({ id_cliente: 17610, id_faturado: 0 }), 17610);
checar("id em texto igual ao numero: o cliente", idDoPagadorDoPedido({ id_cliente: 17610, id_faturado: "17610" }), 17610);
checar("sem cliente e sem pagador: nulo", idDoPagadorDoPedido({ id_cliente: null, id_faturado: null }), null);
checar("sem cliente, com pagador: o pagador", idDoPagadorDoPedido({ id_cliente: null, id_faturado: 70107 }), 70107);

// 2. Mesma funcao nos dois lados
const nfe = readFileSync("src/features/nfe/services/nfe.service.ts", "utf8");
const nfse = readFileSync("src/features/nfse/services/nfse-pedido.server.ts", "utf8");
checar("NF-e usa a regra unica (resolverPagador e destino fiscal)", (nfe.match(/idDoPagadorDoPedido\(linha\)/g) ?? []).length, 2);
checar("NF-e nao tem mais a regra copiada", /id_faturado\s*&&\s*linha\.id_faturado\s*!==/.test(nfe), false);
checar("NFS-e resolve o tomador pela regra unica", /const idCliente = idDoPagadorDoPedido\(proposta\)/.test(nfse), true);
checar("NFS-e le id_faturado da proposta", /select\("id_int, id_cliente, id_faturado,/.test(nfse), true);

// 3. Cadastro e enderecos do tomador
checar("cadastro do tomador pelo id resolvido", /\.from\("clientes"\)[\s\S]{0,200}\.eq\("id_cliente", idCliente\)/.test(nfse), true);
checar("enderecos do tomador pelo id resolvido", /\.from\("enderecos"\)[\s\S]{0,200}\.eq\("id_cliente", idCliente\)/.test(nfse), true);
checar("nome do cliente do pedido nao vira nome do pagador", /\(ehPagadorDoPedido \? "" : texto\(proposta\.cliente\)\)/.test(nfse), true);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
