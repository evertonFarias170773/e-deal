/**
 * As DANFEs que um pedido oferece para baixar, e os rotulos de cada uma.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/danfes-do-pedido.test.mts
 *
 * A montagem da lista e funcao pura. Aqui ela roda com as notas REAIS do banco
 * (so SELECT) e com listas montadas, que e o unico jeito de exercitar o submenu:
 * hoje nenhum pedido tem mais de uma autorizada de producao.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

const tentativas: string[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) {
    tentativas.push(metodo);
    throw new Error("escrita barrada no teste");
  }
  return fetchOriginal(entrada, init);
}) as typeof fetch;

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

const { danfesDoPedido, rotuloDaDanfe, COLUNAS_DANFE_DO_PEDIDO } = await import("../../src/lib/fiscal/danfes-do-pedido.ts");
const { COLUNAS_NOTA_DO_PEDIDO } = await import("../../src/lib/fiscal/nota-do-pedido.ts");

// ── 1. Listas montadas: e onde o submenu aparece ────────────────────────────
const base = { status: "AUTORIZADA", ambiente: "producao", url_danfe: "https://focus/danfe" };
const tresNotas = [
  { ...base, ref: "NFE-22066-003", numero_nf: 7503, tipo_nota: "REMESSA", data_autorizacao: "2026-09-16T09:00:00Z", created_at: "2026-09-16T08:00:00Z" },
  { ...base, ref: "NFE-22066-001", numero_nf: 7501, tipo_nota: null, data_autorizacao: "2026-09-15T12:00:00Z", created_at: "2026-09-15T11:00:00Z" },
  { ...base, ref: "NFE-22066-002", numero_nf: 7502, tipo_nota: null, data_autorizacao: "2026-09-15T18:00:00Z", created_at: "2026-09-15T17:00:00Z" }
];
const lista = danfesDoPedido(tresNotas);
console.log("\n=== submenu de um pedido com tres notas ===");
for (const danfe of lista) console.log(`  ${rotuloDaDanfe(danfe)}`);

checar("a ordem e cronologica, da mais antiga para a mais nova",
  lista.map((d) => d.ref), ["NFE-22066-001", "NFE-22066-002", "NFE-22066-003"]);
checar("a primeira venda e NF venda, a seguinte e complementar, a remessa e remessa",
  lista.map((d) => d.rotulo), ["NF venda", "NF complementar", "NF remessa"]);
checar("o rotulo mostra numero e ref",
  rotuloDaDanfe(lista[0]), "NF venda - nº 7501 (NFE-22066-001)");

// A remessa nao rouba o lugar da venda, mesmo autorizada ANTES dela.
const remessaPrimeiro = danfesDoPedido([
  { ...base, ref: "NFE-30000-002", numero_nf: 8002, tipo_nota: "REMESSA", data_autorizacao: "2026-09-10T09:00:00Z", created_at: "2026-09-10T08:00:00Z" },
  { ...base, ref: "NFE-30000-001", numero_nf: 8001, tipo_nota: null, data_autorizacao: "2026-09-10T18:00:00Z", created_at: "2026-09-10T17:00:00Z" }
]);
checar("remessa autorizada antes da venda nao vira NF venda",
  remessaPrimeiro.map((d) => d.rotulo), ["NF remessa", "NF venda"]);

// ── 2. O que fica de fora ───────────────────────────────────────────────────
const descartadas = danfesDoPedido([
  { ...base, ref: "A", numero_nf: 1, ambiente: "homologacao", data_autorizacao: "2026-01-01T00:00:00Z" },
  { ...base, ref: "B", numero_nf: 2, status: "CANCELADA", data_autorizacao: "2026-01-02T00:00:00Z" },
  { ...base, ref: "C", numero_nf: null, data_autorizacao: "2026-01-03T00:00:00Z" },
  { ...base, ref: "D", numero_nf: 4, url_danfe: null, data_autorizacao: "2026-01-04T00:00:00Z" },
  { ...base, ref: "E", numero_nf: 5, status: "PENDENTE", data_autorizacao: null }
]);
checar("homologacao, cancelada, sem numero, sem link e rascunho ficam de fora", descartadas, []);
checar("sem nota nenhuma, a lista e vazia (o icone nao aparece)", danfesDoPedido([]), []);
checar("null nao quebra", danfesDoPedido(null), []);

// ── 3. Com as notas reais do banco ──────────────────────────────────────────
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.NEXT_PUBLIC_SUPABASE_URL && SERVICE) {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);
  const { data } = await sb
    .from("notas_fiscais")
    .select(`id_int, ${COLUNAS_NOTA_DO_PEDIDO}, ${COLUNAS_DANFE_DO_PEDIDO}`);
  const notas = (data ?? []) as Array<Record<string, unknown>>;

  const porPedido = new Map<number, Array<Record<string, unknown>>>();
  for (const nota of notas) {
    const id = Number(nota.id_int);
    porPedido.set(id, [...(porPedido.get(id) ?? []), nota]);
  }

  let comIcone = 0;
  let comSubmenu = 0;
  const rotulos = new Map<string, number>();
  for (const [, doPedido] of porPedido) {
    const danfes = danfesDoPedido(doPedido as never);
    if (danfes.length > 0) comIcone += 1;
    if (danfes.length > 1) comSubmenu += 1;
    for (const d of danfes) rotulos.set(d.rotulo, (rotulos.get(d.rotulo) ?? 0) + 1);
  }

  console.log(`\n=== no banco de hoje ===`);
  console.log(`pedidos com nota: ${porPedido.size} | com icone de DANFE: ${comIcone} | com submenu: ${comSubmenu}`);
  console.log(`rotulos: ${[...rotulos].map(([r, n]) => `${r} ${n}`).join(", ") || "(nenhum)"}`);

  checar("todo pedido com icone tem pelo menos uma DANFE com link",
    [...porPedido.values()].every((doPedido) => {
      const danfes = danfesDoPedido(doPedido as never);
      return danfes.length === 0 || danfes.every((d) => d.url.startsWith("http"));
    }), true);
  checar("nenhuma escrita tentada", tentativas.length, 0);
} else {
  console.log("\n(sem .env.local: a parte do banco nao rodou)");
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
