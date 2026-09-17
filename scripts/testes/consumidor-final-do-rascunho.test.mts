/**
 * `consumidor_final` do rascunho segue o TIPO DE CONTRIBUINTE, nao o documento.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/consumidor-final-do-rascunho.test.mts
 *
 * Os cinco perfis de cadastro, nos DOIS caminhos que criam rascunho:
 * `createOrReuseNfeDraft` (nota do pedido) e `criarRascunhoNfeAvulsa`.
 *
 * Nada e gravado: o fetch e interceptado, a leitura passa e a ESCRITA e barrada
 * com o corpo registrado. A UNICA excecao e `fn_proximo_id_int_nfe_avulsa`, que
 * consome um numero de sequencia — ela e respondida por um dublê, para o teste
 * chegar ao corpo do insert sem queimar numeracao real.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

type Tentativa = { metodo: string; url: string; corpo: unknown };
const tentativas: Tentativa[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const url = String(entrada instanceof Request ? entrada.url : entrada);

  if (url.includes("/rest/v1/rpc/fn_proximo_id_int_nfe_avulsa")) {
    // NEGATIVO de proposito: a numeracao da avulsa e descendente com teto -1, e
    // a propria funcao recusa positivo. Um dublê positivo nao passaria da trava.
    return new Response("-999999", { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) {
    let corpo: unknown = init?.body ?? null;
    try { corpo = JSON.parse(String(init?.body ?? "null")); } catch { /* corpo cru */ }
    tentativas.push({ metodo, url, corpo });
    throw new Error("escrita barrada no teste");
  }
  return fetchOriginal(entrada, init);
}) as typeof fetch;

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `  (esperava ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)})`}`);
}

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE) {
  console.log("(pulando: .env.local sem chaves)");
  process.exit(0);
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;

const { createOrReuseNfeDraft, criarRascunhoNfeAvulsa } = await import("../../src/features/nfe/services/nfe.service.ts");
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

/** Os cinco perfis, com um cliente e um pedido reais de cada. */
const CASOS = [
  { caso: "CNPJ tipo 9", tipoEsperado: 9, cfEsperado: 1, cfDeHoje: 0 },
  { caso: "CNPJ tipo 1", tipoEsperado: 1, cfEsperado: 0, cfDeHoje: 0 },
  { caso: "CNPJ sem tipo", tipoEsperado: 1, cfEsperado: 0, cfDeHoje: 0 },
  { caso: "CPF tipo 2", tipoEsperado: 2, cfEsperado: 1, cfDeHoje: 1 },
  { caso: "CPF sem tipo", tipoEsperado: 9, cfEsperado: 1, cfDeHoje: 1 }
] as const;

const perfilDoCliente = (documento: string | null, tipo: string | null) => {
  const digitos = String(documento ?? "").replace(/\D/g, "").length;
  const t = String(tipo ?? "").trim().toUpperCase();
  if (digitos > 11 && t === "9") return "CNPJ tipo 9";
  if (digitos > 11 && t === "1") return "CNPJ tipo 1";
  if (digitos > 11 && t === "") return "CNPJ sem tipo";
  if (digitos === 11 && t === "2") return "CPF tipo 2";
  if (digitos === 11 && t === "") return "CPF sem tipo";
  return null;
};

// Clientes e pedidos de cada perfil, escolhidos do banco na hora.
//
// Dirigido, e nao "traz tudo e filtra aqui": sao 66 mil cadastros e o PostgREST
// devolve so a primeira pagina — a primeira versao deste teste nao achou perfil
// nenhum por isso, e passou verde sem ter testado nada.
const clientePorCaso = new Map<string, number>();
const tipoPorCliente = new Map<number, string>();

const registrar = (linhas: Array<Record<string, unknown>> | null) => {
  for (const linha of linhas ?? []) {
    const p = perfilDoCliente(linha.documento as string, linha.tipo_contribuinte as string);
    if (!p) continue;
    tipoPorCliente.set(Number(linha.id_cliente), p);
    if (!clientePorCaso.has(p)) clientePorCaso.set(p, Number(linha.id_cliente));
  }
};

for (const tipo of ["9", "1", "2"]) {
  const { data } = await sb
    .from("clientes").select("id_cliente,documento,tipo_contribuinte")
    .eq("tipo_contribuinte", tipo).limit(1000);
  registrar(data as Array<Record<string, unknown>> | null);
}
const { data: semTipo } = await sb
  .from("clientes").select("id_cliente,documento,tipo_contribuinte")
  .is("tipo_contribuinte", null).limit(1000);
registrar(semTipo as Array<Record<string, unknown>> | null);

const { data: pendentes } = await sb.from("notas_fiscais").select("id_int").eq("status", "PENDENTE");
const comRascunho = new Set((pendentes ?? []).map((n) => Number((n as { id_int: number }).id_int)));
const { data: propostasRows } = await sb
  .from("propostas").select("id_int,id_cliente,id_faturado,id_endereco_ent")
  .not("id_endereco_ent", "is", null).order("id_int", { ascending: false }).limit(1000);

// Os pagadores desses pedidos, buscados pelo id — de novo dirigido.
const pagadores = Array.from(new Set(
  ((propostasRows ?? []) as Array<Record<string, unknown>>)
    .map((l) => Number(l.id_faturado ?? 0) || Number(l.id_cliente ?? 0))
    .filter((id) => Number.isFinite(id) && id > 0)
));
for (let i = 0; i < pagadores.length; i += 300) {
  const { data } = await sb
    .from("clientes").select("id_cliente,documento,tipo_contribuinte")
    .in("id_cliente", pagadores.slice(i, i + 300));
  registrar(data as Array<Record<string, unknown>> | null);
}

const pedidoPorCaso = new Map<string, number>();
for (const linha of (propostasRows ?? []) as Array<Record<string, unknown>>) {
  const idInt = Number(linha.id_int);
  if (comRascunho.has(idInt)) continue;
  const pagador = Number(linha.id_faturado ?? 0) || Number(linha.id_cliente ?? 0);
  const p = tipoPorCliente.get(pagador);
  if (p && !pedidoPorCaso.has(p)) pedidoPorCaso.set(p, idInt);
}
console.log(`perfis com cliente: ${[...clientePorCaso.keys()].join(" | ")}`);
console.log(`perfis com pedido:  ${[...pedidoPorCaso.keys()].join(" | ")}`);

/** Roda um caminho e devolve o que ele GRAVARIA no cabecalho da nota. */
async function corpoDoInsert(executar: () => Promise<unknown>) {
  tentativas.length = 0;
  try { await executar(); } catch { /* barrado */ }
  const insert = tentativas.find((t) => t.metodo === "POST" && t.url.includes("/notas_fiscais"));
  const corpo = Array.isArray(insert?.corpo) ? insert?.corpo[0] : insert?.corpo;
  return (corpo ?? null) as Record<string, unknown> | null;
}

for (const c of CASOS) {
  console.log(`\n===== ${c.caso} =====`);

  // ── Caminho 1: a nota do pedido ───────────────────────────────────────────
  const pedido = pedidoPorCaso.get(c.caso);
  if (pedido) {
    const corpo = await corpoDoInsert(() => createOrReuseNfeDraft(pedido));
    const tipo = Number(corpo?.tipo_contribuinte);
    const cf = Number(corpo?.consumidor_final);
    console.log(`  pedido #${pedido}: tipo_contribuinte ${tipo} | consumidor_final ${cf} (hoje era ${c.cfDeHoje})`);
    checar(`${c.caso} / pedido: tipo ${c.tipoEsperado} + consumidor final ${c.cfEsperado}`,
      [tipo, cf], [c.tipoEsperado, c.cfEsperado]);
  } else {
    console.log("  (sem pedido deste perfil disponivel)");
  }

  // ── Caminho 2: a nota avulsa ──────────────────────────────────────────────
  const idCliente = clientePorCaso.get(c.caso);
  if (idCliente) {
    const corpo = await corpoDoInsert(() => criarRascunhoNfeAvulsa({ idCliente, idEmpresa: 1 }));
    const tipo = Number(corpo?.tipo_contribuinte);
    const cf = Number(corpo?.consumidor_final);
    console.log(`  avulsa p/ cliente ${idCliente}: tipo_contribuinte ${tipo} | consumidor_final ${cf}`);
    checar(`${c.caso} / avulsa: tipo ${c.tipoEsperado} + consumidor final ${c.cfEsperado}`,
      [tipo, cf], [c.tipoEsperado, c.cfEsperado]);
  } else {
    console.log("  (sem cliente deste perfil)");
  }
}

// ── So o CNPJ tipo 9 mudou ────────────────────────────────────────────────────
console.log("\n===== o que mudou =====");
for (const c of CASOS) {
  const mudou = c.cfEsperado !== c.cfDeHoje;
  console.log(`  ${c.caso.padEnd(14)} consumidor_final ${c.cfDeHoje} -> ${c.cfEsperado}  ${mudou ? "MUDOU" : "igual"}`);
}
checar("so o CNPJ tipo 9 muda de comportamento",
  CASOS.filter((c) => c.cfEsperado !== c.cfDeHoje).map((c) => c.caso), ["CNPJ tipo 9"]);

// ── Nenhuma escrita sobrou ────────────────────────────────────────────────────
const escritas = tentativas.filter((t) => t.metodo !== "GET");
checar("toda escrita foi barrada (nenhuma chegou ao banco)",
  escritas.every((t) => t.url.includes("/rest/v1/")), true);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
