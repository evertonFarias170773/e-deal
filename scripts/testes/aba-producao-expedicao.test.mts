/**
 * A aba "Produção" do pedido passa a se chamar "Produção / Expedição" (09/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/aba-producao-expedicao.test.mts
 *
 * O QUE PROVA
 *   1. O rótulo novo está na barra de abas, uma vez só.
 *   2. Só o rótulo mudou: o id da aba continua "producao", ele segue na lista
 *      de abas válidas do `?tab=` e o conteúdo continua preso a esse id — os
 *      links já salvos (`?tab=producao`) abrem a mesma aba.
 *   3. As outras abas não mudaram de nome nem de ordem.
 *   4. O menu lateral "Produção" (a tela da fábrica) não foi tocado.
 *
 * Lê o fonte; sem banco e sem tela.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fonte = readFileSync(path.join(RAIZ, "src/features/orcamentos/OrcamentoFormPage.tsx"), "utf8");
const menu = readFileSync(path.join(RAIZ, "src/constants/navigation.ts"), "utf8");

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

// ── 1 e 3. A barra de abas ──────────────────────────────────────────────────
const abas = [...fonte.matchAll(/\{ id: "([a-z]+)", label: "([^"]+)" \}/g)].map((m) => [m[1], m[2]]);
checar("barra de abas, na ordem", abas, [
  ["geral", "Geral"],
  ["produtos", "Orçamento"],
  ["fretes", "Fretes"],
  ["pedido", "Pedido"],
  ["artes", "Artes"],
  ["producao", "Produção / Expedição"],
  ["pagamentos", "Pagamentos"],
  ["historico", "Histórico"]
]);
checar("rótulo antigo saiu da barra", fonte.includes('{ id: "producao", label: "Produção" }'), false);

// ── 2. O id e o ?tab= não mudaram ───────────────────────────────────────────
checar("conteúdo da aba segue no id producao", fonte.includes('activeFormTab === "producao" && shouldShowRest'), true);
checar('"producao" segue entre as abas válidas', /^\s*"producao",\s*$/m.test(fonte), true);
checar("nenhum id novo de aba", /producao-expedicao|producao_expedicao|producaoExpedicao/.test(fonte), false);

// ── 4. O menu lateral ───────────────────────────────────────────────────────
checar('menu lateral segue "Produção"', menu.includes('label: "Produção"'), true);
checar("menu lateral não ganhou o nome da aba", menu.includes("Produção / Expedição"), false);

if (falhas > 0) {
  console.log(`\n${falhas} verificacao(oes) falharam.`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
