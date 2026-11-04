/**
 * Cards "Em arte" e "Arte Aprovada" da lista de Pedidos (04/11/2026, gerencia).
 *
 *   - "Dados Pendentes" sai do "Em arte" e entra no "Arte Aprovada", com as
 *     mesmas exclusoes do card (status do pedido e is_prd_aprovado).
 *   - "Pendente Informacao" vira o 1º grupo do "Em arte", antes de "Enviar Arte";
 *     os demais grupos mantem a ordem relativa.
 *   - Todo outro status de arte entra e sai dos dois cards como antes (a regra
 *     antiga esta copiada aqui, para comparar).
 *
 * As funcoes sao as unicas usadas pelo servidor (filtro e ordem da lista
 * inteira) e pela tela (pagina e contador); a fiacao e conferida no fonte.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/cards-arte-dados-pendentes.test.mts
 */
import { readFileSync } from "node:fs";
import {
  statusArteEntraNoCardEmArte,
  statusArteEntraNoCardArteAprovada,
  pedidoEntraNoCardArteAprovada,
  grupoStatusArteDoCardEmArte,
  statusArteEhPendenciaDoCardEmArte,
  GRUPO_PENDENTE_INFORMACAO_DO_CARD_EM_ARTE,
  GRUPO_ENVIAR_ARTE_DO_CARD_EM_ARTE,
  GRUPO_DEMAIS_DO_CARD_EM_ARTE,
  STATUS_FORA_DO_CARD_ARTE_APROVADA
} from "../../src/features/orcamentos/services/orcamentos.service.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(ok ? `ok      ${nome}` : `FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
}

const chave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toUpperCase();

// ── A regra ANTIGA (ate 03/11/2026), copiada para a comparacao ──
const ANTIGO_EM_ARTE = ["Em Arte", "Enviar Arte", "Em Aprovacao", "Em Alteracao", "Apr Parcial", "APROVADO PARCIAL", "Dados Pendentes", "Corrigir Dados", "Pendente Informacao"].map(chave);
const ANTIGO_GRUPOS = [["Enviar Arte"], ["Pendente Informacao"], ["Em Alteracao"], ["Dados Pendentes", "Corrigir Dados"], ["Em Aprovacao"], ["Apr Parcial", "APROVADO PARCIAL"], ["EM ARTE"]];
const antigoEmArte = (s: string) => ANTIGO_EM_ARTE.includes(chave(s));
const antigoArteAprovadaStatus = (s: string) => chave(s) === "APROVADO";
const antigoGrupo = (s: string) => {
  const i = ANTIGO_GRUPOS.findIndex((g) => g.map(chave).includes(chave(s)));
  return i < 0 ? 8 : i + 1;
};

// Os valores de `pedidos_artes.status` (grafias reais inclusive) e outros que nao entram.
const STATUS_ARTE = [
  "Em Arte", "EM ARTE", "Enviar Arte", "ENVIAR ARTE", "Em Aprovacao", "Em Aprovação", "Em Alteracao", "Em Alteração",
  "Apr Parcial", "APROVADO PARCIAL", "Dados Pendentes", "Dados Pendentes\r\n", "DADOS PENDENTES", "Corrigir Dados",
  "Pendente Informacao", "Pendente Informação", "APROVADO", "Aprovado", "AGUARDANDO", "", "Outro"
];
const ehDadosPendentes = (s: string) => chave(s) === "DADOS PENDENTES";

console.log("— Prova do antigo: os demais status entram e saem como antes —");
for (const s of STATUS_ARTE.filter((x) => !ehDadosPendentes(x))) {
  checar(`Em arte  ${JSON.stringify(s)}`, statusArteEntraNoCardEmArte(s), antigoEmArte(s));
  checar(`Arte Aprovada  ${JSON.stringify(s)}`, statusArteEntraNoCardArteAprovada(s), antigoArteAprovadaStatus(s));
}
checar("Apr Parcial fora do Arte Aprovada", statusArteEntraNoCardArteAprovada("Apr Parcial"), false);
checar("APROVADO PARCIAL fora do Arte Aprovada", statusArteEntraNoCardArteAprovada("APROVADO PARCIAL"), false);
checar("laranja do card: Pendente Informacao", statusArteEhPendenciaDoCardEmArte("Pendente Informação"), true);
checar("laranja do card: Corrigir Dados", statusArteEhPendenciaDoCardEmArte("Corrigir Dados"), true);
checar("laranja do card: Dados Pendentes nao (como antes)", statusArteEhPendenciaDoCardEmArte("Dados Pendentes"), false);
checar("laranja do card: Enviar Arte nao (como antes)", statusArteEhPendenciaDoCardEmArte("Enviar Arte"), false);

console.log("— Prova do novo: Dados Pendentes troca de card —");
for (const s of STATUS_ARTE.filter(ehDadosPendentes)) {
  checar(`${JSON.stringify(s)} sai do Em arte`, statusArteEntraNoCardEmArte(s), false);
  checar(`${JSON.stringify(s)} entra no Arte Aprovada`, statusArteEntraNoCardArteAprovada(s), true);
}

