/**
 * Leitura do filtro "Cobrança" sem o corte de 1.000 linhas (12/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/filtro-cobranca-leitura.test.mts
 *
 * Uma consulta falsa em memória corta em 1.000 linhas como o banco. Prova que:
 *   1. a leitura passa do corte (2.500 cobranças), por candidato e por tipo inteiro;
 *   2. só entram cobranças ATIVAS do tipo, e só dos candidatos;
 *   3. a lista de números é dividida em lotes de até 800 e a junção refaz a
 *      ordem do banco (status_alterado_em desc, vazio por último, id_int desc).
 */
import { readFileSync } from "node:fs";
import {
  CANDIDATOS_PARA_LER_POR_ID,
  idsComCobrancaDoTipo,
  juntarLotesNaOrdem,
  LIMITE_IDS_POR_CONSULTA,
  lotesDaConsulta,
  ordemDaLista,
  type ConsultaCobrancas
} from "../../src/features/orcamentos/lib/filtro-cobranca-leitura.ts";

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

// ── Banco falso: 2.500 cobranças, corte de 1.000 por consulta ──
type Linha = { id: number; id_int: number; tipo_cobranca: string; status: string };
const banco: Linha[] = [];
for (let i = 1; i <= 2500; i++) {
  banco.push({
    id: i,
    id_int: 10000 + i,
    tipo_cobranca: i % 5 === 0 ? "BOLETO" : i % 7 === 0 ? "E-Faturado" : i % 3 === 0 ? "CARD_PARCELADO" : "PIX",
    status: i % 11 === 0 ? "CANCELADO" : "PAID"
  });
}
let consultas = 0;
function consulta(): ConsultaCobrancas {
  const filtros: ((l: Linha) => boolean)[] = [];
  let ordem: { coluna: keyof Linha; asc: boolean } | null = null;
  let limite = 1000;
  const c: ConsultaCobrancas = {
    in(coluna, valores) { filtros.push((l) => (valores as readonly unknown[]).includes(l[coluna as keyof Linha])); return c; },
    neq(coluna, valor) { filtros.push((l) => l[coluna as keyof Linha] !== valor); return c; },
    gt(coluna, valor) { filtros.push((l) => Number(l[coluna as keyof Linha]) > Number(valor)); return c; },
    lt(coluna, valor) { filtros.push((l) => Number(l[coluna as keyof Linha]) < Number(valor)); return c; },
    order(coluna, opcoes) { ordem = { coluna: coluna as keyof Linha, asc: opcoes.ascending }; return c; },
    limit(n) { limite = Math.min(n, 1000); return c; },
    then(ok, erro) {
      consultas += 1;
      let linhas = banco.filter((l) => filtros.every((f) => f(l)));
      if (ordem) { const o = ordem; linhas = [...linhas].sort((a, b) => (Number(a[o.coluna]) - Number(b[o.coluna])) * (o.asc ? 1 : -1)); }
      return Promise.resolve({ data: linhas.slice(0, limite).map(({ id, id_int }) => ({ id, id_int })), error: null }).then(ok, erro);
    }
  };
  return c;
}
const esperado = (candidatos: number[], grafias: string[]) => {
  const set = new Set(candidatos);
  return Array.from(new Set(banco.filter((l) => set.has(l.id_int) && grafias.includes(l.tipo_cobranca) && l.status !== "CANCELADO").map((l) => l.id_int))).sort((a, b) => a - b);
};

const todos = banco.map((l) => l.id_int);
const pixTodos = esperado(todos, ["PIX"]);
checar("o banco falso tem mais de 1.000 PIX ativos (o caso do corte)", pixTodos.length > 1000, true);

