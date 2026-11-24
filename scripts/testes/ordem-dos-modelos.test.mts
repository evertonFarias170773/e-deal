/**
 * Arrastar para reordenar os modelos da aba Pedido (24/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/ordem-dos-modelos.test.mts
 */
import { readFileSync } from "node:fs";
import { moverNaLista, novaOrdemDoPedido, ordenarComoNaLeitura } from "../../src/features/orcamentos/lib/ordem-dos-modelos.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else console.log(`ok      ${nome}`);
}

checar("mover: 1o para o lugar do 3o", moverNaLista(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
checar("mover: 3o para o 1o", moverNaLista(["b", "c", "a", "d"], 2, 0), ["a", "b", "c", "d"]);
checar("mover: posição inválida não mexe", moverNaLista(["a", "b"], 0, 5), ["a", "b"]);

checar("leitura: ordem e, no empate, id",
  ordenarComoNaLeitura([{ id: 9, idItem: 1, ordem: 1 }, { id: 3, idItem: 1, ordem: 1 }, { id: 5, idItem: 1, ordem: 0 }]).map((m) => m.id),
  [5, 3, 9]);

// Pedido com dois produtos: item 10 (ids 1,2,3) e item 20 (ids 7,8), intercalados.
const pedido = [
  { id: 1, idItem: 10, ordem: 1 },
  { id: 7, idItem: 20, ordem: 2 },
  { id: 2, idItem: 10, ordem: 3 },
  { id: 8, idItem: 20, ordem: 4 },
  { id: 3, idItem: 10, ordem: 5 }
];
checar("os do produto ocupam as posições deles, na ordem nova; os outros não se mexem",
  novaOrdemDoPedido(pedido, 10, [3, 1, 2]),
  { ok: true, mudancas: [{ id: 3, ordem: 1 }, { id: 1, ordem: 3 }, { id: 2, ordem: 5 }] });
checar("mesma ordem: nada a gravar", novaOrdemDoPedido(pedido, 10, [1, 2, 3]), { ok: true, mudancas: [] });
checar("pedido com ordem repetida vira 1..n",
  novaOrdemDoPedido([{ id: 4, idItem: 1, ordem: 1 }, { id: 5, idItem: 1, ordem: 1 }, { id: 6, idItem: 1, ordem: 1 }], 1, [6, 4, 5]),
  // 6 já tinha ordem 1: só 4 e 5 mudam.
  { ok: true, mudancas: [{ id: 4, ordem: 2 }, { id: 5, ordem: 3 }] });
checar("lista da tela diferente do banco: recusa",
  [novaOrdemDoPedido(pedido, 10, [1, 2]).ok, novaOrdemDoPedido(pedido, 10, [1, 2, 3, 7]).ok, novaOrdemDoPedido(pedido, 10, [1, 1, 2]).ok],
  [false, false, false]);

const rota = readFileSync("src/app/api/pedidos/modelos-ordem/route.ts", "utf8");
checar("rota: cobrança ativa exige Editar Proposta Paga ou Editar Faturado (403)",
  [rota.includes('"propostas.editar_paga"'), rota.includes('"propostas.editar_faturado"'), rota.includes('"BLOQUEADO"') && rota.includes("403")],
  [true, true, true]);
checar("rota: grava só a coluna ordem, do próprio pedido",
  [rota.includes(".update({ ordem: m.ordem })"), rota.includes('.eq("id_int", idInt)'), (rota.match(/\.update\(/g) || []).length],
  [true, true, 1]);

const grade = readFileSync("src/features/orcamentos/components/LotesGrid.tsx", "utf8");
checar("grade: alça só com reordenavel e só em lote gravado; soltar grava pela rota",
  [/\{reordenavel && \(\s*linha\.id \?/.test(grade), grade.includes('fetchComSessao("/api/pedidos/modelos-ordem"'), grade.includes("Grave antes de mudar a ordem")],
  [true, true, true]);
checar("grade: arrastar não renumera (modo desmarcado, números ficam) e não vai ao Salvar",
  [grade.includes("const base = modoAntes ? numerar(antes, modoAntes) : antes;"), grade.includes("setModoNumeracao(null);"), grade.includes("if (pularRepasseRef.current) {")],
  [true, true, true]);

const aba = readFileSync("src/features/orcamentos/components/PedidoModelosTab.tsx", "utf8");
checar("aba: a mesma trava da edição dos lotes", aba.includes("reordenavel={!lotesSomenteLeitura}"), true);

const detalhe = readFileSync("src/features/pedidos/services/pedidos-detalhe.service.ts", "utf8");
checar("boletim (detalhe do pedido): ordem e id",
  /\.from\("pedidos_modelos"\)\s*\.select\("\*"\)\s*\.eq\("id_int", row\?\.id_int\)\s*\.order\("ordem", \{ ascending: true \}\)\s*\.order\("id", \{ ascending: true \}\)/.test(detalhe),
  true);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else console.log("\nTudo certo.");
