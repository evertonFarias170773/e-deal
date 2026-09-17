/**
 * O rascunho nasce SEM endereco de entrega — o checkbox nasce desmarcado.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/rascunho-nasce-sem-endereco-de-entrega.test.mts
 *
 * Simulado: o fetch e interceptado, a leitura passa e a ESCRITA e barrada com o
 * corpo registrado — da para ver o que a criacao GRAVARIA sem gravar. O teste
 * cobre os dois casos que importam: pedido COM endereco de entrega apontado
 * (que era o que ligava a marca) e pedido sem.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

type Tentativa = { metodo: string; url: string; corpo: unknown };
const tentativas: Tentativa[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const url = String(entrada instanceof Request ? entrada.url : entrada);
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
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE) {
  console.log("(pulando: .env.local sem chaves)");
  process.exit(0);
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;

const { createOrReuseNfeDraft } = await import("../../src/features/nfe/services/nfe.service.ts");
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

/** Simula a criacao e devolve o cabecalho que ela gravaria. */
async function cabecalhoQueNasceria(idInt: number) {
  tentativas.length = 0;
  try { await createOrReuseNfeDraft(idInt); } catch { /* barrado */ }
  const insert = tentativas.find((t) => t.metodo === "POST" && t.url.includes("/notas_fiscais"));
  const corpo = Array.isArray(insert?.corpo) ? insert?.corpo[0] : insert?.corpo;
  return (corpo ?? null) as Record<string, unknown> | null;
}

// Pedidos com e sem endereco de ENTREGA apontado, sem rascunho aberto.
const { data: pendentes } = await sb.from("notas_fiscais").select("id_int").eq("status", "PENDENTE");
const comRascunho = new Set((pendentes ?? []).map((n) => Number((n as { id_int: number }).id_int)));

const { data: propostas } = await sb
  .from("propostas").select("id_int, id_endereco_ent, libera_nf")
  .not("id_endereco_ent", "is", null).order("id_int", { ascending: false }).limit(400);

const idsEndereco = Array.from(new Set((propostas ?? []).map((p) => String((p as { id_endereco_ent: string }).id_endereco_ent))));
const { data: enderecos } = await sb.from("enderecos").select("id, tipo_endereco").in("id", idsEndereco.slice(0, 300));
const tipoPorEndereco = new Map((enderecos ?? []).map((e) => [String((e as { id: string }).id), String((e as { tipo_endereco: string }).tipo_endereco ?? "").toLowerCase()]));

const comEntrega = (propostas ?? []).find((p) => {
  const linha = p as { id_int: number; id_endereco_ent: string };
  return !comRascunho.has(Number(linha.id_int)) && tipoPorEndereco.get(String(linha.id_endereco_ent)) === "entrega";
}) as { id_int: number } | undefined;

const semEntrega = (propostas ?? []).find((p) => {
  const linha = p as { id_int: number; id_endereco_ent: string };
  const tipo = tipoPorEndereco.get(String(linha.id_endereco_ent));
  return !comRascunho.has(Number(linha.id_int)) && tipo && tipo !== "entrega";
}) as { id_int: number } | undefined;

console.log(`pedido COM endereco de entrega: ${comEntrega?.id_int ?? "(nenhum)"} | pedido sem: ${semEntrega?.id_int ?? "(nenhum)"}`);

for (const [rotulo, pedido] of [["COM endereco de entrega", comEntrega], ["sem endereco de entrega", semEntrega]] as const) {
  if (!pedido) { console.log(`(sem pedido ${rotulo} disponivel)`); continue; }
  const cabecalho = await cabecalhoQueNasceria(Number(pedido.id_int));
  console.log(`\n#${pedido.id_int} (${rotulo}) nasceria com:`);
  console.log(`  end_entrega: ${JSON.stringify(cabecalho?.end_entrega)} | endereco_entrega_observacao: ${JSON.stringify(cabecalho?.endereco_entrega_observacao)}`);
  checar(`#${pedido.id_int}: nasce com end_entrega falso`, cabecalho?.end_entrega, false);
  checar(`#${pedido.id_int}: nasce sem endereco de entrega gravado`, cabecalho?.endereco_entrega_observacao, null);
  checar(`#${pedido.id_int}: o resto do cabecalho continua vindo (empresa e cliente)`,
    [Boolean(cabecalho?.id_empresa), Boolean(cabecalho?.id_cliente)], [true, true]);
  checar(`#${pedido.id_int}: a natureza continua saindo pela UF do destino`,
    /^(5101|6101) - /.test(String(cabecalho?.drop_natureza_op ?? "")), true);
}

// A remessa tem endereco proprio, por outro campo, e nao e tocada.
const { data: remessas } = await sb.from("notas_fiscais").select("ref").eq("tipo_nota", "REMESSA");
console.log(`\nnotas de REMESSA no banco: ${(remessas ?? []).length}`);

checar("nenhuma escrita chegou ao banco",
  tentativas.every((t) => t.metodo === "POST" && t.url.includes("/notas_fiscais")), true);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
