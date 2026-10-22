/**
 * Cotação VEPPO só para cidade de cidades_veppo (21/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/frete-veppo-cidades.test.mts
 *
 * SEM banco e SEM rede: cliente Supabase falso e fetch falso.
 *   A. a chave da cidade (só letras) e a regra de sempre (RS, fora de POA);
 *   B. a função de servidor: atendida chama o n8n com o corpo de antes; não
 *      atendida, fora do RS e Porto Alegre NÃO chamam; lista ilegível não chama;
 *   C. a tela: solicitarCotacaoVeppo chama a rota (não o n8n) e esconde a VEPPO
 *      quando a resposta é "não atendida";
 *   D. a rota: sem sessão recusa; com sessão devolve o status.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FALSO_JS = pathToFileURL(path.join(AQUI, "_supabase-js-falso-com-tipos.mts")).href;
const FALSO_NEXT = pathToFileURL(path.join(AQUI, "_next-server-falso-com-tipos.mts")).href;
const FALSO_CLIENTE = pathToFileURL(path.join(AQUI, "_supabase-falso.mts")).href;
// A chamada da tela usa fetchComSessao; aqui ele vira um fetch anotado, sem sessão real.
const SESSAO_FALSA = "data:text/javascript," + encodeURIComponent(`
  export class SessaoExpiradaError extends Error {}
  export async function obterAccessToken() { return "token"; }
  export async function fetchComSessao(url, init) { return globalThis.__fetchDaTela(url, init); }
`);
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: FALSO_JS, shortCircuit: true };
    if (especificador === "next/server") return { url: FALSO_NEXT, shortCircuit: true };
    if (especificador === "@/lib/supabase/client") return { url: FALSO_CLIENTE, shortCircuit: true };
    if (especificador === "@/lib/supabase/sessao") return { url: SESSAO_FALSA, shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { falso, getSupabaseClient } = await import("./_supabase-falso.mts");
const lib = await import("../../src/features/orcamentos/lib/cidade-veppo.ts");
const { cotarVeppoNoServidor, WEBHOOK_VEPPO } = await import("../../src/features/orcamentos/services/frete-veppo.server.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

// ── A ───────────────────────────────────────────────────────────────────────
console.log("== A. chave da cidade e regra de sempre");
confere("SANT'ANA DO LIVRAMENTO e SANTANA DO LIVRAMENTO dao a mesma chave", lib.chaveCidadeVeppo("SANT'ANA DO LIVRAMENTO") === lib.chaveCidadeVeppo("SANTANA DO LIVRAMENTO"));
confere("Nao Me Toque e NAO-ME-TOQUE dao a mesma chave", lib.chaveCidadeVeppo("Nao Me Toque") === lib.chaveCidadeVeppo("NAO-ME-TOQUE"));
confere("acento, minuscula e espaco sobrando nao importam", lib.chaveCidadeVeppo(" Candelária  ") === "CANDELARIA" && lib.chaveCidadeVeppo("Boa Vista do Buricá") === lib.chaveCidadeVeppo("BOA VISTA DO BURICA"));
confere("cidades diferentes dao chaves diferentes", lib.chaveCidadeVeppo("SANTA MARIA") !== lib.chaveCidadeVeppo("SANTA ROSA"));
confere("regra de sempre: RS fora de POA consulta", lib.regraAtualPermiteVeppo("rs", "Canoas") === true);
confere("regra de sempre: Porto Alegre nao consulta", lib.regraAtualPermiteVeppo("RS", "Porto Alegre") === false);
confere("regra de sempre: fora do RS nao consulta", lib.regraAtualPermiteVeppo("SC", "Florianopolis") === false);

// ── B ───────────────────────────────────────────────────────────────────────
console.log("== B. a funcao de servidor");
const LISTA = [{ cidade: "SANTANA DO LIVRAMENTO" }, { cidade: "CANOAS" }, { cidade: "NAO-ME-TOQUE" }];
let chamadasN8n: Array<{ url: string; corpo: unknown }> = [];
const n8nResponde = (async (url: string, init?: RequestInit) => {
  chamadasN8n.push({ url, corpo: JSON.parse(String(init?.body ?? "null")) });
  return new Response(JSON.stringify({ valor_frete: 87.5 }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
function servico(lista: unknown[] | null, erro = false) {
  falso.zerar(); chamadasN8n = [];
  falso.responder("cidades_veppo:select", { data: lista, error: erro ? { message: "falha" } : null });
  return { clienteServico: () => getSupabaseClient() as never, buscar: n8nResponde };
}
{
  const r = await cotarVeppoNoServidor({ peso: 1200, valor: 300, cidade: "SANT'ANA DO LIVRAMENTO", uf: "RS", id_int: 23900 }, servico(LISTA));
  confere("SANT'ANA DO LIVRAMENTO (lista sem apostrofo): COTADA", r.status === "COTADA" && r.fretes[0]?.valor === 87.5, r);
  confere("o n8n recebe o texto da cidade SEM normalizar, como antes", chamadasN8n.length === 1 && chamadasN8n[0].url === WEBHOOK_VEPPO &&
    JSON.stringify(chamadasN8n[0].corpo) === JSON.stringify({ text: "SANT'ANA DO LIVRAMENTO, RS, Brasil", cidade: "SANT'ANA DO LIVRAMENTO", valor: 300, peso: 1200 }), chamadasN8n);
  confere("o frete devolvido e o de antes (id, servico, prazo, id_int, peso)", JSON.stringify(r.fretes[0]) === JSON.stringify({ id: "frete_veppo", id_int: 23900, transportadora: "VEPPO", servico: "VEPPO", valor: 87.5, prazo: "Sob consulta", observacao: "Cotação via VEPPO", escolhido: false, pesoUsado: 1200 }), r.fretes[0]);
  const filtros = JSON.stringify(falso.chamadas.find((c) => c.tabela === "cidades_veppo")?.filtros);
  confere("a lista e lida so com is_ativa = true", filtros.includes('["eq",["is_ativa",true]]'), filtros);
}
{
  const r = await cotarVeppoNoServidor({ peso: 1200, valor: 300, cidade: "Nao Me Toque", uf: "RS" }, servico(LISTA));
  confere("Nao Me Toque (lista com hifen): COTADA", r.status === "COTADA" && chamadasN8n.length === 1, r);
}
{
  const r = await cotarVeppoNoServidor({ peso: 1200, valor: 300, cidade: "Gramado", uf: "RS" }, servico(LISTA));
  confere("cidade fora da lista: NAO_ATENDIDA, sem chamar o n8n", r.status === "NAO_ATENDIDA" && r.fretes.length === 0 && chamadasN8n.length === 0, { r, chamadasN8n });
}
{
  const r = await cotarVeppoNoServidor({ peso: 1, valor: 1, cidade: "Porto Alegre", uf: "RS" }, servico(LISTA));
  confere("Porto Alegre: FORA_DA_REGRA, sem ler a lista nem chamar o n8n (como hoje)", r.status === "FORA_DA_REGRA" && chamadasN8n.length === 0 && falso.chamadas.length === 0, r);
}
{
  const r = await cotarVeppoNoServidor({ peso: 1, valor: 1, cidade: "Canoas", uf: "SC" }, servico(LISTA));
  confere("fora do RS: FORA_DA_REGRA, sem ler a lista nem chamar o n8n (como hoje)", r.status === "FORA_DA_REGRA" && chamadasN8n.length === 0 && falso.chamadas.length === 0, r);
}
{
  const r = await cotarVeppoNoServidor({ peso: 1, valor: 1, cidade: "Canoas", uf: "RS" }, servico(null, true));
  confere("lista ilegivel: LISTA_INDISPONIVEL, sem chamar o n8n", r.status === "LISTA_INDISPONIVEL" && chamadasN8n.length === 0, r);
  const r2 = await cotarVeppoNoServidor({ peso: 1, valor: 1, cidade: "Canoas", uf: "RS" }, { clienteServico: () => null, buscar: n8nResponde });
  confere("sem chave de servico: LISTA_INDISPONIVEL, sem chamar o n8n", r2.status === "LISTA_INDISPONIVEL" && chamadasN8n.length === 0, r2);
}
{
  const n8nErro = (async () => new Response("x", { status: 500 })) as typeof fetch;
  falso.zerar(); falso.responder("cidades_veppo:select", { data: LISTA, error: null });
  const r = await cotarVeppoNoServidor({ peso: 1, valor: 1, cidade: "Canoas", uf: "RS" }, { clienteServico: () => getSupabaseClient() as never, buscar: n8nErro });
  confere("cidade atendida, n8n com erro: sem cotacao, como hoje", r.status === "SEM_COTACAO" && r.fretes.length === 0, r);
}

// ── C ───────────────────────────────────────────────────────────────────────
console.log("== C. a tela chama a rota, nao o n8n");
const { solicitarCotacaoVeppo } = await import("../../src/features/orcamentos/services/frete.service.ts");
const pedidasTela: string[] = [];
let respostaRota: unknown = { success: true, status: "COTADA", fretes: [{ id: "frete_veppo", valor: 87.5 }] };
(globalThis as Record<string, unknown>).__fetchDaTela = async (url: string) => { pedidasTela.push(url); return new Response(JSON.stringify(respostaRota), { status: 200 }); };
{
  const r = await solicitarCotacaoVeppo({ peso: 1, valor: 1, cidade: "Canoas", uf: "RS" });
  confere("cidade atendida: chama /api/frete/veppo e mostra a VEPPO", pedidasTela[0] === "/api/frete/veppo" && r.length === 1 && r[0].valor === 87.5, { pedidasTela, r });
}
{
  respostaRota = { success: true, status: "NAO_ATENDIDA", fretes: [], mensagem: "Cidade não atendida pela VEPPO." };
  const r = await solicitarCotacaoVeppo({ peso: 1, valor: 1, cidade: "Gramado", uf: "RS" });
  confere("nao atendida: nenhuma opcao VEPPO (some da tela)", r.length === 0, r);
}
{
  pedidasTela.length = 0;
  const a = await solicitarCotacaoVeppo({ peso: 1, valor: 1, cidade: "Porto Alegre", uf: "RS" });
  const b = await solicitarCotacaoVeppo({ peso: 1, valor: 1, cidade: "Joinville", uf: "SC" });
  confere("Porto Alegre e fora do RS: nenhuma chamada, como hoje", a.length === 0 && b.length === 0 && pedidasTela.length === 0, pedidasTela);
}
{
  (globalThis as Record<string, unknown>).__fetchDaTela = async () => { throw new TypeError("Failed to fetch"); };
  const r = await solicitarCotacaoVeppo({ peso: 1, valor: 1, cidade: "Canoas", uf: "RS" });
  confere("rota fora do ar: nenhuma cotacao, nao lanca (como antes)", r.length === 0, r);
}
{
  const { readFileSync } = await import("node:fs");
  const fonte = readFileSync(new URL("../../src/features/orcamentos/services/frete.service.ts", import.meta.url), "utf8");
  confere("frete.service nao chama mais o webhook coordenadas", !fonte.includes("webhook/coordenadas"));
}

// ── D ───────────────────────────────────────────────────────────────────────
console.log("== D. a rota");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "servico";
const { POST } = await import("../../src/app/api/frete/veppo/route.ts");
{
  const r = await POST(new Request("http://localhost/api/frete/veppo", { method: "POST", body: JSON.stringify({ peso: 1, valor: 1, cidade: "Canoas", uf: "RS" }) }));
  confere("sem sessao: 401", r.status === 401, r.status);
}
{
  falso.zerar(); falso.responder("cidades_veppo:select", { data: LISTA, error: null });
  const r = await POST(new Request("http://localhost/api/frete/veppo", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ peso: 1, valor: 1, cidade: "Gramado", uf: "RS" }) }));
  const corpo = await r.json() as Record<string, unknown>;
  confere("com sessao, cidade fora da lista: 200, NAO_ATENDIDA e a mensagem", r.status === 200 && corpo.status === "NAO_ATENDIDA" && corpo.mensagem === "Cidade não atendida pela VEPPO." && Array.isArray(corpo.fretes) && (corpo.fretes as unknown[]).length === 0, corpo);
}
{
  const r = await POST(new Request("http://localhost/api/frete/veppo", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ cidade: "Canoas" }) }));
  confere("corpo incompleto: 400", r.status === 400, r.status);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
