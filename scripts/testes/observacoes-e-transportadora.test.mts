/**
 * Numero do pedido nas observacoes e transportadora reabastecida no envio.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/observacoes-e-transportadora.test.mts
 *
 * Tudo simulado: o fetch e interceptado, a leitura passa, a ESCRITA e barrada e
 * o corpo fica registrado — da para ver o que seria gravado sem gravar. No fim,
 * o payload de todas as notas e comparado com o hash do inicio.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

type Tentativa = { metodo: string; url: string; corpo: unknown };
const tentativas: Tentativa[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const url = String(entrada instanceof Request ? entrada.url : entrada);
  // A RPC do payload e LEITURA (so faz select), mas viaja como POST: liberada.
  const ehLeituraDoPayload = url.includes("/rest/v1/rpc/fn_montar_payload_nfe");
  if (!["GET", "HEAD", "OPTIONS"].includes(metodo) && !ehLeituraDoPayload) {
    let corpo: unknown = init?.body ?? null;
    try { corpo = JSON.parse(String(init?.body ?? "null")); } catch { /* corpo cru */ }
    tentativas.push({ metodo, url: url.split("?")[0] + (url.includes("?") ? "?" + url.split("?")[1] : ""), corpo });
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

const { createOrReuseNfeDraft, preencherTransportadoraPelaExpedicao } = await import("../../src/features/nfe/services/nfe.service.ts");
const { criarRascunhoRemessa } = await import("../../src/features/nfe/services/remessa.service.ts");
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

const hashDosPayloads = async () => {
  const { data } = await sb.from("notas_fiscais").select("ref").order("ref");
  const refs = (data ?? []).map((n) => (n as { ref: string }).ref);
  const partes: string[] = [];
  for (const ref of refs) {
    const { data: p } = await sb.rpc("fn_montar_payload_nfe", { p_ref: ref });
    const payload = { ...(p as Record<string, unknown>) };
    delete payload.data_emissao;
    delete payload.data_entrada_saida;
    partes.push(`${ref}:${JSON.stringify(payload)}`);
  }
  const { createHash } = await import("node:crypto");
  return { notas: refs.length, hash: createHash("md5").update(partes.join(",")).digest("hex") };
};

const antes = await hashDosPayloads();
console.log(`payload das notas ANTES: ${antes.notas} notas, hash ${antes.hash}`);

// ── 1. Rascunho de VENDA: o numero do pedido nas observacoes ────────────────
const { data: autorizadas } = await sb.from("notas_fiscais").select("id_int")
  .eq("status", "AUTORIZADA").eq("ambiente", "producao").not("numero_nf", "is", null).is("tipo_nota", null);
const { data: rascunhos } = await sb.from("notas_fiscais").select("id_int")
  .in("status", ["PENDENTE", "RASCUNHO", "PRONTA_PARA_ENVIO", "ERRO_VALIDACAO", "ERRO_ENVIO"]);
const comRascunho = new Set((rascunhos ?? []).map((n) => Number((n as { id_int: number }).id_int)));
const PEDIDO = [...new Set((autorizadas ?? []).map((n) => Number((n as { id_int: number }).id_int)))]
  .filter((id) => !comRascunho.has(id)).sort((a, b) => b - a)[0];

tentativas.length = 0;
try { await createOrReuseNfeDraft(PEDIDO); } catch { /* barrado */ }
const insertVenda = tentativas.find((t) => t.url.includes("/notas_fiscais"));
const corpoVenda = (Array.isArray(insertVenda?.corpo) ? insertVenda?.corpo[0] : insertVenda?.corpo) as Record<string, unknown>;
console.log(`\n#${PEDIDO} (venda) — informacoes_complementares: ${JSON.stringify(corpoVenda?.informacoes_complementares)}`);
checar("rascunho de venda grava o numero do pedido", corpoVenda?.informacoes_complementares, `Pedido ${PEDIDO}`);

// ── 2. Rascunho de REMESSA: mesmo texto ─────────────────────────────────────
tentativas.length = 0;
await criarRascunhoRemessa(21955);
const insertRemessa = tentativas.find((t) => t.url.includes("/notas_fiscais"));
const corpoRemessa = (Array.isArray(insertRemessa?.corpo) ? insertRemessa?.corpo[0] : insertRemessa?.corpo) as Record<string, unknown>;
console.log(`#21955 (remessa) — informacoes_complementares: ${JSON.stringify(corpoRemessa?.informacoes_complementares)}`);
checar("rascunho de remessa grava o numero do pedido", corpoRemessa?.informacoes_complementares, "Pedido 21955");

