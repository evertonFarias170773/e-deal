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
    "pedidos_modelos:delete", // item 10
    "pedidos_modelos:update",
    "pedidos_modelos:insert",
    "pedidos_modelos:delete", // item 11
    "pedidos_modelos:update",
    "propostas:update"
  ]
);

const emLotes = falso.chamadas.filter((c) => c.tabela === "pedidos_modelos");
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

// ── 4. Leitura do checklist falhou: nada gravado ─────────────────────────────
combinar();
falso.responder("produto_boletim_campos:select", { data: null, error: { message: "timeout" } });
const semChecklist = await saveProposta(form, cliente, "usuario-de-teste", { gravarLotesComCobranca: true });
checar("checklist ilegível: recusa", semChecklist.success, false);
checar("checklist ilegível: nenhuma escrita", falso.chamadas.filter((c) => c.op !== "select").length, 0);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
