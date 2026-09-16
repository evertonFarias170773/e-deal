/**
 * Abrir o mesmo pedido duas vezes nao cria dois rascunhos.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/reaproveitar-rascunho.test.mts
 *
 * Tudo simulado: o fetch e interceptado, a leitura passa e a ESCRITA e barrada e
 * registrada. Reaproveitar nao escreve nada — entao "zero escritas" e a prova.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

type Tentativa = { metodo: string; url: string };
const tentativas: Tentativa[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const url = String(entrada instanceof Request ? entrada.url : entrada);
  if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) {
    tentativas.push({ metodo, url: url.split("?")[0] });
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

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE) {
  console.log("(pulando: .env.local sem chaves)");
  process.exit(0);
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;

const { createOrReuseNfeDraft, STATUS_DESCARTAVEIS_NFE } = await import("../../src/features/nfe/services/nfe.service.ts");
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

/** Abre o pedido e devolve a ref que a tela receberia, com o que foi escrito. */
async function abrir(idInt: number) {
  tentativas.length = 0;
  let ref: string | null = null;
  let erro: string | null = null;
  try {
    const draft = await createOrReuseNfeDraft(idInt);
    ref = String((draft as { ref?: string }).ref ?? "");
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }
  return { ref, erro, escritas: tentativas.filter((t) => t.url.includes("/rest/v1/")).length };
}

// ── 1. Pedido com rascunho de VENDA e rascunho de REMESSA ao mesmo tempo ─────
const { data: doPedido } = await sb
  .from("notas_fiscais")
  .select("ref, status, tipo_nota, valor_total_nf")
  .eq("id_int", 22192)
  .order("ref");
console.log("\n#22192 hoje:");
for (const n of (doPedido ?? []) as Array<Record<string, unknown>>) {
  console.log(`  ${n.ref}  ${n.status}  ${n.tipo_nota ?? "(venda)"}  R$ ${n.valor_total_nf}`);
}

// O que a consulta ANTIGA devolvia: sem filtro de tipo, sem ordem.
const { data: antiga } = await sb
  .from("notas_fiscais").select("ref, tipo_nota")
  .eq("id_int", 22192).eq("status", "PENDENTE").limit(1).maybeSingle();
console.log(`\nconsulta ANTIGA (sem filtro de tipo) devolvia: ${JSON.stringify(antiga)}`);

const primeira = await abrir(22192);
const segunda = await abrir(22192);
console.log(`abrir #22192 1a vez: ref ${primeira.ref} | escritas ${primeira.escritas}`);
console.log(`abrir #22192 2a vez: ref ${segunda.ref} | escritas ${segunda.escritas}`);

checar("reaproveita o rascunho de VENDA, nao a remessa", primeira.ref, "NFE-22192-002");
checar("a segunda abertura devolve o MESMO rascunho", segunda.ref, primeira.ref);
checar("nenhuma das duas aberturas escreveu", [primeira.escritas, segunda.escritas], [0, 0]);
checar("a remessa do pedido nao foi tocada",
  (antiga as { tipo_nota?: string } | null)?.tipo_nota === "REMESSA" ? primeira.ref !== "NFE-22192-003" : true, true);

// ── 2. Todo pedido com rascunho de venda pendente reaproveita ────────────────
const { data: pendentes } = await sb
  .from("notas_fiscais").select("id_int, ref")
  .eq("status", "PENDENTE").is("tipo_nota", null);
const lista = (pendentes ?? []) as Array<{ id_int: number; ref: string }>;
console.log(`\nrascunhos de venda pendentes no banco: ${lista.length}`);

let reaproveitados = 0;
let escritasNoTotal = 0;
for (const p of lista) {
  const r = await abrir(Number(p.id_int));
  escritasNoTotal += r.escritas;
  if (r.ref === p.ref) reaproveitados += 1;
  else console.log(`  #${p.id_int}: esperava ${p.ref}, veio ${r.ref ?? r.erro}`);
}
checar(`os ${lista.length} reaproveitam o proprio rascunho`, reaproveitados, lista.length);
checar("nenhuma escrita em todo o lote", escritasNoTotal, 0);

// ── 3. Pedido SEM rascunho: aí sim tentaria criar (e a escrita e barrada) ────
const { data: autorizadas } = await sb
  .from("notas_fiscais").select("id_int")
  .eq("status", "AUTORIZADA").eq("ambiente", "producao").not("numero_nf", "is", null).is("tipo_nota", null);
const comPendente = new Set(lista.map((p) => Number(p.id_int)));
const semRascunho = [...new Set((autorizadas ?? []).map((n) => Number((n as { id_int: number }).id_int)))]
  .filter((id) => !comPendente.has(id)).sort((a, b) => b - a)[0];

if (semRascunho) {
  const nova = await abrir(semRascunho);
  console.log(`\n#${semRascunho} nao tem rascunho: escritas tentadas ${nova.escritas} (barradas)`);
  checar("sem rascunho, o caminho tenta criar um", nova.escritas > 0, true);
}

// ── 4. A lista de status descartaveis espelha o guarda do banco ──────────────
console.log(`\nstatus descartaveis na tela: ${STATUS_DESCARTAVEIS_NFE.join(", ")}`);
checar("a tela nao oferece descartar nota AUTORIZADA",
  (STATUS_DESCARTAVEIS_NFE as readonly string[]).includes("AUTORIZADA"), false);
checar("a tela nao oferece descartar nota CANCELADA",
  (STATUS_DESCARTAVEIS_NFE as readonly string[]).includes("CANCELADA"), false);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
