/**
 * Trava de quantidade na liberação para produção — Etapa 7. SEM BANCO.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/trava-lotes-liberacao.test.mts
 *
 * O QUE PROVA
 *   A. A regra pura (lib/divergencia-lotes): soma igual passa; soma menor,
 *      maior e item sem lote reprovam; lote solto não conta; a mensagem sai no
 *      formato "Produto X: vendido N, lotes somam M".
 *   B. `liberarPropostaParaProducao`, com o cliente falso: com divergência, a
 *      liberação é RECUSADA com a lista e `propostas` não recebe UPDATE nenhum
 *      (a proposta fica onde estava, em REVISAO ATENDENTE); sem divergência,
 *      libera; leitura de lote que falha recusa; item CANCELADO fica fora da
 *      consulta.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FALSO = pathToFileURL(path.join(AQUI, "_supabase-falso.mts")).href;

registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@/lib/supabase/client") return { url: FALSO, shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const regra = await import("../../src/features/orcamentos/lib/divergencia-lotes.ts");
const { falso, getSupabaseClient } = await import("./_supabase-falso.mts");

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

// ══ A. regra pura ═══════════════════════════════════════════════════════════
console.log("══ A. regra pura");

const item = (id: number, nome: string, qtd: number) => ({ id, nome, qtd });
const lote = (idItem: number | null, quantidade: number) => ({ id_produto_proposta_origem: idItem, quantidade });

checar("soma igual: nenhuma divergencia", regra.divergenciasDeLotes([item(1, "Cordão", 90)], [lote(1, 80), lote(1, 10)]), []);

// O caso que motivou a trava, com os numeros do 22194.
const caso22194 = regra.divergenciasDeLotes(
  [item(10, "TexPlus", 1250), item(11, "Pulseira Triband", 500)],
  [lote(10, 8)]
);
checar(
  "22194: TexPlus com lote de 8 e Triband sem lote reprovam",
  caso22194.map((d) => [d.nome, d.vendido, d.somaLotes]),
  [["TexPlus", 1250, 8], ["Pulseira Triband", 500, 0]]
);
checar(
  "mensagem: uma linha por divergencia, no formato pedido",
  regra.mensagemDasDivergencias(caso22194).split("\n").slice(1),
  ["TexPlus: vendido 1.250, lotes somam 8", "Pulseira Triband: vendido 500, lotes somam 0"]
);
checar("soma MAIOR tambem reprova", regra.divergenciasDeLotes([item(2, "Cordão Plus", 10)], [lote(2, 18)]).length, 1);
checar("item sem lote nenhum (soma 0) reprova", regra.divergenciasDeLotes([item(3, "Protetor", 10)], []).length, 1);
checar(
  "lote solto (sem item) nao conta para ninguem",
  regra.divergenciasDeLotes([item(4, "Pulseira", 5)], [lote(null, 5)]).map((d) => d.somaLotes),
  [0]
);
checar("lote de outro item nao conta", regra.divergenciasDeLotes([item(5, "A", 5)], [lote(6, 5)]).length, 1);
checar("proposta sem item: nada a conferir", regra.divergenciasDeLotes([], [lote(7, 5)]), []);

// ══ B. liberarPropostaParaProducao ══════════════════════════════════════════
console.log("\n══ B. liberarPropostaParaProducao (cliente falso)");
const orcamentos = await import("../../src/features/orcamentos/services/orcamentos.service.ts");
const cliente = getSupabaseClient() as unknown as Parameters<typeof orcamentos.liberarPropostaParaProducao>[1];

/** Proposta pronta para liberar, em tudo menos nos lotes. */
function cenario(itens: unknown[], lotes: unknown, erroLotes = false) {
  falso.zerar();
  falso.responder("propostas:select", {
    data: { is_avulso: false, status_interno: "REVISAO ATENDENTE", is_prd_aprovado: false },
    error: null
  });
  falso.responder("pagamentos_v2:select", { data: [{ status: "PAID", confirmado: true }], error: null });
  falso.responder("pedidos_artes:select", { data: [{ status: "APROVADO" }], error: null });
  falso.responder("produtos_proposta:select", { data: itens, error: null });
  falso.responder(
    "pedidos_modelos:select",
    erroLotes ? { data: null, error: { message: "falha simulada" } } : { data: lotes, error: null }
  );
}
const updatesEmPropostas = () => falso.chamadas.filter((c) => c.tabela === "propostas" && c.op === "update");

cenario(
  [{ id: 10, nome_produto: "TexPlus", qtd: 1250 }, { id: 11, nome_produto: "Pulseira Triband", qtd: 500 }],
  [{ id_produto_proposta_origem: 10, quantidade: 8 }]
);
const recusada = await orcamentos.liberarPropostaParaProducao(22194, cliente);
checar("com divergencia: RECUSADA", recusada.success, false);
checar("com divergencia: code LOTES_DIVERGENTES", recusada.code, "LOTES_DIVERGENTES");
checar("com divergencia: as duas divergencias voltam", (recusada.divergencias || []).length, 2);
checar(
  "com divergencia: a mensagem lista cada uma",
  (recusada.errorMessage || "").includes("TexPlus: vendido 1.250, lotes somam 8") &&
    (recusada.errorMessage || "").includes("Pulseira Triband: vendido 500, lotes somam 0"),
  true
);
checar("com divergencia: propostas NAO recebe UPDATE (fica em REVISAO ATENDENTE)", updatesEmPropostas().length, 0);

const consultaItens = falso.chamadas.find((c) => c.tabela === "produtos_proposta" && c.op === "select");
checar(
  "item CANCELADO fica fora da conferencia",
  consultaItens?.filtros.some(([f, a]) => f === "or" && JSON.stringify(a) === JSON.stringify(["status_item.is.null,status_item.neq.CANCELADO"])),
  true
);

cenario(
  [{ id: 20, nome_produto: "Cordão 85cm", qtd: 500 }, { id: 21, nome_produto: "Protetor para Crachá", qtd: 10 }],
  [
    { id_produto_proposta_origem: 20, quantidade: 300 },
    { id_produto_proposta_origem: 20, quantidade: 200 },
    { id_produto_proposta_origem: 21, quantidade: 10 }
  ]
);
const liberada = await orcamentos.liberarPropostaParaProducao(22500, cliente);
checar("sem divergencia (prateleira inclusa): LIBERA", liberada.success, true);
const upd = updatesEmPropostas()[0]?.payload as Record<string, unknown> | undefined;
checar("sem divergencia: o UPDATE liga is_prd_aprovado e vai a REVISAO PRODUCAO", [upd?.is_prd_aprovado, upd?.status_interno], [true, "REVISAO PRODUCAO"]);

cenario([{ id: 30, nome_produto: "Cordão", qtd: 10 }], null, true);
const semLeitura = await orcamentos.liberarPropostaParaProducao(22501, cliente);
checar("leitura dos lotes falhou: recusa", semLeitura.success, false);
checar("leitura dos lotes falhou: nenhum UPDATE", updatesEmPropostas().length, 0);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
