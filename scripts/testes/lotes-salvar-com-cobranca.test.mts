/**
 * Lotes da aba Pedido no "Salvar alterações" de proposta com cobrança ativa
 * AINDA NÃO PAGA (01/10/2026).
 *
 * O QUE PROVA
 *   1. Sem a opção `gravarLotesComCobranca`, o salvamento parcial continua como
 *      era: só as observações, nenhum toque em `pedidos_modelos` — era aqui que
 *      os modelos alterados na lista rápida se perdiam com resposta de sucesso.
 *   2. Com a opção (que só o `editar-paga` passa, depois de conferir valores e
 *      permissão), o parcial grava os lotes de TODOS os produtos, na ordem dos
 *      itens: exclui, atualiza e insere — e segue sem tocar em produto, valor,
 *      desconto ou frete.
 *   3. O checklist do boletim vale igual: coluna que o produto não imprime sai
 *      do UPDATE e nasce NULL no INSERT.
 *   4. Lote de item que não existe na proposta não é gravado.
 *   5. Falha ao gravar um lote devolve o motivo e NÃO grava as observações.
 *
 * NÃO ESCREVE EM BANCO NENHUM: o cliente é o falso de `_supabase-falso.mts`,
 * que só anota o que foi pedido.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/lotes-salvar-com-cobranca.test.mts
 */
import { falso, getSupabaseClient, type Chamada } from "./_supabase-falso.mts";
import { saveProposta } from "../../src/features/orcamentos/services/orcamentos.service.ts";
import type { PropostaFormState } from "../../src/features/orcamentos/types.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = getSupabaseClient() as any;
const ID_INT = 99001;

const lote = (extra: Record<string, unknown>) => ({
  nome_modelo: "A",
  padrao: "Branca",
  quantidade: 100,
  tipo_numeracao: "Sequencial",
  numeracao_inicio: 1,
  numeracao_fim: 100,
  verso_tipo: "SÓ FRENTE",
  bloco: "50",
  gabarito_operacional: "001 - Padrão Ideal",
  status_arte: "PENDENTE",
  status_producao: "PENDENTE",
  ...extra
});

const form = {
  id_int: String(ID_INT),
  observacoes: "obs da proposta",
  obsTecnica: "obs tecnica",
  isAvulso: false,
  deletedProdutoPropostaIds: [],
  itens: [
    { id: "item_10", id_produto_proposta_origem: 10, id_produto: 102, nome: "Pulseira", quantidade: 300, variacoesEscolhidas: [] },
    { id: "item_11", id_produto_proposta_origem: 11, id_produto: 301, nome: "TexBand", quantidade: 120, variacoesEscolhidas: [] },
    // Item que NÃO existe no banco: o parcial não grava produto, nem os lotes dele.
    { id: "item_novo", id_produto_proposta_origem: 77, id_produto: 102, nome: "Fantasma", quantidade: 5, variacoesEscolhidas: [] }
  ],
  pedidosModelos: [
    lote({ id: 500, isPersisted: true, id_produto_proposta_origem: 10, nome_modelo: "A ALTERADO", quantidade: 200 }),
    lote({ tempId: "lote_x", isPersisted: false, id_produto_proposta_origem: 10, nome_modelo: "NOVO", quantidade: 100 }),
    lote({ id: 600, isPersisted: true, id_produto_proposta_origem: 11, nome_modelo: "TEX", quantidade: 120 }),
    lote({ tempId: "lote_f", isPersisted: false, id_produto_proposta_origem: 77, nome_modelo: "FANTASMA", quantidade: 5 })
  ],
  // Um lote excluído de cada produto: a fila soma as exclusões de todas as grades.
  deletedModeloIds: [501, 601],
  fretes: []
} as unknown as PropostaFormState;

