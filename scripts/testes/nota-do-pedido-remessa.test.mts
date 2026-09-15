/**
 * A nota de REMESSA nao e a nota do pedido.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/nota-do-pedido-remessa.test.mts
 *
 * Parte 1 prova a regra com a funcao REAL (`escolherNotaAutorizadaDoPedido`).
 * Parte 2 pega as notas REAIS de um pedido que tem venda autorizada, acrescenta
 * uma REMESSA sintetica — mais recente, que sem a exclusao venceria — e confere
 * que a escolha continua na venda. Tambem confere que `tipo_nota` chega ao modelo
 * de leitura da tela fiscal e a contagem da Fila de Faturamento.
 *
 * SO LEITURA: todo fetch que nao seja GET e barrado.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

const escritas: string[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const url = String(entrada instanceof Request ? entrada.url : entrada);
  if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) {
    escritas.push(`${metodo} ${url.split("?")[0]}`);
    throw new Error(`escrita barrada no teste: ${metodo} ${url.split("?")[0]}`);
  }
  return fetchOriginal(entrada, init);
}) as typeof fetch;

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

const { escolherNotaAutorizadaDoPedido, COLUNAS_NOTA_DO_PEDIDO } = await import("../../src/lib/fiscal/nota-do-pedido.ts");

const venda = (ref: string, quando: string, tipo?: string | null) => ({
  ref, status: "AUTORIZADA", numero_nf: "1", ambiente: "producao",
  data_autorizacao: quando, created_at: quando, tipo_nota: tipo ?? null
});

// ── 1. A regra ──────────────────────────────────────────────────────────────
checar("COLUNAS_NOTA_DO_PEDIDO traz tipo_nota", COLUNAS_NOTA_DO_PEDIDO.includes("tipo_nota"), true);
checar("remessa MAIS RECENTE nao vence a venda",
  escolherNotaAutorizadaDoPedido([venda("venda", "2026-09-15T10:00:00Z"), { ...venda("remessa", "2026-09-15T11:00:00Z", "REMESSA") }])?.ref,
  "venda");
checar("so remessa: pedido fica sem nota", escolherNotaAutorizadaDoPedido([venda("remessa", "2026-09-15T11:00:00Z", "REMESSA")]), null);
checar("tipo_nota nulo continua contando", escolherNotaAutorizadaDoPedido([venda("antiga", "2026-09-01T10:00:00Z")])?.ref, "antiga");
checar("tipo_nota VENDA continua contando", escolherNotaAutorizadaDoPedido([venda("nova", "2026-09-01T10:00:00Z", "VENDA")])?.ref, "nova");
checar("grafia/caixa nao fura: 'remessa' e ' Remessa ' tambem saem",
  [escolherNotaAutorizadaDoPedido([venda("a", "2026-09-01T10:00:00Z", "remessa")]),
   escolherNotaAutorizadaDoPedido([venda("b", "2026-09-01T10:00:00Z", " Remessa ")])],
  [null, null]);
checar("faturamento parcial intacto: duas vendas, vence a mais recente",
  escolherNotaAutorizadaDoPedido([venda("v1", "2026-09-10T10:00:00Z"), venda("v2", "2026-09-12T10:00:00Z")])?.ref, "v2");

// ── 2. Contra o banco, sem gravar ───────────────────────────────────────────
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE) {
  console.log("\n(pulando a parte do banco: .env.local sem chaves)");
} else {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

  // Pedido real com venda autorizada em producao.
  const { data: candidata } = await sb
    .from("notas_fiscais")
    .select("id_int, ref, data_autorizacao")
    .eq("status", "AUTORIZADA").eq("ambiente", "producao").not("numero_nf", "is", null)
    .order("data_autorizacao", { ascending: false }).limit(1).single();
  const idInt = Number((candidata as { id_int: number }).id_int);

  const { data: reais } = await sb.from("notas_fiscais").select(`ref, ${COLUNAS_NOTA_DO_PEDIDO}`).eq("id_int", idInt);
  const notas = (reais ?? []) as Array<Record<string, unknown>>;
  const escolhidaHoje = escolherNotaAutorizadaDoPedido(notas as never);
  console.log(`\npedido #${idInt}: ${notas.length} nota(s); escolhida hoje: ${(escolhidaHoje as { ref?: string } | null)?.ref ?? "(nenhuma)"}`);
  checar(`#${idInt}: todas as notas reais vem com tipo_nota nulo`, notas.every((n) => n.tipo_nota === null), true);
  checar(`#${idInt}: hoje o pedido tem nota escolhida`, Boolean(escolhidaHoje), true);

  // A remessa sintetica: mesma nota escolhida, so que marcada e autorizada DEPOIS.
  const remessa = {
    ...(escolhidaHoje as Record<string, unknown>),
    ref: "NFE-SINTETICA-REMESSA",
    tipo_nota: "REMESSA",
    data_autorizacao: new Date(Date.now() + 86_400_000).toISOString()
  };
  const comRemessa = escolherNotaAutorizadaDoPedido([...notas, remessa] as never);
  checar(`#${idInt}: com a remessa no meio, a escolha continua a venda`,
    (comRemessa as { ref?: string } | null)?.ref, (escolhidaHoje as { ref?: string } | null)?.ref);
  checar("sem a exclusao, a remessa venceria (prova do controle)",
    [...notas, remessa].filter((n) => String(n.status).toUpperCase() === "AUTORIZADA" && String(n.ambiente) === "producao")
      .sort((a, b) => Date.parse(String(b.data_autorizacao)) - Date.parse(String(a.data_autorizacao)))[0]?.ref,
    "NFE-SINTETICA-REMESSA");

  // `tipo_nota` chega ao modelo de leitura da tela fiscal.
  const { getNfeReadOnlyList } = await import("../../src/features/nfe/services/nfe.service.ts");
  const lista = await getNfeReadOnlyList();
  const daBase = lista.nfeList.filter((n) => !n.isMock);
  checar("a tela fiscal recebe tipo_nota em todas as linhas", daBase.every((n) => "tipo_nota" in n), true);
  checar("e hoje todas vem nulas (nenhuma remessa existe)", daBase.every((n) => (n.tipo_nota ?? null) === null), true);

  // Fila de Faturamento: a contagem de hoje nao pode mudar, ja que nao ha remessa.
  const { getFaturaveisPropostas } = await import("../../src/features/nfe/services/nfe.service.ts");
  const fila = await getFaturaveisPropostas();
  const { data: notasTodas } = await sb.from("notas_fiscais").select("id_int,status,tipo_nota");
  const SEM_EFEITO = ["CANCELADA", "DENEGADA", "PENDENTE", "RASCUNHO"];
  const vivasPelaRegraAntiga = new Map<number, number>();
  for (const n of (notasTodas ?? []) as Array<{ id_int: number; status: string | null }>) {
    if (SEM_EFEITO.includes(String(n.status ?? "").toUpperCase())) continue;
    vivasPelaRegraAntiga.set(Number(n.id_int), (vivasPelaRegraAntiga.get(Number(n.id_int)) ?? 0) + 1);
  }
  const divergentes = fila.filter((f) => (f.notas_vivas ?? 0) !== (vivasPelaRegraAntiga.get(Number(f.id_int)) ?? 0));
  console.log(`\nfila: ${fila.length} pedido(s); soma de notas vivas ${fila.reduce((s, f) => s + (f.notas_vivas ?? 0), 0)}`);
  checar("nenhum pedido da fila muda de contagem hoje", divergentes.map((d) => d.id_int), []);
}

checar("nenhuma escrita tentada", escritas, []);
console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
