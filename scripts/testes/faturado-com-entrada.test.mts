/**
 * Faturado com entrada (06/11/2026): A (entrada PIX/boleto) + B (Faturado com o restante) num passo só.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/faturado-com-entrada.test.mts
 *
 * SEM banco: cliente Supabase falso (só anota o que seria gravado) e dublê do
 * total da proposta.
 *   A. a divisão: entrada > 0 e < total; A + B = total em centavos;
 *   B. R$ 1.000,00 com entrada de R$ 300,00 por PIX: UM insert com A (PIX 300,00)
 *      e B (Faturado 700,00), Histórico registrado;
 *   C. a B falha: o insert é um só (as duas linhas), então a A também não existe;
 *      nada mais é gravado em pagamentos_v2;
 *   D. recusas antes de gravar: entrada zero, entrada = total, cobrança ativa,
 *      forma inválida, sem condição;
 *   E. o combinado de E-Crédito não foi tocado.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const url = (arquivo: string) => pathToFileURL(path.join(AQUI, arquivo)).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: url("_supabase-js-falso-com-tipos.mts"), shortCircuit: true };
    if (especificador === "next/server") return { url: url("_next-server-falso-com-tipos.mts"), shortCircuit: true };
    if (especificador === "@/lib/supabase/client") return { url: url("_supabase-falso.mts"), shortCircuit: true };
    if (especificador === "@/features/orcamentos/services/orcamentos.service") return { url: url("_orcamentos-service-falso.mts"), shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const { falso } = await import("./_supabase-falso.mts");
const { definirTotalDaProposta } = await import("./_orcamentos-service-falso.mts");
const regras = await import("../../src/features/cobrancas/lib/faturado-com-entrada.ts");
const { POST } = await import("../../src/app/api/cobrancas/faturado-com-entrada/route.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

// ── A. a divisão ────────────────────────────────────────────────────────────
console.log("== A. a divisão");
{
  const d = regras.dividirFaturadoComEntrada(100000, 30000);
  confere("1.000,00 com entrada 300,00 -> restante 700,00", d.ok && d.entradaCentavos === 30000 && d.restanteCentavos === 70000, d);
  const c = regras.dividirFaturadoComEntrada(90626, 30000);
  confere("centavos exatos: 906,26 com 300,00 -> 606,26 (soma = total)", c.ok && c.restanteCentavos === 60626 && c.entradaCentavos + c.restanteCentavos === 90626, c);
  confere("entrada zero: recusa", !regras.dividirFaturadoComEntrada(100000, 0).ok);
  confere("entrada = total: recusa", !regras.dividirFaturadoComEntrada(100000, 100000).ok);
  confere("entrada > total: recusa", !regras.dividirFaturadoComEntrada(100000, 100001).ok);
}

// ── preparação da rota ──────────────────────────────────────────────────────
const MODELO = { id: "m1", resultado: "30 DIAS", qtd_parcela: 1, inicio: 30, intervalo: 0, entrada_porcento: 0 };
function prepararBanco(opcoes: { ativas?: unknown[]; insertErro?: string } = {}) {
  falso.zerar();
  falso.responder("usuarios:select", { data: { id_perfil: 1, is_super_adm: true, id_empresa: 1, nome_usuario: "Vendedora Teste" }, error: null });
  falso.responder("propostas:select", { data: { id_int: 30500, id_cliente: 777, id_faturado: null, empresa: "E3 BRINDES LTDA", vendedor: "Vendedora", status_interno: "NOVO", is_avulso: false, motivo_copia: null, id_int_origem_copia: null }, error: null });
  falso.responder("pagamentos_v2:select", { data: opcoes.ativas ?? [], error: null });
  falso.responder("modelos_cobranca:select", { data: MODELO, error: null });
  falso.responder("clientes:select", { data: { id_cliente: 777, nome: "CLIENTE TESTE", documento: "12345678000199" }, error: null });
  falso.interceptar("pagamentos_v2:insert", (payload) => {
    if (opcoes.insertErro) return { data: null, error: { message: opcoes.insertErro } };
    const linhas = payload as Array<Record<string, unknown>>;
    return { data: linhas.map((l, i) => ({ id: l.id, id_pagamento: `30500-${String.fromCharCode(65 + i)}`, tipo_cobranca: l.tipo_cobranca, valor: l.valor })), error: null };
  });
  falso.responder("propostas_chat:insert", { data: null, error: null });
}
async function gerar(corpo: Record<string, unknown>) {
  const req = new Request("http://localhost/api/cobrancas/faturado-com-entrada", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token" },
    body: JSON.stringify({ idInt: 30500, formaEntrada: "PIX", valorEntrada: 300, idModeloCobranca: "m1", idEmpresa: 3, empresa: "E3 BRINDES LTDA", ...corpo })
  });
  const resposta = await POST(req);
  const json = (await resposta.json()) as Record<string, unknown>;
  const inserts = falso.chamadas.filter((c) => c.tabela === "pagamentos_v2" && c.op === "insert");
  const escritasPagamentos = falso.chamadas.filter((c) => c.tabela === "pagamentos_v2" && c.op !== "select");
  return { status: resposta.status, json, inserts, escritasPagamentos };
}

// ── B. o caso pedido ────────────────────────────────────────────────────────
console.log("== B. R$ 1.000,00 com entrada de R$ 300,00 por PIX");
{
  definirTotalDaProposta(1000);
  prepararBanco();
  const r = await gerar({});
  confere("responde sucesso", r.status === 200 && r.json.success === true, r.json);
  confere("UM insert só, com as duas linhas", r.inserts.length === 1 && (r.inserts[0].payload as unknown[]).length === 2, r.inserts.length);
  const [a, b] = (r.inserts[0]?.payload ?? []) as Array<Record<string, unknown>>;
  confere("A: PIX R$ 300,00, A_RECEBER, com link de pagamento", a?.tipo_cobranca === "PIX" && a?.valor === 300 && a?.status === "A_RECEBER" && typeof a?.url_cobranca === "string" && String(a?.url_cobranca).includes(String(a?.token_publico)), a);
  confere("B: Faturado R$ 700,00, A_VENCER, não confirmado, com a condição", b?.tipo_cobranca === "E-FATURADO" && b?.valor === 700 && b?.status === "A_VENCER" && b?.confirmado === false && b?.forma_fatu === "30 DIAS" && b?.id_modelo_cobranca === "m1" && b?.url_cobranca === null, b);
  confere("A + B = total", Number(a?.valor) * 100 + Number(b?.valor) * 100 === 100000);
  confere("mesma proposta e mesmo pagador nas duas", a?.id_int === 30500 && b?.id_int === 30500 && a?.id_cliente === 777 && b?.id_cliente === 777);
  const chat = falso.chamadas.find((c) => c.tabela === "propostas_chat");
  const msg = String(((chat?.payload as Array<Record<string, unknown>>) ?? [])[0]?.mensagem ?? "");
  confere("Histórico registra as duas", msg.includes("30500-A") && msg.includes("30500-B") && msg.includes("R$ 300,00") && msg.includes("R$ 700,00"), msg);
  confere("devolve os ids para a tela emitir a entrada", Boolean((r.json.entrada as Record<string, unknown>)?.id) && (r.json.faturado as Record<string, unknown>)?.valor === 700, r.json);
}
{
  definirTotalDaProposta(1000);
  prepararBanco();
  const r = await gerar({ formaEntrada: "BOLETO" });
  const [a] = (r.inserts[0]?.payload ?? []) as Array<Record<string, unknown>>;
  confere("entrada por boleto: A BOLETO R$ 300,00 com link", a?.tipo_cobranca === "BOLETO" && a?.valor === 300 && typeof a?.url_cobranca === "string", a);
}

// ── C. a B falha ────────────────────────────────────────────────────────────
console.log("== C. a criação falha");
{
  definirTotalDaProposta(1000);
  prepararBanco({ insertErro: "new row violates check constraint" });
  const r = await gerar({});
  confere("responde falha, dizendo que nenhuma foi gravada", r.json.success === false && /Nenhuma das duas foi gravada/.test(String(r.json.message)), r.json);
  confere("a A não foi gravada à parte: a única escrita em pagamentos_v2 é o insert das duas", r.escritasPagamentos.length === 1 && (r.inserts[0].payload as unknown[]).length === 2, r.escritasPagamentos.length);
  confere("nada vai ao Histórico", !falso.chamadas.some((c) => c.tabela === "propostas_chat"));
}

// ── D. recusas antes de gravar ──────────────────────────────────────────────
console.log("== D. recusas antes de gravar");
async function semEscrita(nome: string, corpo: Record<string, unknown>, opcoes?: Parameters<typeof prepararBanco>[0]) {
  definirTotalDaProposta(1000);
  prepararBanco(opcoes);
  const r = await gerar(corpo);
  confere(`${nome}: recusa sem gravar nada`, r.json.success === false && r.escritasPagamentos.length === 0, r.json);
}
await semEscrita("entrada zero", { valorEntrada: 0 });
await semEscrita("entrada igual ao total", { valorEntrada: 1000 });
await semEscrita("proposta com cobrança ativa", {}, { ativas: [{ id: "x" }] });
await semEscrita("forma da entrada inválida", { formaEntrada: "CARTAO" });
await semEscrita("sem condição de pagamento", { idModeloCobranca: "" });

// ── E. o combinado de E-Crédito ─────────────────────────────────────────────
console.log("== E. combinado de E-Crédito");
{
  const diff = execSync("git diff --stat HEAD -- src/app/api/cobrancas/pagamento-combinado/route.ts src/app/api/cobrancas/usar-credito/route.ts", { encoding: "utf8" }).trim();
  confere("rotas do combinado e do uso de crédito sem nenhuma alteração", diff === "", diff);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