function combinar() {
  falso.zerar();
  // Cobrança ativa, não paga: é o estado em que o save sem `force` vira parcial.
  falso.responder("pagamentos_v2:select", { data: [{ id: "c1", status: "A_RECEBER" }], error: null });
  falso.responder("produtos_proposta:select", { data: [{ id: 10, id_produto: 102 }, { id: 11, id_produto: 301 }], error: null });
  // Produto 102 só imprime a cor; o 301 não tem checklist (tudo como sempre).
  falso.responder("produto_boletim_campos:select", { data: [{ id_produto: 102, campo: "cor" }], error: null });
  falso.responder("pedidos_modelos:insert", { data: { id: 900 }, error: null });
  // Conferência do Nº final (29/10/2026): os lotes como estão no banco e o
  // cadastro de numerações. O 600 está como no banco (intocado).
  falso.responder("pedidos_modelos:select", {
    data: [{ id: 600, quantidade: 120, numeracao_inicio: 1, gabarito_operacional: "001 - Padrão Ideal" }],
    error: null
  });
  falso.responder("producao_numeracoes:select", {
    data: [{ name: "001 - Padrão Ideal", tipo: "SEQUENCIAL", ticket_qtd: null }, { name: "Ticket PRATA", tipo: "TICKET", ticket_qtd: 5 }],
    error: null
  });
}

const resumo = (c: Chamada) => `${c.tabela}:${c.op}`;
const filtro = (c: Chamada, nome: string, coluna: string) =>
  (c.filtros.find(([f, args]) => f === nome && (args as unknown[])[0] === coluna)?.[1] as unknown[] | undefined)?.[1];

// ── 1. Sem a opção: parcial de sempre ────────────────────────────────────────
combinar();
const semOpcao = await saveProposta(form, cliente, "usuario-de-teste");
checar("sem a opção: sucesso (parcial)", semOpcao.success, true);
checar(
  "sem a opção: só confere a cobrança e grava as observações",
  falso.chamadas.map(resumo),
  ["pagamentos_v2:select", "propostas:update"]
);
checar("sem a opção: nada em pedidos_modelos", falso.chamadas.filter((c) => c.tabela === "pedidos_modelos").length, 0);

// ── 2. Com a opção: lotes de todos os produtos, na ordem dos itens ───────────
combinar();
const comOpcao = await saveProposta(form, cliente, "usuario-de-teste", { gravarLotesComCobranca: true });
checar("com a opção: sucesso", comOpcao.success, true);
checar(
  "com a opção: sequência das chamadas",
  falso.chamadas.map(resumo),
  [
    "pagamentos_v2:select",
    "produtos_proposta:select",
    "produto_boletim_campos:select",
    // Conferência do Nº final: lotes gravados e cadastro de numerações. O
    // produto 102 não imprime a faixa (fica fora); o 600 está intocado.
    "pedidos_modelos:select",
    "producao_numeracoes:select",
    "pedidos_modelos:delete", // item 10
    "pedidos_modelos:update",
    "pedidos_modelos:insert",
    "pedidos_modelos:delete", // item 11
    "pedidos_modelos:update",
    "propostas:update"
  ]
);

const emLotes = falso.chamadas.filter((c) => c.tabela === "pedidos_modelos" && c.op !== "select");
checar("exclusão do item 10: a fila inteira, presa ao item e à proposta", [
  filtro(emLotes[0], "in", "id"),
  filtro(emLotes[0], "eq", "id_produto_proposta_origem"),
  filtro(emLotes[0], "eq", "id_int")
], [[501, 601], 10, ID_INT]);
checar("exclusão do item 11: presa ao item 11", filtro(emLotes[3], "eq", "id_produto_proposta_origem"), 11);

