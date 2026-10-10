/**
 * Lista de Pedidos: "Aguardando" some quando o pedido esta pago a conferir.
 *   src/features/orcamentos/lib/selo-aguardando-da-lista.ts
 *
 *   node --experimental-strip-types scripts/testes/selo-aguardando-da-lista.test.mts
 */
import { mostraSeloDoStatusNaLista } from "../../src/features/orcamentos/lib/selo-aguardando-da-lista.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  if (!passou) falhas += 1;
  console.log(`${passou ? "ok  " : "FALHOU"} ${nome}${passou ? "" : `  esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)}`}`);
}

ok("Aguardando + pago a conferir: o selo do status NAO aparece (fica so Pago / A liberar)", mostraSeloDoStatusNaLista("Aguardando", true), false);
ok("Aguardando sem pagamento a conferir: o selo continua", mostraSeloDoStatusNaLista("Aguardando", false), true);
ok("Aguardando / Arte aprovada + pago a conferir: continua (diz onde esta a arte)", mostraSeloDoStatusNaLista("Aguardando / Arte aprovada", true), true);
ok("Aguardando / EM ARTE + pago a conferir: continua", mostraSeloDoStatusNaLista("Aguardando / EM ARTE", true), true);
for (const rotulo of ["Novo", "Liberado", "Cancelado", "REVISAO ATENDENTE", "EM PRODUCAO", "ENTREGUE", "Sem status"]) {
  ok(`${rotulo} + pago a conferir: continua`, mostraSeloDoStatusNaLista(rotulo, true), true);
  ok(`${rotulo} sem pagamento a conferir: continua`, mostraSeloDoStatusNaLista(rotulo, false), true);
}
ok("rotulo com espacos nas pontas e tratado igual", mostraSeloDoStatusNaLista(" Aguardando ", true), false);
ok("rotulo vazio ou nulo: nunca esconde", [mostraSeloDoStatusNaLista("", true), mostraSeloDoStatusNaLista(null, true)], [true, true]);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