// Como o texto fica no payload, junto com o endereco de entrega que 13 notas tem.
const { data: comEndereco } = await sb.from("notas_fiscais")
  .select("ref, endereco_entrega_observacao").not("endereco_entrega_observacao", "is", null).limit(1).single();
const { data: payloadAtual } = await sb.rpc("fn_montar_payload_nfe", { p_ref: (comEndereco as { ref: string }).ref });
const infoHoje = String((payloadAtual as Record<string, string>).informacoes_adicionais_contribuinte ?? "");
console.log(`\ncomo o payload monta hoje (${(comEndereco as { ref: string }).ref}): ${JSON.stringify(infoHoje)}`);
console.log(`como ficaria com o numero do pedido: ${JSON.stringify(`Pedido ${(comEndereco as { ref: string }).ref.split("-")[1]} | ${infoHoje}`)}`);
checar("o endereco de entrega continua no texto", infoHoje.length > 0, true);

// ── 3. Preparo do envio: transportadora vinda da expedicao ──────────────────
const { data: candidatas } = await sb
  .from("notas_fiscais")
  .select("id, ref, id_int, transportadora, id_transportadora_cliente, status")
  .in("status", ["PENDENTE", "PRONTA_PARA_ENVIO", "ERRO_VALIDACAO", "ERRO_ENVIO"]);

for (const nota of (candidatas ?? []) as Array<Record<string, unknown>>) {
  const semTransportadora = String(nota.transportadora ?? "").trim() === "" && nota.id_transportadora_cliente == null;
  if (!semTransportadora) continue;
  const { data: exp } = await sb.from("expedicoes").select("transportadora_nome, id_transportadora_cliente").eq("id_int", nota.id_int).maybeSingle();
  if (!exp || String((exp as { transportadora_nome?: string }).transportadora_nome ?? "").trim() === "") continue;

  tentativas.length = 0;
  const res = await preencherTransportadoraPelaExpedicao({
    id: String(nota.id), idInt: Number(nota.id_int),
    transportadoraAtual: nota.transportadora as string | null,
    idTransportadoraAtual: nota.id_transportadora_cliente as number | null
  });
  const patch = tentativas.find((t) => t.metodo === "PATCH");
  console.log(`\n${nota.ref} (${nota.status}) — expedicao diz "${(exp as { transportadora_nome?: string }).transportadora_nome}"`);
  console.log(`  gravaria: ${JSON.stringify(patch?.corpo)} em ${patch?.url.split("/rest/v1/")[1]}`);
  checar(`${nota.ref}: um PATCH so, na propria nota`, tentativas.filter((t) => t.metodo !== "GET").length, 1);
  checar(`${nota.ref}: o PATCH exige id_transportadora_cliente nulo (nunca sobrescreve)`,
    String(patch?.url ?? "").includes("id_transportadora_cliente=is.null"), true);
  void res;
  break;
}

// ── 4. Nota que JA tem transportadora: nao encosta ──────────────────────────
const jaTem = ((candidatas ?? []) as Array<Record<string, unknown>>).find(
  (n) => String(n.transportadora ?? "").trim() !== "" || n.id_transportadora_cliente != null
);
if (jaTem) {
  tentativas.length = 0;
  const res = await preencherTransportadoraPelaExpedicao({
    id: String(jaTem.id), idInt: Number(jaTem.id_int),
    transportadoraAtual: jaTem.transportadora as string | null,
    idTransportadoraAtual: jaTem.id_transportadora_cliente as number | null
  });
  console.log(`\n${jaTem.ref} ja tem transportadora ("${jaTem.transportadora}"): ${JSON.stringify(res)}`);
  checar(`${jaTem.ref}: nao preenche`, res.preencheu, false);
  checar(`${jaTem.ref}: nenhuma escrita tentada`, tentativas.length, 0);
}

// ── 5. O payload das notas existentes continua identico ─────────────────────
const depois = await hashDosPayloads();
console.log(`\npayload das notas DEPOIS: ${depois.notas} notas, hash ${depois.hash}`);
checar("hash do payload de todas as notas: identico", depois, antes);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