checar("update do lote 500: é o lote certo", filtro(emLotes[1], "eq", "id"), 500);
const patch500 = emLotes[1].payload as Record<string, unknown>;
checar("update do lote 500: leva o nome e a quantidade novos", [patch500.nome_modelo, patch500.quantidade], ["A ALTERADO", 200]);
checar("update do lote 500: a cor (no checklist) vai", patch500.padrao, "Branca");
checar(
  "update do lote 500: coluna fora do checklist do produto NÃO vai",
  ["verso_tipo", "gabarito_operacional", "tipo_numeracao", "numeracao_inicio", "numeracao_fim"].filter((k) => k in patch500),
  []
);

const novo = emLotes[2].payload as Record<string, unknown>;
checar("insert do lote novo: proposta, item e nome", [novo.id_int, novo.id_produto_proposta_origem, novo.nome_modelo], [ID_INT, 10, "NOVO"]);
checar("insert do lote novo: coluna fora do checklist nasce NULL", [novo.verso_tipo, novo.gabarito_operacional], [null, null]);
checar("insert do lote novo: status inicial do fluxo", [novo.status_arte, novo.status_producao], ["PENDENTE", "PENDENTE"]);

const patch600 = emLotes[4].payload as Record<string, unknown>;
checar("update do lote 600 (produto sem checklist): todas as colunas", [patch600.verso_tipo, patch600.gabarito_operacional], ["SÓ FRENTE", "001 - Padrão Ideal"]);

checar("lote do item que não existe na proposta não é gravado", emLotes.some((c) => (c.payload as Record<string, unknown> | undefined)?.nome_modelo === "FANTASMA"), false);
checar(
  "o parcial segue sem tocar em produto, valor, desconto ou frete",
  falso.chamadas.filter((c) => c.op !== "select" && !["pedidos_modelos", "propostas"].includes(c.tabela)).map(resumo),
  []
);
const obs = falso.chamadas.find((c) => c.tabela === "propostas" && c.op === "update")?.payload as Record<string, unknown>;
checar("propostas: só as observações", Object.keys(obs).sort(), ["obs_proposta", "obs_tecnica"]);
checar("devolve o id do lote novo para a tela", comOpcao.modelosSincronizados, [{ tempId: "lote_x", id: 900, idProdutoPropostaOrigem: 10 }]);

// ── 3. Falha num lote: motivo na resposta, observações NÃO gravadas ──────────
combinar();
falso.responder("pedidos_modelos:update", { data: null, error: { message: "violou a regra X" } });
const comFalha = await saveProposta(form, cliente, "usuario-de-teste", { gravarLotesComCobranca: true });
checar("falha num lote: recusa", comFalha.success, false);
checar("falha num lote: o motivo volta", comFalha.errorMessage, "Erro ao atualizar modelo #500: violou a regra X");
checar("falha num lote: observações não gravadas", falso.chamadas.some((c) => c.tabela === "propostas" && c.op === "update"), false);

// ── 3b. Nº final divergente (29/10/2026): recusa sem escrever nada ───────────
// Lote novo no produto sem checklist (item 11), Ticket PRATA, QTD 4000, Nº
// final 4000 (a conta ×1 dos pedidos 24054, 24420 e 24500).
combinar();
const formTicket = {
  ...form,
  pedidosModelos: [
    ...(form.pedidosModelos ?? []),
    lote({ tempId: "lote_t", isPersisted: false, id_produto_proposta_origem: 11, nome_modelo: "VALE", quantidade: 4000, numeracao_fim: 4000, gabarito_operacional: "Ticket PRATA" })
  ]
} as unknown as PropostaFormState;
const comTicketErrado = await saveProposta(formTicket, cliente, "usuario-de-teste", { gravarLotesComCobranca: true });
checar("Nº final divergente: recusa", comTicketErrado.success, false);
checar("Nº final divergente: mensagem com o número do cadastro", String(comTicketErrado.errorMessage).includes("VALE (Ticket PRATA): Nº final 4000, o cadastro dá 20000"), true);
checar("Nº final divergente: nenhuma escrita", falso.chamadas.filter((c) => c.op !== "select").length, 0);
combinar();
const formTicketCerto = {
  ...formTicket,
  pedidosModelos: (formTicket.pedidosModelos ?? []).map((m) => (m.tempId === "lote_t" ? { ...m, numeracao_fim: 20000 } : m))
} as unknown as PropostaFormState;
const comTicketCerto = await saveProposta(formTicketCerto, cliente, "usuario-de-teste", { gravarLotesComCobranca: true });
checar("Nº final certo (20000): grava", comTicketCerto.success, true);

