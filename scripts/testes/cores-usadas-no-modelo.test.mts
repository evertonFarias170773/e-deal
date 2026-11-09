/**
 * Cor papel que não se repete: só em produto de prateleira (09/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/cores-usadas-no-modelo.test.mts
 *
 * SEM banco: só a regra de lib/cores-usadas-no-modelo, a mesma que a lista
 * rápida (LotesGrid) e o card de cada modelo (PedidoModelosTab) usam. O filtro
 * da lista (ModeloCampos) esconde o que esta função devolve, menos a cor do
 * próprio lote.
 */
import assert from "node:assert/strict";
import { coresUsadasNosOutrosLotes } from "@/features/orcamentos/lib/cores-usadas-no-modelo";

let n = 0;
const caso = (nome: string, fn: () => void) => { fn(); n++; console.log(`ok  ${nome}`); };

/** O mesmo filtro de ModeloCampos: cores do formato menos as usadas, a do lote fica. */
const lista = (cores: string[], usadas: ReadonlySet<string>, corDoLote: string | null) =>
  cores.filter((c) => !usadas.has(c) || c === corDoLote);
const CORES = ["Branca", "Amarela", "Azul"];

caso("prateleira: a cor usada some da lista dos outros lotes", () => {
  const outros = [{ padrao: "Branca" }, { padrao: " Azul " }, { padrao: "" }];
  const usadas = coresUsadasNosOutrosLotes(true, outros);
  assert.deepEqual([...usadas].sort(), ["Azul", "Branca"]);
  assert.deepEqual(lista(CORES, usadas, null), ["Amarela"]);
});
caso("prateleira: a cor do próprio lote continua na lista dele", () => {
  const usadas = coresUsadasNosOutrosLotes(true, [{ padrao: "Branca" }]);
  assert.deepEqual(lista(CORES, usadas, "Branca"), CORES); // pedido gravado com cor repetida
});
caso("produto com arte: todas as cores, mesmo Modelo e mesma cor em dois lotes", () => {
  const usadas = coresUsadasNosOutrosLotes(false, [{ padrao: "Branca" }, { padrao: "Azul" }]);
  assert.equal(usadas.size, 0);
  assert.deepEqual(lista(CORES, usadas, null), CORES);
});

console.log(`\n${n} casos ok`);