// Muitos candidatos (2.500 > 2.000): le o tipo inteiro, paginando.
consultas = 0;
const r1 = await idsComCobrancaDoTipo(consulta, { candidatos: todos, grafias: ["PIX"] });
checar("muitos candidatos: todos os PIX ativos, sem corte", [r1.completo, r1.ids.length, JSON.stringify(r1.ids) === JSON.stringify(pixTodos)], [true, pixTodos.length, true]);
checar("muitos candidatos: paginou (mais de uma consulta)", consultas > 1, true);

// Poucos candidatos: le por id, em lotes de 200.
const poucos = todos.filter((id) => id % 2 === 0).slice(0, 1500);
checar("1.500 candidatos fica no caminho por id", poucos.length <= CANDIDATOS_PARA_LER_POR_ID, true);
const r2 = await idsComCobrancaDoTipo(consulta, { candidatos: poucos, grafias: ["CARD_PARCELADO", "CREDIT_CARD"] });
checar("poucos candidatos: so os cartoes ativos dos candidatos", JSON.stringify(r2.ids) === JSON.stringify(esperado(poucos, ["CARD_PARCELADO", "CREDIT_CARD"])), true);

const r3 = await idsComCobrancaDoTipo(consulta, { candidatos: todos.slice(0, 300), grafias: ["E-FATURADO", "E-Faturado"] });
checar("E-Faturado pela grafia gravada", JSON.stringify(r3.ids) === JSON.stringify(esperado(todos.slice(0, 300), ["E-Faturado"])) && r3.ids.length > 0, true);
checar("cobranca cancelada nao conta", r1.ids.every((id) => banco.some((l) => l.id_int === id && l.tipo_cobranca === "PIX" && l.status !== "CANCELADO")), true);
checar("sem candidatos ou sem grafia: vazio, sem consulta", [(await idsComCobrancaDoTipo(consulta, { candidatos: [], grafias: ["PIX"] })).ids, (await idsComCobrancaDoTipo(consulta, { candidatos: todos, grafias: [] })).ids], [[], []]);

// ── Lotes da consulta da lista ──
checar("sem recorte: um lote nulo", lotesDaConsulta(null), [null]);
checar("ate o limite: um lote so", lotesDaConsulta(pixTodos.slice(0, LIMITE_IDS_POR_CONSULTA)).length, 1);
const lotes = lotesDaConsulta(pixTodos);
checar("acima do limite: lotes de ate 800, sem perder numero", [lotes.every((l) => (l?.length ?? 0) <= 800), lotes.flatMap((l) => l ?? []).length], [true, pixTodos.length]);

// ── Ordem da junção ──
const linhas = [
  { id_int: 1, status_alterado_em: "2026-11-10T10:00:00+00:00" },
  { id_int: 2, status_alterado_em: null },
  { id_int: 3, status_alterado_em: "2026-11-12T09:00:00+00:00" },
  { id_int: 4, status_alterado_em: "2026-11-10T10:00:00+00:00" },
  { id_int: 5, status_alterado_em: null }
];
checar("ordem: data desc, vazio por ultimo, id_int desc no empate", [...linhas].sort(ordemDaLista).map((l) => l.id_int), [3, 4, 1, 5, 2]);
checar("juncao de lotes refaz a ordem", juntarLotesNaOrdem([[linhas[0], linhas[1]], [linhas[2], linhas[3], linhas[4]]]).map((l) => l.id_int), [3, 4, 1, 5, 2]);

// ── O servico usa a leitura nova ──
const servico = readFileSync("src/features/orcamentos/services/orcamentos.service.ts", "utf8");
checar("servico: candidatos por lerTodas e cobrancas por idsComCobrancaDoTipo", [servico.includes('{ colunas: "id_int", idsCobranca: null }'), servico.includes("await idsComCobrancaDoTipo(")], [true, true]);
checar("servico: sem a leitura antiga de uma consulta so", servico.includes('.select("id_int")\n        .in("tipo_cobranca"'), false);
checar("servico: contagem e linhas por lote", [servico.includes("lotesDaConsulta(idsTipoCobranca)"), servico.includes("juntarLotesNaOrdem(")], [true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