// ── 3c. Salvar corrige o Nº final da linha intocada (24420) ──────────────────
// Três lotes já gravados no item 11, nenhum alterado na tela:
//   700 = o 24420 (Ticket PRATA, QTD 4000, inicial 1, gravado 4000);
//   701 = Ticket PRATA certo (QTD 200, 1-1000);
//   702 = numerador que não está no cadastro (fica como está).
combinar();
const gravados3c = [
  { id: 600, quantidade: 120, numeracao_inicio: 1, gabarito_operacional: "001 - Padrão Ideal" },
  { id: 700, quantidade: 4000, numeracao_inicio: 1, gabarito_operacional: "Ticket PRATA" },
  { id: 701, quantidade: 200, numeracao_inicio: 1, gabarito_operacional: "Ticket PRATA" },
  { id: 702, quantidade: 68, numeracao_inicio: 1, gabarito_operacional: "Credencial 10x15cm" }
];
falso.responder("pedidos_modelos:select", { data: gravados3c, error: null });
const form3c = {
  ...form,
  pedidosModelos: [
    ...(form.pedidosModelos ?? []),
    lote({ id: 700, isPersisted: true, id_produto_proposta_origem: 11, nome_modelo: "VALE 01 REFEIÇÃO", quantidade: 4000, numeracao_fim: 4000, gabarito_operacional: "Ticket PRATA" }),
    lote({ id: 701, isPersisted: true, id_produto_proposta_origem: 11, nome_modelo: "CERTO", quantidade: 200, numeracao_fim: 1000, gabarito_operacional: "Ticket PRATA" }),
    lote({ id: 702, isPersisted: true, id_produto_proposta_origem: 11, nome_modelo: "FORA", quantidade: 68, numeracao_fim: 68, gabarito_operacional: "Credencial 10x15cm" })
  ]
} as unknown as PropostaFormState;
// Pedido que ainda não saiu: o editar-paga leu EM PRODUCAO no banco.
const salvo3c = await saveProposta(form3c, cliente, "usuario-de-teste", { gravarLotesComCobranca: true, statusDoBanco: "EM PRODUCAO" });
checar("3c: salva", salvo3c.success, true);
const updates3c = falso.chamadas.filter((c) => c.tabela === "pedidos_modelos" && c.op === "update");
const fimGravado = (id: number) => (updates3c.find((c) => filtro(c, "eq", "id") === id)?.payload as Record<string, unknown> | undefined)?.numeracao_fim;
checar("3c: o 24420 (700) vai com 20000, sem ninguém mexer na linha", fimGravado(700), 20000);
checar("3c: a linha correta (701) vai com o mesmo 1000", fimGravado(701), 1000);
checar("3c: numerador fora do cadastro (702) fica com o que tinha", fimGravado(702), 68);
checar("3c: o estado da tela não é alterado (a correção é só no que vai ao banco)", form3c.pedidosModelos?.find((m) => m.id === 700)?.numeracao_fim, 4000);

// ── 4. Leitura do checklist falhou: nada gravado ─────────────────────────────
combinar();
falso.responder("produto_boletim_campos:select", { data: null, error: { message: "timeout" } });
const semChecklist = await saveProposta(form, cliente, "usuario-de-teste", { gravarLotesComCobranca: true });
checar("checklist ilegível: recusa", semChecklist.success, false);
checar("checklist ilegível: nenhuma escrita", falso.chamadas.filter((c) => c.op !== "select").length, 0);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