console.log("— Arte Aprovada: mesmas exclusoes para APROVADO e Dados Pendentes —");
const STATUS_PEDIDO_DENTRO = ["NOVO", "AGUARDANDO", "LIBERADO", "APROVADO", "REVISAO ATENDENTE", "NOVO_ARTE_APROVADA", "AGUARDANDO_ARTE_APROVADA", "", null];
for (const arte of ["APROVADO", "Dados Pendentes"]) {
  for (const st of STATUS_PEDIDO_DENTRO) {
    checar(`${arte} + pedido ${JSON.stringify(st)} entra`, pedidoEntraNoCardArteAprovada(arte, { statusInterno: st, is_prd_aprovado: false }), true);
    checar(`${arte} + pedido ${JSON.stringify(st)} com is_prd_aprovado sai`, pedidoEntraNoCardArteAprovada(arte, { statusInterno: st, is_prd_aprovado: true }), false);
  }
  for (const st of STATUS_FORA_DO_CARD_ARTE_APROVADA) {
    checar(`${arte} + pedido ${st} sai`, pedidoEntraNoCardArteAprovada(arte, { statusInterno: st, is_prd_aprovado: false }), false);
  }
}
// Os demais status de arte continuam fora em qualquer pedido.
for (const s of STATUS_ARTE.filter((x) => !ehDadosPendentes(x) && chave(x) !== "APROVADO")) {
  checar(`${JSON.stringify(s)} + NOVO fora do Arte Aprovada (como antes)`, pedidoEntraNoCardArteAprovada(s, { statusInterno: "NOVO" }), false);
}

console.log("— Ordem do Em arte —");
checar("Pendente Informacao e o grupo 1", grupoStatusArteDoCardEmArte(["Pendente Informação"]), 1);
checar("Enviar Arte e o grupo 2", grupoStatusArteDoCardEmArte(["ENVIAR ARTE"]), 2);
checar("constante do vermelho", GRUPO_PENDENTE_INFORMACAO_DO_CARD_EM_ARTE, 1);
checar("constante do laranja", GRUPO_ENVIAR_ARTE_DO_CARD_EM_ARTE, 2);
checar("demais continua 8", GRUPO_DEMAIS_DO_CARD_EM_ARTE, 8);
// Ordem relativa dos outros grupos igual a antiga.
const OUTROS = ["Em Alteração", "Corrigir Dados", "Em Aprovação", "Apr Parcial", "APROVADO PARCIAL", "EM ARTE", "Outro"];
for (let i = 0; i < OUTROS.length; i++) {
  for (let j = 0; j < OUTROS.length; j++) {
    const novo = Math.sign(grupoStatusArteDoCardEmArte([OUTROS[i]]) - grupoStatusArteDoCardEmArte([OUTROS[j]]));
    const antigo = Math.sign(antigoGrupo(OUTROS[i]) - antigoGrupo(OUTROS[j]));
    if (novo !== antigo) checar(`ordem relativa ${OUTROS[i]} x ${OUTROS[j]}`, novo, antigo);
  }
}
checar("ordem relativa dos outros grupos preservada (pares conferidos)", true, true);
// Pendente Informacao vem antes de todos, inclusive Enviar Arte.
const lista = ["Enviar Arte", "Em Alteração", "Pendente Informação", "EM ARTE", "Corrigir Dados", "Pendente Informacao"]
  .map((s, posicao) => ({ s, posicao, g: grupoStatusArteDoCardEmArte([s]) }))
  .sort((a, b) => a.g - b.g || a.posicao - b.posicao)
  .map((x) => x.s);
checar("lista ordenada: Pendente Informacao no topo", lista, ["Pendente Informação", "Pendente Informacao", "Enviar Arte", "Em Alteração", "Corrigir Dados", "EM ARTE"]);

console.log("— Fiacao: servidor e tela usam as funcoes unicas —");
const servico = readFileSync("src/features/orcamentos/services/orcamentos.service.ts", "utf8");
const tela = readFileSync("src/features/orcamentos/OrcamentosListPageReal.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");
checar("servidor: card Em arte filtra por statusArteEntraNoCardEmArte", /filter\(\(linha\) => statusArteEntraNoCardEmArte\(linha\.status\)\)/.test(servico), true);
checar("servidor: card Arte Aprovada filtra por statusArteEntraNoCardArteAprovada", /filter\(\(linha\) => statusArteEntraNoCardArteAprovada\(linha\.status\)\)/.test(servico), true);
checar("servidor: ordem pela funcao do grupo", /grupo: grupoStatusArteDoCardEmArte\(mapaArte\.get/.test(servico), true);
checar("tela: Arte Aprovada por pedidoEntraNoCardArteAprovada", tela.includes("pedidoEntraNoCardArteAprovada(statusArtePorId[item.id_int], item)"), true);
checar("tela: vermelho pelo grupo nomeado", tela.includes("arte === GRUPO_PENDENTE_INFORMACAO_DO_CARD_EM_ARTE) return DESTAQUE_PENDENTE_INFORMACAO"), true);
checar("tela: laranja pelo grupo nomeado", tela.includes("arte === GRUPO_ENVIAR_ARTE_DO_CARD_EM_ARTE) return DESTAQUE_ENVIAR_ARTE"), true);
checar("tela: sem numero solto no destaque", /arte === [0-9]/.test(tela), false);
checar("tela: vermelho pelo token", tela.includes('base: "var(--row-pendente-informacao)"'), true);
checar("tema claro e escuro definem o token", (css.match(/--row-pendente-informacao:/g) ?? []).length, 2);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
