/**
 * Lista de Pedidos: o selo do status do pedido sai sem o complemento de arte, e
 * "Aguardando" some quando o pedido esta pago a conferir.
 *   src/features/orcamentos/lib/selo-aguardando-da-lista.ts
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/selo-aguardando-da-lista.test.mts
 */
import { mostraSeloDoStatusNaLista, statusDoPedidoSemArte } from "../../src/features/orcamentos/lib/selo-aguardando-da-lista.ts";
import { getStatusLabel } from "../../src/features/orcamentos/mappers.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  if (!passou) falhas += 1;
  console.log(`${passou ? "ok  " : "FALHOU"} ${nome}${passou ? "" : `  esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)}`}`);
}

// ── o rotulo sem o complemento de arte ──────────────────────────────────────
ok("Aguardando / EM ARTE -> Aguardando", statusDoPedidoSemArte("Aguardando / EM ARTE"), "Aguardando");
ok("Aguardando / Arte aprovada -> Aguardando", statusDoPedidoSemArte("Aguardando / Arte aprovada"), "Aguardando");
ok("Novo / EM ARTE -> Novo", statusDoPedidoSemArte("Novo / EM ARTE"), "Novo");
ok("Novo / Arte aprovada -> Novo", statusDoPedidoSemArte("Novo / Arte aprovada"), "Novo");
ok("Liberado / EM ARTE -> Liberado", statusDoPedidoSemArte("Liberado / EM ARTE"), "Liberado");
for (const rotulo of ["Novo", "Aguardando", "Liberado", "Cancelado", "REVISAO ATENDENTE", "REVISAO PRODUCAO", "EM PRODUCAO", "EM IMPRESSAO / PENDENTE", "EM ACABAMENTO / PENDENTE", "EXPEDICAO", "A RETIRAR", "EM TRANSITO", "ENTREGUE", "Sem status"]) {
  ok(`${rotulo}: sem complemento de arte, fica igual`, statusDoPedidoSemArte(rotulo), rotulo);
}
ok("o complemento '/ PENDENTE' NAO e de arte e fica", statusDoPedidoSemArte("EM IMPRESSAO / PENDENTE"), "EM IMPRESSAO / PENDENTE");
ok("nulo ou vazio -> vazio", [statusDoPedidoSemArte(null), statusDoPedidoSemArte("")], ["", ""]);

// Com os rotulos de VERDADE, saidos de getStatusLabel (que nao foi alterada).
const GRAVADOS: Array<[string, string]> = [
  ["NOVO", "Novo"],
  ["NOVO / EM ARTE", "Novo"],
  ["NOVO_ARTE_APROVADA", "Novo"],
  ["AGUARDANDO", "Aguardando"],
  ["AGUARDANDO / EM ARTE", "Aguardando"],
  ["AGUARDANDO_ARTE_APROVADA", "Aguardando"],
  ["AGUARDANDO / PENDENTE", "Aguardando"],
  ["APROVADO", "Liberado"],
  ["LIBERADO", "Liberado"],
  ["LIBERADO / EM ARTE", "Liberado"],
  ["CANCELADO", "Cancelado"]
];
for (const [gravado, esperado] of GRAVADOS) {
  ok(`status gravado ${gravado}: o selo mostra "${esperado}"`, statusDoPedidoSemArte(getStatusLabel(gravado)), esperado);
}
ok("getStatusLabel continua devolvendo o complemento (nao foi alterada)", [getStatusLabel("AGUARDANDO / EM ARTE"), getStatusLabel("AGUARDANDO_ARTE_APROVADA")], ["Aguardando / EM ARTE", "Aguardando / Arte aprovada"]);

// ── "Aguardando" some com pagamento a conferir, agora sem excecao ───────────
ok("Aguardando + pago a conferir: some", mostraSeloDoStatusNaLista("Aguardando", true), false);
ok("Aguardando / Arte aprovada + pago a conferir: some (era excecao; deixou de ser)", mostraSeloDoStatusNaLista("Aguardando / Arte aprovada", true), false);
ok("Aguardando / EM ARTE + pago a conferir: some (era excecao; deixou de ser)", mostraSeloDoStatusNaLista("Aguardando / EM ARTE", true), false);
ok("Aguardando sem pagamento a conferir: aparece", mostraSeloDoStatusNaLista("Aguardando", false), true);
ok("Aguardando / EM ARTE sem pagamento a conferir: aparece (como Aguardando)", mostraSeloDoStatusNaLista("Aguardando / EM ARTE", false), true);
for (const rotulo of ["Novo", "Novo / EM ARTE", "Novo / Arte aprovada", "Liberado", "Liberado / EM ARTE", "Cancelado", "REVISAO ATENDENTE", "EM PRODUCAO", "ENTREGUE", "Sem status"]) {
  ok(`${rotulo} + pago a conferir: continua aparecendo`, mostraSeloDoStatusNaLista(rotulo, true), true);
}
ok("rotulo vazio ou nulo: nunca esconde", [mostraSeloDoStatusNaLista("", true), mostraSeloDoStatusNaLista(null, true)], [true, true]);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
