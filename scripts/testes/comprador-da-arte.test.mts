/**
 * Comprador da arte pela conversa do WhatsApp (10/11/2026): trava do "Enviar para arte".
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/comprador-da-arte.test.mts
 *
 * SEM banco: só a regra de lib/conversa-whatsapp e o corte de lib/comprador-da-arte.
 *   A. sem conversa no Guru: travado, com o aviso para o atendimento;
 *   B. uma conversa: já vem escolhida e libera (gravada = false até gravar);
 *   C. várias: precisa escolher; a gravada libera; gravada que saiu do cliente não vale;
 *   D. conversa sem nome ou com número inválido;
 *   E. número para exibir;
 *   F. arte já enviada (EM ARTE, APROVADO...) não é travada; AGUARDANDO/PENDENTE/vazio são primeiro envio.
 */
import assert from "node:assert/strict";
import { arteJaEnviada } from "@/features/orcamentos/lib/comprador-da-arte";
import {
  SEM_CONVERSA_NO_GURU,
  numeroParaExibir,
  situacaoDaConversa
} from "@/features/orcamentos/lib/conversa-whatsapp";

const conversa = (id: string, extra: Partial<{ nome: string; numero: string }> = {}) => ({
  chat_id: id,
  nome: `Cliente - 25847 (${id})`,
  numero: "5551991010423",
  ...extra
});

let n = 0;
const caso = (nome: string, fn: () => void) => { fn(); n++; console.log(`ok  ${nome}`); };

caso("A. sem conversa no Guru fica travado", () => {
  const s = situacaoDaConversa([], null);
  assert.equal(s.liberado, false);
  assert.equal(s.semConversa, true);
  assert.equal(s.aviso, SEM_CONVERSA_NO_GURU);
  assert.equal(
    SEM_CONVERSA_NO_GURU,
    "Cliente sem conversa no ChatGuru: peça ao atendimento para abrir a conversa com o código do cliente no nome"
  );
});

caso("B. uma conversa já vem escolhida", () => {
  const s = situacaoDaConversa([conversa("a")], null);
  assert.equal(s.liberado, true);
  assert.equal(s.escolhida?.chat_id, "a");
  assert.equal(s.gravada, false);
  assert.equal(situacaoDaConversa([conversa("a")], "a").gravada, true);
});

caso("C. várias conversas exigem escolha", () => {
  const lista = [conversa("a"), conversa("b", { numero: "5551984608848" })];
  const s = situacaoDaConversa(lista, null);
  assert.equal(s.liberado, false);
  assert.equal(s.precisaEscolher, true);
  assert.match(s.aviso ?? "", /2 conversas/);
  const g = situacaoDaConversa(lista, "b");
  assert.equal(g.liberado, true);
  assert.equal(g.escolhida?.chat_id, "b");
  // A gravada saiu do cliente (renomeada no Guru): volta a pedir escolha.
  assert.equal(situacaoDaConversa(lista, "zzz").precisaEscolher, true);
});

caso("D. sem nome ou número inválido", () => {
  assert.equal(situacaoDaConversa([conversa("a", { nome: "—" })], null).liberado, false);
  assert.equal(situacaoDaConversa([conversa("a", { numero: "123" })], null).semConversa, true);
});

caso("E. número para exibir", () => {
  assert.equal(numeroParaExibir("5551991010423"), "(51) 99101-0423");
  assert.equal(numeroParaExibir("555184608848"), "(51) 8460-8848");
});

caso("F. arte já enviada não trava", () => {
  for (const s of ["EM ARTE", "Em Aprovação", "APROVADO"]) assert.equal(arteJaEnviada(s), true, s);
  for (const s of [null, "", "AGUARDANDO", "pendente"]) assert.equal(arteJaEnviada(s), false, String(s));
});

console.log(`\n${n} casos ok`);
