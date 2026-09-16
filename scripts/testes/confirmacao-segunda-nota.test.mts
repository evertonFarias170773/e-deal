/**
 * O texto que o operador le antes de o pedido ganhar uma segunda nota.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/confirmacao-segunda-nota.test.mts
 *
 * A montagem do texto e funcao pura: aqui ela roda com as notas REAIS do banco,
 * lidas so com SELECT, e o texto sai impresso do jeito que aparece na tela. O
 * fetch e interceptado: qualquer escrita seria registrada e barrada.
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

const { textoDeConfirmacaoDeSegundaNota, partesDaConfirmacaoDeSegundaNota } = await import("../../src/features/fiscal/lib/confirmacao-segunda-nota.ts");
const { COLUNAS_NOTA_DO_PEDIDO } = await import("../../src/lib/fiscal/nota-do-pedido.ts");
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

const notasDoPedido = async (idInt: number) => {
  const { data } = await sb.from("notas_fiscais").select(`ref, ${COLUNAS_NOTA_DO_PEDIDO}`).eq("id_int", idInt);
  return (data ?? []) as never[];
};

// Um pedido com UMA autorizada de producao, e outro com MAIS DE UMA.
const { data: todas } = await sb
  .from("notas_fiscais")
  .select("id_int, ref, status, ambiente, numero_nf, tipo_nota")
  .eq("status", "AUTORIZADA")
  .eq("ambiente", "producao");

const porPedido = new Map<number, number>();
for (const nota of (todas ?? []) as Array<{ id_int: number }>) {
  const id = Number(nota.id_int);
  porPedido.set(id, (porPedido.get(id) ?? 0) + 1);
}
const comUma = [...porPedido.entries()].filter(([, n]) => n === 1).map(([id]) => id).sort((a, b) => b - a)[0];
const comVarias = [...porPedido.entries()].filter(([, n]) => n > 1).map(([id]) => id).sort((a, b) => b - a)[0];

console.log(`pedidos com autorizada de producao: ${porPedido.size} | com mais de uma: ${[...porPedido.values()].filter((n) => n > 1).length}`);

// ── 1. Uma nota so: os dois textos ──────────────────────────────────────────
const umaNota = await notasDoPedido(comUma);
const textoVenda = textoDeConfirmacaoDeSegundaNota({ idInt: comUma, tipo: "VENDA", notas: umaNota });
const textoRemessa = textoDeConfirmacaoDeSegundaNota({ idInt: comUma, tipo: "REMESSA", notas: umaNota });

console.log(`\n=== outra nota de venda (#${comUma}) ===\n${textoVenda}`);
console.log(`\n=== nota de remessa (#${comUma}) ===\n${textoRemessa}`);

checar("o texto da venda diz que sao DUAS notas de venda", textoVenda.includes("SEGUNDA nota de VENDA"), true);
checar("o texto da remessa diz de quem e a nota", textoRemessa.includes("nome de quem RECEBE"), true);
checar("os dois citam a ref da nota que ja existe",
  [textoVenda, textoRemessa].every((t) => t.includes(String((umaNota[0] as { ref: string }).ref))), true);
checar("os dois citam o numero da NF",
  [textoVenda, textoRemessa].every((t) => /NF \d+/.test(t)), true);
checar("os dois avisam que nada e transmitido agora",
  [textoVenda, textoRemessa].every((t) => t.includes("Nada é transmitido agora")), true);
checar("com uma nota so, a seta de origem nao aparece",
  [textoVenda, textoRemessa].some((t) => t.includes("> NF") || t.includes("(>)")), false);

// O modal mostra o mesmo texto, so partido em titulo e corpo: remontando as
// duas partes tem de sair exatamente o que o texto unico dizia.
const partesVenda = partesDaConfirmacaoDeSegundaNota({ idInt: comUma, tipo: "VENDA", notas: umaNota });
const partesRemessa = partesDaConfirmacaoDeSegundaNota({ idInt: comUma, tipo: "REMESSA", notas: umaNota });
console.log(`\n=== como o modal recebe (#${comUma}, venda) ===`);
console.log(`titulo: ${JSON.stringify(partesVenda.titulo)}`);
console.log(`corpo:\n${partesVenda.corpo}`);
checar("titulo + corpo remontam o texto da venda, sem perder um caractere",
  `${partesVenda.titulo}\n\n${partesVenda.corpo}`, textoVenda);
checar("titulo + corpo remontam o texto da remessa",
  `${partesRemessa.titulo}\n\n${partesRemessa.corpo}`, textoRemessa);
checar("o titulo e a pergunta, e termina em interrogacao", partesVenda.titulo.endsWith("?"), true);
checar("o corpo guarda a lista e o aviso",
  [partesVenda.corpo.includes("já tem uma nota autorizada:"), partesVenda.corpo.includes("Nada é transmitido agora")],
  [true, true]);

// ── 2. Mais de uma autorizada: cita todas ───────────────────────────────────
if (comVarias) {
  const varias = await notasDoPedido(comVarias);
  const textoVarias = textoDeConfirmacaoDeSegundaNota({ idInt: comVarias, tipo: "REMESSA", notas: varias });
  console.log(`\n=== com mais de uma autorizada (#${comVarias}) ===\n${textoVarias}`);
  const autorizadas = (varias as Array<{ status: string; ambiente: string; ref: string }>).filter(
    (n) => n.status === "AUTORIZADA" && n.ambiente === "producao"
  );
  checar(`cita as ${autorizadas.length} autorizadas`, autorizadas.every((n) => textoVarias.includes(n.ref)), true);
  checar("aponta qual delas e a origem da remessa", textoVarias.includes("(>) A remessa nasce desta nota de venda."), true);
} else {
  console.log("\n(nenhum pedido com mais de uma autorizada de producao hoje: simulando com uma lista montada)");
  const simulada = [
    { ref: "NFE-99999-001", status: "AUTORIZADA", ambiente: "producao", numero_nf: 7501, tipo_nota: null, data_autorizacao: "2026-09-15T12:00:00Z", created_at: "2026-09-15T11:00:00Z" },
    { ref: "NFE-99999-002", status: "AUTORIZADA", ambiente: "producao", numero_nf: 7502, tipo_nota: null, data_autorizacao: "2026-09-15T18:00:00Z", created_at: "2026-09-15T17:00:00Z" },
    { ref: "NFE-99999-003", status: "AUTORIZADA", ambiente: "producao", numero_nf: 7503, tipo_nota: "REMESSA", data_autorizacao: "2026-09-16T09:00:00Z", created_at: "2026-09-16T08:00:00Z" }
  ];
  const textoVarias = textoDeConfirmacaoDeSegundaNota({ idInt: 99999, tipo: "REMESSA", notas: simulada });
  console.log(`\n=== com mais de uma autorizada (exemplo montado) ===\n${textoVarias}`);
  checar("cita as tres", ["NFE-99999-001", "NFE-99999-002", "NFE-99999-003"].every((r) => textoVarias.includes(r)), true);
  checar("a origem e a venda mais recente, nao a remessa", textoVarias.includes("> NF 7502"), true);
  checar("a remessa aparece marcada como remessa", textoVarias.includes("NF 7503 - NFE-99999-003 (remessa)"), true);
  checar("a legenda da seta aparece", textoVarias.includes("(>) A remessa nasce desta nota de venda."), true);
}

// ── 3. Homologacao nao entra na contagem ────────────────────────────────────
const comHomologacao = [
  { ref: "NFE-88888-001", status: "AUTORIZADA", ambiente: "homologacao", numero_nf: 9001, tipo_nota: null, data_autorizacao: "2026-09-10T12:00:00Z", created_at: "2026-09-10T11:00:00Z" },
  { ref: "NFE-88888-002", status: "AUTORIZADA", ambiente: "producao", numero_nf: 9002, tipo_nota: null, data_autorizacao: "2026-09-11T12:00:00Z", created_at: "2026-09-11T11:00:00Z" }
];
const textoHomologacao = textoDeConfirmacaoDeSegundaNota({ idInt: 88888, tipo: "VENDA", notas: comHomologacao });
checar("nota de homologacao nao e citada", textoHomologacao.includes("NFE-88888-001"), false);
checar("a de producao e citada", textoHomologacao.includes("NFE-88888-002"), true);
checar("com uma so, o titulo e no singular", textoHomologacao.includes("já tem uma nota autorizada:"), true);

// ── 4. Nada foi gravado ─────────────────────────────────────────────────────
checar("nenhuma escrita tentada em todo o teste", tentativas.length, 0);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
