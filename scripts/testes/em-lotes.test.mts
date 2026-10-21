/**
 * emLotes (21/10/2026): a consulta de enderecos da Expedicao nao pode passar de ~16 KB de url.
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/em-lotes.test.mts
 */
import { emLotes } from "../../src/features/expedicao/lib/em-lotes.ts";

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

const ids = Array.from({ length: 641 }, (_, i) => `e4dd0d49-c6cf-4887-abcd-${String(i).padStart(12, "0")}`);
const lotes = emLotes(ids, 100);
confere("641 ids viram 7 lotes (6 de 100 e 1 de 41)", lotes.length === 7 && lotes.slice(0, 6).every((l) => l.length === 100) && lotes[6].length === 41, lotes.map((l) => l.length));
confere("nenhum id se perde nem se repete", lotes.flat().length === 641 && new Set(lotes.flat()).size === 641 && lotes.flat().every((id, i) => id === ids[i]));
const urlMaior = Math.max(...lotes.map((l) => `/rest/v1/enderecos?select=id%2Cendereco%2Cnumero%2Ccomplemento%2Cbairro%2Ccidade%2Cuf%2Ccep&id=in.(${l.join(",")})`.length));
confere("a maior url de um lote fica abaixo de 5 KB (limite do gateway: ~16 KB)", urlMaior < 5000, urlMaior);
confere("lista vazia: nenhum lote", emLotes([], 100).length === 0);
confere("lista menor que o lote: um lote so", emLotes([1, 2, 3], 100).length === 1);
confere("exatamente 100: um lote so", emLotes(ids.slice(0, 100), 100).length === 1);
confere("tamanho invalido recusa", (() => { try { emLotes([1], 0); return false; } catch { return true; } })());

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
