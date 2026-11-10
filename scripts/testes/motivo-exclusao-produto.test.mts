/**
 * Motivo real da exclusão de produto recusada (10/11/2026, proposta 24985).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/motivo-exclusao-produto.test.mts
 *
 * SEM banco. O erro do caso A é o que o gatilho carimba_status_impressao_em
 * levanta ao apagar em cascata o modelo IMPRESSO do item de prateleira.
 */
import assert from "node:assert/strict";
import { MOTIVO_MODELO_IMPRESSO, motivoDaExclusaoRecusada } from "@/features/orcamentos/lib/motivo-exclusao-produto";

let n = 0;
const caso = (nome: string, fn: () => void) => { fn(); n++; console.log(`ok  ${nome}`); };

caso("A. modelo impresso (24985, #2003): diz o motivo, não 'tente novamente'", () => {
  const m = motivoDaExclusaoRecusada({
    code: "23514",
    message: "Modelo impresso: o registro de impressao e permanente e nao pode ser excluido.",
  });
  assert.equal(m, MOTIVO_MODELO_IMPRESSO);
  assert.doesNotMatch(m, /tente novamente/i);
});
caso("B. outra recusa de gatilho: mostra a mensagem do banco", () => {
  assert.equal(motivoDaExclusaoRecusada({ code: "P0001", message: "Item travado" }), "O banco recusou a exclusão: Item travado");
});
caso("C. sem permissão", () => {
  assert.match(motivoDaExclusaoRecusada({ code: "42501", message: "permission denied" }), /permissão/);
});
caso("D. erro sem detalhe: a mensagem antiga", () => {
  assert.equal(motivoDaExclusaoRecusada(null), "Não foi possível remover o produto. Tente novamente.");
  assert.match(motivoDaExclusaoRecusada({ message: "Failed to fetch" }), /Failed to fetch/);
});

console.log(`\n${n} casos ok`);
