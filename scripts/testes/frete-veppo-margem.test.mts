/**
 * VEPPO +20% sobre o valor do n8n (03/11/2026).
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs scripts/testes/frete-veppo-margem.test.mts
 *
 * SEM banco e SEM rede: cliente Supabase falso e fetch falso no lugar do n8n.
 *   A. a conta: 42,45 -> 50,94; 73,18 -> 87,82; 90,06 -> 108,07;
 *   B. a função de servidor (todo chamador passa por ela): valor final e original no card;
 *      zero, negativo, texto ou ausente não geram card;
 *   C. nunca duas vezes: a conta mora só em frete-veppo.server; a tela, o Maestro,
 *      a recotação e o complementar repassam o valor sem multiplicar de novo;
 *   D. o card da tela mostra "Original: R$ ... (+20%)".
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
const FALSO_JS = pathToFileURL(path.join(AQUI, "_supabase-js-falso-com-tipos.mts")).href;
const FALSO_CLIENTE = pathToFileURL(path.join(AQUI, "_supabase-falso.mts")).href;
const SESSAO_FALSA = "data:text/javascript," + encodeURIComponent(`
  export class SessaoExpiradaError extends Error {}
  export async function obterAccessToken() { return "token"; }
  export async function fetchComSessao(url, init) { return globalThis.__fetchDaTela(url, init); }
`);
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: FALSO_JS, shortCircuit: true };
    if (especificador === "@/lib/supabase/client") return { url: FALSO_CLIENTE, shortCircuit: true };
    if (especificador === "@/lib/supabase/sessao") return { url: SESSAO_FALSA, shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { falso, getSupabaseClient } = await import("./_supabase-falso.mts");
const lib = await import("../../src/features/orcamentos/lib/cotacao-veppo.ts");
const { cotarVeppoNoServidor } = await import("../../src/features/orcamentos/services/frete-veppo.server.ts");
const { solicitarCotacaoVeppo } = await import("../../src/features/orcamentos/services/frete.service.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}
const ler = (p: string) => readFileSync(path.join(RAIZ, p), "utf8").replace(/\r\n/g, "\n");
const form0 = () => ler("src/features/orcamentos/OrcamentoFormPage.tsx");
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ── A ───────────────────────────────────────────────────────────────────────
console.log("== A. a conta");
confere("percentual numa constante: 1,20 e rótulo +20%", lib.MARGEM_VEPPO === 1.2 && lib.rotuloMargemVeppo() === "+20%");
for (const [n8n, final] of [[42.45, 50.94], [73.18, 87.82], [90.06, 108.07]] as const) {
  const r = lib.aplicarMargemVeppo(n8n);
  confere(`${n8n} do n8n vira ${final} (original ${n8n})`, r.valorFinal === final && r.valorOriginal === n8n, r);
}

// ── B ───────────────────────────────────────────────────────────────────────
console.log("== B. a função de servidor");
let chamadasN8n = 0;
function comN8n(resposta: unknown, statusHttp = 200) {
  falso.zerar();
  chamadasN8n = 0;
  falso.responder("cidades_veppo:select", { data: [{ cidade: "CANOAS" }], error: null });
  return {
    clienteServico: () => getSupabaseClient() as never,
    buscar: (async () => {
      chamadasN8n++;
      return new Response(JSON.stringify(resposta), { status: statusHttp, headers: { "content-type": "application/json" } });
    }) as typeof fetch
  };
}
const entrada = { peso: 1500, valor: 320, cidade: "Canoas", uf: "RS", id_int: 24600 };
for (const [n8n, final] of [[42.45, 50.94], [73.18, 87.82], [90.06, 108.07]] as const) {
  const r = await cotarVeppoNoServidor(entrada, comN8n({ valor_frete: n8n }));
  const f = r.fretes[0];
  confere(
    `n8n ${n8n}: card ${final}, original ${n8n}, observação com o original e +20%`,
    r.status === "COTADA" && r.fretes.length === 1 && f.valor === final && f.valorOriginal === n8n && f.valorMargem === final &&
      f.observacao === `Cotação via VEPPO | Valor original: ${brl(n8n)} (+20%)` && chamadasN8n === 1,
    r
  );
}
for (const [rotulo, resposta] of [
  ["zero", { valor_frete: 0 }],
  ["negativo", { valor_frete: -12.3 }],
  ["texto", { valor_frete: "42,45" }],
  ["sem o campo", { outro: 1 }],
  ["nulo", null],
  ["NaN vira null no JSON", { valor_frete: Number.NaN }]
] as const) {
  const r = await cotarVeppoNoServidor(entrada, comN8n(resposta));
  confere(`resposta ${rotulo}: sem card (SEM_COTACAO)`, r.status === "SEM_COTACAO" && r.fretes.length === 0, r);
}

// ── B2. corte: pedido com VEPPO escolhida antes de 03/11/2026 ────────────────
console.log("== B2. corte por pedido");
const ANTES = "2026-11-02T18:46:58Z"; // como o 24575
const DEPOIS = "2026-11-03T13:10:00Z";
function comPedido(propostaCriadaEm: string | null, servicos: string[], n8n: unknown, erroEm: string | null = null) {
  const d = comN8n(n8n);
  falso.responder("propostas:select", erroEm === "propostas" ? { data: null, error: { message: "falha" } } : { data: propostaCriadaEm ? { created_at: propostaCriadaEm } : null, error: null });
  falso.responder("cotacao_frete:select", erroEm === "cotacao_frete" ? { data: null, error: { message: "falha" } } : { data: servicos.map((servico) => ({ servico })), error: null });
  return d;
}
const pedido = { ...entrada, id_int: 24575 };
{
  const r = await cotarVeppoNoServidor(pedido, comPedido(ANTES, ["VEPPO"], { valor_frete: 42.45 }));
  const f = r.fretes[0];
  confere("pedido com VEPPO gravada antes do corte: recota 42,45 (sem os 20%), card de antes, sem Original",
    r.status === "COTADA" && f.valor === 42.45 && f.valorOriginal === undefined && f.valorMargem === undefined && f.observacao === "Cotação via VEPPO", r);
  const escolhida = falso.chamadas.find((c) => c.tabela === "cotacao_frete");
  confere("o corte lê o frete escolhido do próprio pedido (id_int e escolhido = true), só leitura",
    JSON.stringify(escolhida?.filtros).includes('["eq",["id_int",24575]]') && JSON.stringify(escolhida?.filtros).includes('["eq",["escolhido",true]]') &&
      falso.chamadas.every((c) => c.op === "select"), falso.chamadas);
}
for (const [rotulo, criada, servicos] of [
  ["pedido novo (criado depois do corte) com VEPPO", DEPOIS, ["VEPPO"]],
  ["pedido antigo que ainda não tinha a VEPPO escolhida (escolhe agora)", ANTES, ["SEDEX"]],
  ["pedido antigo sem frete escolhido", ANTES, []]
] as const) {
  const r = await cotarVeppoNoServidor(pedido, comPedido(criada, [...servicos], { valor_frete: 42.45 }));
  confere(`${rotulo}: 42,45 vira 50,94 com Original (+20%)`, r.fretes[0]?.valor === 50.94 && r.fretes[0]?.valorOriginal === 42.45, r);
}
{
  const r = await cotarVeppoNoServidor({ ...entrada, id_int: undefined }, comPedido(ANTES, ["VEPPO"], { valor_frete: 42.45 }));
  confere("sem número de pedido (orçamento novo, Maestro): +20% e o corte nem é lido", r.fretes[0]?.valor === 50.94 && !falso.chamadas.some((c) => c.tabela === "propostas"), r);
}
for (const tabela of ["propostas", "cotacao_frete"]) {
  const r = await cotarVeppoNoServidor(pedido, comPedido(ANTES, ["VEPPO"], { valor_frete: 42.45 }, tabela));
  confere(`leitura de ${tabela} falhou: sem card e sem chamar o n8n (como a lista ilegível)`, r.status === "CORTE_NAO_CONFERIDO" && r.fretes.length === 0 && chamadasN8n === 0, r);
}
{
  const r = await cotarVeppoNoServidor(pedido, comPedido(ANTES, ["VEPPO"], { valor_frete: 0 }));
  confere("pedido antigo com resposta zero: sem card, como sempre", r.status === "SEM_COTACAO" && r.fretes.length === 0, r);
}
confere("corte na hora do commit def064f7 (09:38 de 03/11/2026, Brasília)", lib.CORTE_MARGEM_VEPPO === "2026-11-03T12:38:04Z");
confere("regra pura: um segundo antes do corte é antigo; no corte, novo",
  lib.cotacaoVeppoLegada({ propostaCriadaEm: "2026-11-03T12:38:03Z", servicosEscolhidos: ["VEPPO"] }) === true &&
    lib.cotacaoVeppoLegada({ propostaCriadaEm: "2026-11-03T12:38:04Z", servicosEscolhidos: ["VEPPO"] }) === false &&
    lib.cotacaoVeppoLegada({ propostaCriadaEm: null, servicosEscolhidos: ["VEPPO"] }) === false);
confere("tela: proposta não gravada não manda número; gravada manda", lib.idIntParaCorteVeppo("NOVO") === undefined && lib.idIntParaCorteVeppo("24575") === 24575);

// ── C ───────────────────────────────────────────────────────────────────────
console.log("== C. nunca duas vezes");
// A tela recebe da rota o card já com +20% e devolve como veio.
(globalThis as unknown as { __fetchDaTela: unknown }).__fetchDaTela = async () =>
  new Response(JSON.stringify({ success: true, status: "COTADA", fretes: [{ id: "frete_veppo", valor: 50.94, valorOriginal: 42.45 }] }), { status: 200 });
const naTela = await solicitarCotacaoVeppo({ peso: 1, valor: 1, cidade: "Canoas", uf: "RS" });
confere("tela: o card da rota (50,94) chega 50,94, sem segunda conta", naTela.length === 1 && naTela[0].valor === 50.94 && naTela[0].valorOriginal === 42.45, naTela);

// A conta (aplicarMargemVeppo / MARGEM_VEPPO) só é usada dentro de frete-veppo.server.
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const usamConta = arquivos(path.join(RAIZ, "src"))
  .filter((p) => /aplicarMargemVeppo|MARGEM_VEPPO/.test(readFileSync(p, "utf8")))
  .map((p) => path.relative(RAIZ, p).replace(/\\/g, "/"))
  .sort();
confere(
  "a conta aparece só na lib e em frete-veppo.server",
  JSON.stringify(usamConta) === JSON.stringify(["src/features/orcamentos/lib/cotacao-veppo.ts", "src/features/orcamentos/services/frete-veppo.server.ts"]),
  usamConta
);
// Os chamadores repassam o card como veio.
const maestroFrete = ler("src/features/maestro/core/agent/maestro-agent-frete.server.ts");
confere("Maestro, recotação, Aplicar e complementar (cotarOpcoesFretePorEndereco) repassam o card da VEPPO, com o número do pedido", maestroFrete.includes("id_int: params.idIntPedido }).then((r) => r.fretes),") && !/valor\s*\*\s*1[.,]2/.test(maestroFrete));
for (const [arq, marco] of [
  ["src/app/api/expedicao/recotacao/cotar/route.ts", "idIntPedido: idInt }"],
  ["src/app/api/expedicao/recotacao/aplicar/route.ts", "idIntPedido: idInt }"],
  ["src/app/api/orcamentos/complementar/cotar-frete/route.ts", "idIntPedido: idIntPrincipal"],
  ["src/app/api/orcamentos/complementar/aplicar-frete/route.ts", "idIntPedido: idIntPrincipal"]
] as const) {
  confere(`${arq.split("/").slice(-3, -1).join("/")}: manda o pedido para o corte`, ler(arq).includes(marco));
}
confere("tela: as três cotações VEPPO mandam o número do pedido", (form0().match(/id_int: idIntParaCorteVeppo\(form\.id_int\)/g) || []).length === 3);
const motor = ler("src/features/maestro/core/simple/maestro-simple-engine.ts");
confere("Maestro simples repassa o card da VEPPO", motor.includes("}).then((r) => r.fretes) : Promise.resolve([])"));
const rota = ler("src/app/api/frete/veppo/route.ts");
confere("rota da tela devolve os fretes da função como vieram", rota.includes("fretes: resultado.fretes,"));

// ── D ───────────────────────────────────────────────────────────────────────
console.log("== D. o card da tela");
const form = ler("src/features/orcamentos/OrcamentoFormPage.tsx");
confere(
  "card VEPPO com original mostra \"Original: R$ ... (+20%)\"; card relido do banco (sem original) não",
  form.includes('(frete.transportadora || "").toUpperCase() === "VEPPO" && frete.valorOriginal !== undefined && (') &&
    form.includes("Original: {formatCurrency(frete.valorOriginal)} ({rotuloMargemVeppo()})")
);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exitCode = falhas === 0 ? 0 : 1;
