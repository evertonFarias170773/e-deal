/**
 * O painel da Expedição não perde pedido pelo teto de 1.000 linhas (03/11/2026).
 *
 * O QUE PROVA
 *   1. a janela dos entregues na consulta: começa um dia antes do corte exato
 *      (o laço do painel continua decidindo o dia);
 *   2. contra a base real: o painel tem TODOS os pedidos abertos e TODOS os
 *      entregues dos últimos 30 dias, e nada além disso — o mesmo conjunto de
 *      antes, sem o corte;
 *   3. os pedidos que estavam escondidos em 03/11 (22721, 22400, 22269, 22249,
 *      20361, 13020) aparecem, e a busca da tela acha o 22249 pelo número.
 *
 * SÓ LEITURA. Usa a chave de serviço, como os outros testes do painel.
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/painel-expedicao-teto.test.mts
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

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

if (!URL || !SERVICE) {
  console.log("(pulando: .env.local sem chaves)");
  process.exit(0);
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;

const { listarPainelExpedicao, inicioJanelaEntregue, hojeSaoPaulo } = await import(
  "../../src/features/expedicao/services/expedicao.service.ts"
);
const { STATUS_PEDIDO_EM_ABERTO } = await import("../../src/features/expedicao/lib/pedido-em-aberto.ts");
const { createClient } = await import("@supabase/supabase-js");

// ── 1. A janela ─────────────────────────────────────────────────────────────
checar("janela de 30 dias a partir de 03/11 começa em 03/10 00:00 SP", inicioJanelaEntregue("2026-11-03", 30), "2026-10-03T03:00:00.000Z");

// ── 2. O conjunto, contra a base ────────────────────────────────────────────
const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
const painel = await listarPainelExpedicao();
const noPainel = new Set(painel.map((p) => p.idInt));
console.log(`\n>>> painel com ${painel.length} pedidos\n`);

// Abertos, lidos de forma independente (contagem exata + ids em páginas).
async function idsPaginados(montar: (de: number, ate: number) => PromiseLike<{ data: { id_int: number }[] | null; error: unknown }>) {
  const ids: number[] = [];
  for (let de = 0; ; de += 1000) {
    const r = await montar(de, de + 999);
    if (r.error || !r.data) throw new Error(`leitura falhou: ${JSON.stringify(r.error)}`);
    ids.push(...r.data.map((l) => Number(l.id_int)));
    if (r.data.length < 1000) break;
  }
  return ids;
}

const abertos = await idsPaginados((de, ate) =>
  db.from("propostas").select("id_int").eq("is_prd_aprovado", true).in("status_interno", STATUS_PEDIDO_EM_ABERTO)
    .is("encerrado_teste_em", null).order("id_int").range(de, ate)
);
checar("abertos longe do teto de 1.000", abertos.length < 900, true);
checar("todo pedido aberto está no painel", abertos.filter((id) => !noPainel.has(id)), []);

// Entregues: todos, com a data de entrega, e o corte exato do painel (dia SP).
const entregues = await idsPaginados((de, ate) =>
  db.from("propostas").select("id_int").eq("is_prd_aprovado", true).eq("status_interno", "ENTREGUE")
    .is("encerrado_teste_em", null).order("id_int").range(de, ate)
);
const dataEntrega = new Map<number, string | null>();
for (let i = 0; i < entregues.length; i += 200) {
  const r = await db.from("expedicoes").select("id_int, data_entrega").in("id_int", entregues.slice(i, i + 200));
  for (const l of r.data ?? []) dataEntrega.set(Number(l.id_int), l.data_entrega);
}
const hoje = hojeSaoPaulo();
const dia = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const entreguesVisiveis = entregues.filter((id) => {
  const d = dataEntrega.get(id);
  return !d || dias(dia(d), hoje) <= 30;
});
checar("entregues dos últimos 30 dias passam de 800 (o caso que estourava)", entreguesVisiveis.length > 800, true);
checar("todo entregue dos últimos 30 dias está no painel", entreguesVisiveis.filter((id) => !noPainel.has(id)), []);

const esperado = new Set([...abertos, ...entreguesVisiveis]);
checar("nada além de abertos e entregues recentes", painel.filter((p) => !esperado.has(p.idInt)).map((p) => p.idInt), []);
checar("painel = abertos + entregues recentes", painel.length, esperado.size);
checar("nenhum pedido repetido", noPainel.size, painel.length);

// ── 3. Os escondidos de 03/11 e a busca ─────────────────────────────────────
const ESCONDIDOS = [22721, 22400, 22269, 22249, 20361, 13020];
const abertosSet = new Set(abertos);
for (const id of ESCONDIDOS) {
  // Só cobra quem segue aberto: se avançou para ENTREGUE antiga, saiu por regra.
  if (abertosSet.has(id)) checar(`#${id} (escondido em 03/11) aparece`, noPainel.has(id), true);
}
// Mesmo predicado de número da tela (ExpedicaoPage: String(p.idInt).includes(q)).
const achados = painel.filter((p) => String(p.idInt).includes("22249")).map((p) => p.idInt);
if (abertosSet.has(22249)) checar("busca '22249' acha o pedido", achados.includes(22249), true);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
