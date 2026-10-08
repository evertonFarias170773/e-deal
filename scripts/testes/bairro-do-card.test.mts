/**
 * Bairro no card da Expedição, só nas entregas por motoboy (08/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/bairro-do-card.test.mts
 *
 * O QUE PROVA
 *   1. Motoboy mostra o bairro; Retira, Correios, transportadora (rodoviário,
 *      aéreo, VEPPO) e não classificado (EXTRAS / nulo) não mostram.
 *   2. Bairro vazio, "NULL", "undefined" e "[object Object]" somem, sem espaço.
 *   3. Nome longo volta INTEIRO (é o que vai no `title`); o corte com reticências
 *      é do CSS, e os dois cartões usam a linha `truncate`, o bairro em negrito
 *      e o `title` com o nome completo.
 *   4. O critério de motoboy é o da coluna do Kanban (`categoriaExibida`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bairroDoCard, bairroExibivel, envioPorMotoboy } from "../../src/features/expedicao/lib/bairro-do-card.ts";
import { CATEGORIAS_FRETE, categoriaExibida } from "../../src/features/orcamentos/lib/categoria-frete.ts";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

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

const com = (categoriaFrete: string | null, bairro: unknown) => ({
  categoriaFrete: categoriaFrete as never,
  enderecoEntrega: { bairro: bairro as string | null }
});

// ── 1. Só motoboy ───────────────────────────────────────────────────────────
checar("motoboy mostra o bairro", bairroDoCard(com("MOTOBOY", "Menino Deus")), "Menino Deus");
checar("as outras categorias nao mostram",
  CATEGORIAS_FRETE.filter((c) => c !== "MOTOBOY").map((c) => [c, bairroDoCard(com(c, "Menino Deus"))]),
  CATEGORIAS_FRETE.filter((c) => c !== "MOTOBOY").map((c) => [c, ""]));
checar("retira no balcao nao mostra", bairroDoCard(com("RETIRA", "Centro")), "");
checar("correios nao mostra", bairroDoCard(com("CORREIOS", "Centro")), "");
checar("transportadora nao mostra", [bairroDoCard(com("RODOVIARIO", "Centro")), bairroDoCard(com("AEREO", "Centro")), bairroDoCard(com("VEPPO", "Centro"))], ["", "", ""]);
checar("nao classificado (a definir) nao mostra", [bairroDoCard(com(null, "Centro")), bairroDoCard(com("EXTRAS", "Centro")), bairroDoCard(com("QUALQUER COISA", "Centro"))], ["", "", ""]);
checar("o criterio e o da coluna do Kanban",
  [...CATEGORIAS_FRETE, null].map((c) => envioPorMotoboy(c as never)),
  [...CATEGORIAS_FRETE, null].map((c) => categoriaExibida(c as never) === "MOTOBOY"));
checar("motoboy sem endereco de entrega nao quebra", bairroDoCard({ categoriaFrete: "MOTOBOY", enderecoEntrega: null }), "");

// ── 2. Valor invalido some ──────────────────────────────────────────────────
checar("vazio, espacos e nulo somem", ["", "   ", null, undefined].map((b) => bairroDoCard(com("MOTOBOY", b))), ["", "", "", ""]);
checar("lixo de cadastro some",
  ["NULL", "null", " Null ", "undefined", "UNDEFINED", "[object Object]", "[OBJECT OBJECT]", "x [object Object]", "NaN", "-"].map((b) => bairroDoCard(com("MOTOBOY", b))),
  ["", "", "", "", "", "", "", "", "", ""]);
checar("valor que nao e texto some", [bairroExibivel(123), bairroExibivel({}), bairroExibivel([])], ["", "", ""]);
checar("espacos nas bordas e repetidos sao arrumados", bairroDoCard(com("MOTOBOY", "  Jardim   Botânico ")), "Jardim Botânico");

// ── 3. Nome longo ───────────────────────────────────────────────────────────
const longo = "Loteamento Residencial Parque das Hortênsias do Vale do Sol Nascente";
checar("nome longo volta inteiro, para o title", bairroDoCard(com("MOTOBOY", longo)), longo);

const kanban = readFileSync(path.join(AQUI, "../../src/features/expedicao/components/KanbanTransportadoras.tsx"), "utf8").replace(/\r\n/g, "\n");
const pagina = readFileSync(path.join(AQUI, "../../src/features/expedicao/ExpedicaoPage.tsx"), "utf8").replace(/\r\n/g, "\n");
const trechoKanban = kanban.slice(kanban.indexOf("{p.enderecoEntrega?.cidadeUf && (\n                        <p"), kanban.indexOf("{p.pagador && (\n                        <p"));
checar("Kanban: a linha da cidade corta com reticencias", trechoKanban.includes('className="truncate '), true);
checar("Kanban: bairro em negrito, com o nome inteiro no title", /<strong className="font-bold[^"]*" title=\{bairroDoCard\(p\)\}>\s*\{bairroDoCard\(p\)\}\s*<\/strong>/.test(trechoKanban), true);
checar("Kanban: separador so quando ha bairro", /\{bairroDoCard\(p\) && \(\s*<>\s*\{" · "\}/.test(trechoKanban), true);
const trechoCelular = pagina.slice(pagina.indexOf("{/* Mesma fonte do desktop: a cidade de ENTREGA. */}"), pagina.indexOf("{p.vendedor && <p className=\"text-xs text-slate-500\">Vendedor:"));
checar("celular: corta com reticencias quando ha bairro", trechoCelular.includes('${bairroDoCard(p) ? " truncate" : ""}'), true);
checar("celular: bairro em negrito, com o nome inteiro no title", /<strong className="font-bold[^"]*" title=\{bairroDoCard\(p\)\}>\s*\{bairroDoCard\(p\)\}\s*<\/strong>/.test(trechoCelular), true);
checar("a linha da LISTA (tabela) nao foi alterada", (pagina.match(/bairroDoCard\(p\)/g) ?? []).length, 4);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
