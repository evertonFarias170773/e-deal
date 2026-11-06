/**
 * Comprador da arte (06/11/2026): trava do "Enviar para arte".
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/comprador-da-arte.test.mts
 *
 * SEM banco: só a regra de lib/comprador-da-arte.
 *   A. cliente sem Comprador: travado; adicionando um completo, libera;
 *   B. dois Compradores: precisa escolher; escolhido gravado libera;
 *   C. Comprador sem e-mail: travado, com o aviso do que falta;
 *   D. inativo, Financeiro e sem cargo não contam como Comprador;
 *   E. escolha gravada que deixou de ser Comprador: volta a pedir escolha;
 *   F. arte já enviada (EM ARTE, APROVADO...) não é travada; AGUARDANDO/PENDENTE/vazio são primeiro envio.
 */
import assert from "node:assert/strict";
import { arteJaEnviada, contatosParaVirarComprador, situacaoDoComprador } from "@/features/orcamentos/lib/comprador-da-arte";

type C = { id: string; nome: string; cargo: string; whatsapp: string; email: string; ativo?: boolean };
const contato = (id: string, extra: Partial<C> = {}): C => ({
  id, nome: `Contato ${id}`, cargo: "Comprador", whatsapp: "51999998888", email: `c${id}@ex.com.br`, ativo: true, ...extra,
});

let n = 0;
const caso = (nome: string, fn: () => void) => { fn(); n++; console.log(`ok  ${nome}`); };

caso("A. sem Comprador fica travado", () => {
  const s = situacaoDoComprador([contato("1", { cargo: "Financeiro" })], null);
  assert.equal(s.liberado, false);
  assert.equal(s.compradores.length, 0);
  assert.match(s.aviso!, /não tem contato Comprador/);
});
caso("A. adicionando um Comprador completo, libera e vem escolhido", () => {
  const s = situacaoDoComprador([contato("1", { cargo: "Financeiro" }), contato("2")], null);
  assert.equal(s.liberado, true);
  assert.equal(s.escolhido?.id, "2");
});
caso("B. dois Compradores: precisa escolher", () => {
  const s = situacaoDoComprador([contato("1"), contato("2")], null);
  assert.equal(s.liberado, false);
  assert.equal(s.precisaEscolher, true);
  assert.match(s.aviso!, /2 Compradores/);
});
caso("B. dois Compradores com escolha gravada: libera o escolhido", () => {
  const s = situacaoDoComprador([contato("1"), contato("2")], "2");
  assert.equal(s.liberado, true);
  assert.equal(s.escolhido?.id, "2");
});
caso("C. Comprador sem e-mail fica travado", () => {
  const s = situacaoDoComprador([contato("1", { email: "" })], null);
  assert.equal(s.liberado, false);
  assert.deepEqual(s.faltas, ["e-mail"]);
  assert.match(s.aviso!, /Falta e-mail no Comprador Contato 1/);
});
caso("C. fone curto e e-mail inválido também travam", () => {
  const s = situacaoDoComprador([contato("1", { whatsapp: "9999-8888", email: "sem-arroba" })], null);
  assert.deepEqual(s.faltas, ["fone", "e-mail"]);
  assert.match(s.aviso!, /Falta fone e e-mail/);
});
caso("D. inativo e sem cargo não contam", () => {
  const s = situacaoDoComprador([contato("1", { ativo: false }), contato("2", { cargo: "" })], null);
  assert.equal(s.compradores.length, 0);
});
caso("E. escolha gravada que deixou de ser Comprador volta a pedir escolha", () => {
  const s = situacaoDoComprador([contato("1", { ativo: false }), contato("2"), contato("3")], "1");
  assert.equal(s.precisaEscolher, true);
  const unico = situacaoDoComprador([contato("1", { ativo: false }), contato("2")], "1");
  assert.equal(unico.escolhido?.id, "2");
});
caso("F. arte já enviada não trava; rascunho trava", () => {
  for (const st of ["EM ARTE", "Em Aprovação", "APROVADO", "Enviar Arte", "Dados Pendentes"]) assert.equal(arteJaEnviada(st), true, st);
  for (const st of [null, undefined, "", " ", "AGUARDANDO", "Pendente"]) assert.equal(arteJaEnviada(st), false, String(st));
});

caso("G. Edison Jr sem cargo: aparece em Usar contato existente e, virando Comprador, libera sem contato novo", () => {
  const antes = [contato("64813", { nome: "Edison Jr", cargo: "" }), contato("330", { cargo: "Financeiro" }), contato("9", { cargo: "", ativo: false })];
  assert.equal(situacaoDoComprador(antes, null).liberado, false);
  const candidatos = contatosParaVirarComprador(antes);
  assert.deepEqual(candidatos.map((c) => c.id), ["64813", "330"]); // inativo fora
  const depois = antes.map((c) => (c.id === "64813" ? { ...c, cargo: "Comprador" } : c));
  const s = situacaoDoComprador(depois, "64813");
  assert.equal(s.liberado, true);
  assert.equal(s.escolhido?.id, "64813");
  assert.equal(depois.length, antes.length);
  assert.equal(contatosParaVirarComprador(depois).some((c) => c.id === "64813"), false);
});
caso("G. contato existente sem e-mail vira Comprador e segue travado (abre o Completar)", () => {
  const s = situacaoDoComprador([contato("1", { cargo: "Comprador", email: "" })], "1");
  assert.equal(s.liberado, false);
  assert.deepEqual(s.faltas, ["e-mail"]);
});

console.log(`\n${n} casos ok`);
