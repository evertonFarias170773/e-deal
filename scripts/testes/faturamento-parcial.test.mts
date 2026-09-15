/**
 * Faturamento parcial pela acao do Historico: o mesmo caminho da Fila.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/faturamento-parcial.test.mts
 *
 * As duas portas da tela (o botao Faturar da Fila e a acao nova no menu da nota)
 * chamam `abrirRascunhoDeVenda`, que e conferencia + `createOrReuseNfeDraft`.
 * Aqui a simulacao vai no que importa: `conferirFaturamento` (so leitura) e o
 * que `createOrReuseNfeDraft` GRAVARIA — com o fetch interceptado, registrando o
 * corpo e barrando a escrita.
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
    tentativas.push({ metodo, url: url.split("?")[0], corpo });
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
const { conferirFaturamento } = await import("../../src/features/fiscal/services/conferencia-faturamento.ts");
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

/** Roda o caminho comum e devolve o que ele tentou gravar. */
async function simular(idInt: number) {
  tentativas.length = 0;
  const conferencia = await conferirFaturamento(idInt);
  if (!conferencia.ok) return { conferencia, escritas: [] as Tentativa[], erro: null as string | null, reaproveitou: false };
  let erro: string | null = null;
  let reaproveitou = false;
  try {
    const draft = await createOrReuseNfeDraft(idInt);
    reaproveitou = Boolean(draft?.ref); // so acontece quando ja havia rascunho PENDENTE
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }
  return { conferencia, escritas: tentativas.filter((t) => t.url.includes("/rest/v1/")), erro, reaproveitou };
}

// ── 1. Pedido com venda autorizada e SEM rascunho aberto: cria a segunda nota ──
const { data: autorizadas } = await sb
  .from("notas_fiscais").select("id_int")
  .eq("status", "AUTORIZADA").eq("ambiente", "producao").not("numero_nf", "is", null)
  .is("tipo_nota", null);
const { data: rascunhos } = await sb
  .from("notas_fiscais").select("id_int")
  .in("status", ["PENDENTE", "RASCUNHO", "PRONTA_PARA_ENVIO", "ERRO_VALIDACAO", "ERRO_ENVIO"]);
const comRascunho = new Set((rascunhos ?? []).map((n) => Number((n as { id_int: number }).id_int)));
const candidatos = [...new Set((autorizadas ?? []).map((n) => Number((n as { id_int: number }).id_int)))]
  .filter((id) => !comRascunho.has(id))
  .sort((a, b) => b - a);
const PEDIDO = candidatos[0];
if (!PEDIDO) { console.log("(sem pedido com venda autorizada e sem rascunho aberto)"); process.exit(0); }
const { data: notasAntes } = await sb.from("notas_fiscais").select("ref, status, tipo_nota").eq("id_int", PEDIDO);
console.log(`\n#${PEDIDO} — notas de hoje: ${(notasAntes ?? []).map((n) => `${n.ref} (${n.status})`).join(", ")}`);

const parcial = await simular(PEDIDO);
console.log(`conferencia: ${parcial.conferencia.ok ? "passou" : "reprovou"} | bloqueios ${parcial.conferencia.bloqueios.length} | avisos ${parcial.conferencia.avisos.map((a) => a.codigo).join(",")}`);
const insertNota = parcial.escritas.find((t) => t.url.endsWith("/notas_fiscais"));
const cabecalho = (Array.isArray(insertNota?.corpo) ? insertNota?.corpo[0] : insertNota?.corpo) as Record<string, unknown> | undefined;
console.log("o que o caminho comum gravaria em notas_fiscais:");
console.log(JSON.stringify(cabecalho, null, 2));

checar("a conferencia avisa que o pedido ja tem nota (o aviso do parcial)",
  parcial.conferencia.avisos.some((a) => a.codigo === "JA_TEM_NOTA"), true);
checar("a conferencia NAO bloqueia por ja ter nota", parcial.conferencia.ok, true);
checar("nasce como VENDA: sem tipo_nota e sem endereco de destinatario",
  [cabecalho?.tipo_nota, cabecalho?.id_endereco_destinatario], [undefined, undefined]);
checar("mesma empresa e mesmo cliente do pedido",
  [Boolean(cabecalho?.id_empresa), Boolean(cabecalho?.id_cliente)], [true, true]);
checar("natureza de VENDA (5101 ou 6101), nunca a de remessa",
  /^(5101|6101) - /.test(String(cabecalho?.drop_natureza_op ?? "")), true);
checar("a ref segue a sequencia do pedido", String(cabecalho?.ref ?? "").startsWith(`NFE-${PEDIDO}-`), true);
checar("so a nota foi tentada; itens e parcela vem depois", parcial.escritas.length, 1);

// ── 2. A porta da Fila e a do Historico levam ao MESMO lugar ────────────────
const segundaVez = await simular(PEDIDO);
const cabecalho2 = (Array.isArray(segundaVez.escritas[0]?.corpo) ? segundaVez.escritas[0]?.corpo[0] : segundaVez.escritas[0]?.corpo) as Record<string, unknown> | undefined;
checar("o corpo gravado e identico nas duas chamadas (mesma funcao, mesmo resultado)",
  JSON.stringify(cabecalho), JSON.stringify(cabecalho2));

// ── 3. Pedido com rascunho PENDENTE: reaproveita, nao cria outra ────────────
const { data: comPendente } = await sb
  .from("notas_fiscais").select("id_int, ref").eq("status", "PENDENTE").is("tipo_nota", null).limit(1).maybeSingle();
if (comPendente) {
  const reuso = await simular(Number((comPendente as { id_int: number }).id_int));
  console.log(`\n#${(comPendente as { id_int: number }).id_int} ja tem rascunho ${(comPendente as { ref: string }).ref}: escritas tentadas ${reuso.escritas.length}`);
  if (reuso.conferencia.ok) {
    checar("com rascunho PENDENTE, nada e gravado (reaproveita)", reuso.escritas.length, 0);
  } else {
    console.log(`  (conferencia reprovou: ${reuso.conferencia.bloqueios.map((b) => b.codigo).join(",")}; o reuso nem chega a ser testado)`);
  }
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
