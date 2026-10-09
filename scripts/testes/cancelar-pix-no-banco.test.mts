/**
 * Cancelamento de PIX: o Vibe só cancela quando o banco confirma — PASSO A (09/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/cancelar-pix-no-banco.test.mts
 *
 * SEM banco de dados, SEM n8n e SEM banco emissor: cliente Supabase falso e `fetch` falso.
 *   A. a leitura da resposta do n8n (JSON puro, embrulhado, sem o campo);
 *   B. a decisão por empresa: C6 exige a confirmação; Inter segue pelo HTTP neste passo;
 *   C. a rota `POST /api/cobrancas/cancelar-externo`, um caso por linha:
 *        confirmado | recusa | 200 sem confirmação | rede | tempo | sem código | já pago
 *      e o que vai para o n8n: motivo fixo (nunca o digitado) e o cabeçalho do segredo.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const url = (arquivo: string) => pathToFileURL(path.join(AQUI, arquivo)).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: url("_supabase-js-falso-com-tipos.mts"), shortCircuit: true };
    if (especificador === "next/server") return { url: url("_next-server-falso-com-tipos.mts"), shortCircuit: true };
    if (especificador === "@/lib/supabase/client") return { url: url("_supabase-falso.mts"), shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { falso } = await import("./_supabase-falso.mts");
const {
  MENSAGEM_PIX_NAO_CANCELADO_NO_BANCO,
  MOTIVO_FIXO_DE_CANCELAMENTO,
  TEMPO_LIMITE_CANCELAMENTO_PIX_MS,
  WEBHOOK_CANCELA_PIX,
  chamarCancelamentoDePix,
  confirmacaoDoBancoNaResposta,
  corpoDoCancelamentoPix,
  decidirCancelamentoDePix,
  regraDoCancelamentoPix
} = await import("../../src/features/cobrancas/services/cancelamento-pix.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

// O que o fluxo monta hoje (lido no n8n): { success, cancelado, status, txid, mensagem }.
const CONFIRMOU = { success: true, cancelado: true, status: "REMOVIDA_PELO_USUARIO_RECEBEDOR", txid: "QRS1TX0001", mensagem: "Cobrança PIX cancelada com sucesso" };
const RECUSOU = { success: true, cancelado: false, mensagem: "Cobrança PIX não foi cancelada" };

// ── A. a leitura da resposta ────────────────────────────────────────────────
console.log("== A. leitura da resposta do n8n");
confere("mensagem pedida, palavra por palavra", MENSAGEM_PIX_NAO_CANCELADO_NO_BANCO === "Não foi possível cancelar o PIX no banco. A cobrança continua ativa: não gere outra cobrança para este pedido.");
confere("JSON puro com cancelado true", confirmacaoDoBancoNaResposta(JSON.stringify(CONFIRMOU)) === "CANCELOU");
confere("JSON puro com cancelado false", confirmacaoDoBancoNaResposta(JSON.stringify(RECUSOU)) === "NAO_CANCELOU");
confere("embrulhado pelo n8n (=[Object: {...}]) com true", confirmacaoDoBancoNaResposta(`=[Object: ${JSON.stringify(CONFIRMOU)}]`) === "CANCELOU");
confere("embrulhado e com espacos depois dos dois-pontos", confirmacaoDoBancoNaResposta('=[Object: {"success": true, "cancelado": true, "status": "X"}]') === "CANCELOU");
confere("embrulhado com false", confirmacaoDoBancoNaResposta(`=[Object: ${JSON.stringify(RECUSOU)}]`) === "NAO_CANCELOU");
confere("'[object Object]' nao e confirmacao", confirmacaoDoBancoNaResposta("=[object Object]") === "SEM_INFORMACAO");
confere("corpo vazio nao e confirmacao", confirmacaoDoBancoNaResposta("") === "SEM_INFORMACAO");
confere("success true sem o campo cancelado nao e confirmacao", confirmacaoDoBancoNaResposta('{"success":true}') === "SEM_INFORMACAO");
confere("a frase 'nao foi cancelada' sozinha nao decide", confirmacaoDoBancoNaResposta('{"mensagem":"Cobrança PIX cancelada com sucesso"}') === "SEM_INFORMACAO");
confere("campo de outro nome (pagamento_cancelado) nao conta", confirmacaoDoBancoNaResposta('{"pagamento_cancelado":true}') === "SEM_INFORMACAO");

// ── B. a decisão ────────────────────────────────────────────────────────────
console.log("== B. decisao por empresa");
const resp = (ok: boolean, status: number, corpo: unknown) => ({ tipo: "RESPOSTA" as const, ok, status, texto: typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
confere("regra: empresas 1 e 3 (C6) exigem a confirmacao; empresa 2 (Inter) segue pelo HTTP", regraDoCancelamentoPix(1) === "CONFIRMACAO_DO_BANCO" && regraDoCancelamentoPix(3) === "CONFIRMACAO_DO_BANCO" && regraDoCancelamentoPix(2) === "HTTP");
for (const emp of [1, 3]) {
  confere(`C6 emp ${emp}: 200 com cancelado true -> cancela`, decidirCancelamentoDePix(emp, resp(true, 200, CONFIRMOU)).cancelarNoVibe === true);
  confere(`C6 emp ${emp}: 200 com cancelado false -> NAO cancela (BANCO_RECUSOU, 409)`, (() => { const d = decidirCancelamentoDePix(emp, resp(true, 200, RECUSOU)); return !d.cancelarNoVibe && d.desfecho === "BANCO_RECUSOU" && d.statusHttp === 409; })());
  confere(`C6 emp ${emp}: 200 sem confirmacao -> NAO cancela`, (() => { const d = decidirCancelamentoDePix(emp, resp(true, 200, "=[object Object]")); return !d.cancelarNoVibe && d.desfecho === "RESPOSTA_SEM_CONFIRMACAO"; })());
  confere(`C6 emp ${emp}: erro HTTP -> NAO cancela`, decidirCancelamentoDePix(emp, resp(false, 500, "erro")).cancelarNoVibe === false);
  confere(`C6 emp ${emp}: erro HTTP mesmo com cancelado true no corpo -> NAO cancela`, decidirCancelamentoDePix(emp, resp(false, 502, CONFIRMOU)).cancelarNoVibe === false);
  confere(`C6 emp ${emp}: rede -> NAO cancela`, decidirCancelamentoDePix(emp, { tipo: "INDISPONIVEL", tempoEsgotado: false }).desfecho === "REDE");
  confere(`C6 emp ${emp}: tempo -> NAO cancela`, (() => { const d = decidirCancelamentoDePix(emp, { tipo: "INDISPONIVEL", tempoEsgotado: true }); return !d.cancelarNoVibe && d.desfecho === "TEMPO_ESGOTADO"; })());
}
{
  const d = decidirCancelamentoDePix(2, resp(true, 200, RECUSOU));
  confere("Inter: 200 decide como antes (cancela), mesmo com cancelado false", d.cancelarNoVibe === true && d.regra === "HTTP" && d.desfecho === "HTTP_OK_SEM_CONFERIR");
  confere("Inter: fica registrado que a regra nova NAO cancelaria", d.cancelariaPelaConfirmacao === false && d.confirmacao === "NAO_CANCELOU");
  confere("Inter: com cancelado true, a regra nova tambem cancelaria", decidirCancelamentoDePix(2, resp(true, 200, CONFIRMOU)).cancelariaPelaConfirmacao === true);
  confere("Inter: erro HTTP -> NAO cancela (ja era assim)", decidirCancelamentoDePix(2, resp(false, 409, RECUSOU)).cancelarNoVibe === false);
  confere("Inter: rede ou tempo -> NAO cancela", !decidirCancelamentoDePix(2, { tipo: "INDISPONIVEL", tempoEsgotado: true }).cancelarNoVibe && !decidirCancelamentoDePix(2, { tipo: "INDISPONIVEL", tempoEsgotado: false }).cancelarNoVibe);
}
confere("corpo enviado: codigo, empresa em texto (como sempre) e o motivo fixo", JSON.stringify(corpoDoCancelamentoPix({ codigoDoBanco: "QRS1", idEmpresa: 2 })) === JSON.stringify({ cod_validador: "QRS1", id_empresa: "2", motivo: MOTIVO_FIXO_DE_CANCELAMENTO }));
confere("o motivo fixo e curto e sem pontuacao", /^[A-Z ]{3,30}$/.test(MOTIVO_FIXO_DE_CANCELAMENTO), MOTIVO_FIXO_DE_CANCELAMENTO);
confere("teto de 25 s", TEMPO_LIMITE_CANCELAMENTO_PIX_MS === 25000);
{
  let abortou = false;
  const lento = ((_u: string, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => { abortou = true; rej(new DOMException("aborted", "AbortError")); }))) as unknown as typeof fetch;
  const r = await chamarCancelamentoDePix({ corpo: {}, cabecalhos: {}, tempoLimiteMs: 40, buscar: lento });
  confere("chamada que nao volta: abortada no teto, vira INDISPONIVEL por tempo", abortou && r.tipo === "INDISPONIVEL" && r.tempoEsgotado === true, r);
}

// ── C. a rota ───────────────────────────────────────────────────────────────
console.log("== C. a rota de cancelar");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.N8N_WEBHOOK_SECRET = "segredo-de-teste";
const { POST } = await import("../../src/app/api/cobrancas/cancelar-externo/route.ts");

const COBRANCA = {
  id: "c0000000-0000-0000-0000-000000000001",
  id_int: 22999,
  id_cliente: 14,
  id_pagamento: "22999-A",
  descricao: "PIX de teste",
  status: "A_RECEBER",
  confirmado: false,
  paid_at: null as string | null,
  data_confirmacao: null,
  tipo_cobranca: "PIX",
  cod_solicitacao_inter: "QRS1TXCODIGODOBANCO" as string | null,
  id_empresa: 1,
  reserva_estado: null,
  id_pendencia: null,
  chave_reserva: null,
  valor: 100
};

function prepararBanco(cobranca: Record<string, unknown>) {
  falso.zerar();
  falso.responder("usuarios:select", { data: { id_perfil: 1, id_empresa: 1, is_super_adm: true, is_admin: true, nome_usuario: "Teste" }, error: null });
  falso.responder("pagamentos_v2:select", { data: Object.assign([cobranca], cobranca), error: null });
  falso.responder("pagamentos_v2:update", { data: null, error: null });
  falso.responder("propostas:select", { data: { id_int: 22999, status_interno: "AGUARDANDO", is_prd_aprovado: false, is_avulso: true, valor_total: 100, empresa: "X", vendedor: "Y" }, error: null });
  falso.responder("propostas_chat:insert", { data: null, error: null });
}

type Chamada = { url: string; headers: Record<string, string>; body: string };
let chamadas: Chamada[] = [];
function fetchFalso(resposta: { status?: number; corpo?: unknown } | "REDE" | "LENTO") {
  chamadas = [];
  globalThis.fetch = (async (u: string, init?: RequestInit) => {
    chamadas.push({ url: String(u), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") });
    if (resposta === "REDE") throw new TypeError("fetch failed");
    if (resposta === "LENTO") return new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    const texto = typeof resposta.corpo === "string" ? resposta.corpo : JSON.stringify(resposta.corpo ?? {});
    return new Response(texto, { status: resposta.status ?? 200 });
  }) as typeof fetch;
}

async function cancelar(cobranca: Record<string, unknown>, motivoDigitado = "motivo digitado pelo usuario") {
  prepararBanco(cobranca);
  const requisicao = new Request("http://localhost/api/cobrancas/cancelar-externo", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ id: cobranca.id, id_int: cobranca.id_int, tipo_cobranca: "PIX", acao_local: "CANCEL", motivo: motivoDigitado })
  });
  const resposta = await POST(requisicao);
  const corpo = (await resposta.json()) as Record<string, unknown>;
  const cancelouNoVibe = falso.chamadas.some((c) => c.tabela === "pagamentos_v2" && c.op === "update" && (c.payload as Record<string, unknown>)?.status === "CANCELADO");
  const escritas = falso.chamadas.filter((c) => c.op !== "select");
  return { status: resposta.status, corpo, cancelouNoVibe, escritas, aoBanco: chamadas.filter((c) => c.url === WEBHOOK_CANCELA_PIX) };
}
const recusada = (r: Awaited<ReturnType<typeof cancelar>>) =>
  r.corpo.success === false && r.corpo.message === MENSAGEM_PIX_NAO_CANCELADO_NO_BANCO && r.corpo.code === "PIX_NAO_CANCELADO_NO_BANCO" && !r.cancelouNoVibe && r.escritas.length === 0;

// 1. confirmado
{
  fetchFalso({ corpo: `=[Object: ${JSON.stringify(CONFIRMOU)}]` });
  const r = await cancelar({ ...COBRANCA });
  confere("CONFIRMADO (C6): 200 e a cobranca vira CANCELADO no Vibe", r.status === 200 && r.corpo.success === true && r.cancelouNoVibe, r);
  confere("CONFIRMADO: uma chamada ao del-pix-vibe", r.aoBanco.length === 1, chamadas.map((c) => c.url));
  const corpo = JSON.parse(r.aoBanco[0].body);
  confere("vai o motivo FIXO, e nao o texto digitado", corpo.motivo === MOTIVO_FIXO_DE_CANCELAMENTO && !r.aoBanco[0].body.includes("digitado"), corpo);
  confere("codigo do banco e empresa relidos da cobranca", corpo.cod_validador === "QRS1TXCODIGODOBANCO" && corpo.id_empresa === "1", corpo);
  confere("vai o cabecalho do segredo", r.aoBanco[0].headers["x-vibe-webhook-secret"] === "segredo-de-teste", r.aoBanco[0].headers);
  confere("o motivo gravado no Vibe continua sendo o que o usuario digitou", r.escritas.some((c) => c.tabela === "pagamentos_v2" && String((c.payload as Record<string, unknown>)?.motivo_cancela ?? "").includes("digitado")), r.escritas.map((c) => c.payload));
}
{
  fetchFalso({ corpo: CONFIRMOU });
  const r = await cancelar({ ...COBRANCA, id_empresa: 3 });
  confere("CONFIRMADO (E3, JSON puro): cancela", r.status === 200 && r.cancelouNoVibe && JSON.parse(r.aoBanco[0].body).id_empresa === "3", r);
}
// 2. recusa
{
  fetchFalso({ corpo: `=[Object: ${JSON.stringify(RECUSOU)}]` });
  const r = await cancelar({ ...COBRANCA });
  confere("RECUSA do banco (200 com cancelado false): cobranca ATIVA, mensagem pedida, nada gravado", recusada(r) && r.status === 409 && r.corpo.desfecho === "BANCO_RECUSOU", r);
}
{
  fetchFalso({ status: 409, corpo: { success: false, cancelado: false, message: "recusado" } });
  const r = await cancelar({ ...COBRANCA });
  confere("RECUSA por erro HTTP (como o n8n respondera no passo seguinte): cobranca ATIVA", recusada(r) && r.status === 409, r);
}
// 3. 200 sem confirmação
{
  fetchFalso({ corpo: "=[object Object]" });
  const r = await cancelar({ ...COBRANCA });
  confere("200 SEM CONFIRMACAO: cobranca ATIVA, mensagem pedida, nada gravado", recusada(r) && r.corpo.desfecho === "RESPOSTA_SEM_CONFIRMACAO", r);
}
{
  fetchFalso({ corpo: "" });
  const r = await cancelar({ ...COBRANCA });
  confere("200 com corpo vazio: cobranca ATIVA", recusada(r), r);
}
// 4. rede
{
  fetchFalso("REDE");
  const r = await cancelar({ ...COBRANCA });
  confere("REDE: cobranca ATIVA, mensagem pedida, nada gravado, uma tentativa so", recusada(r) && r.status === 502 && r.corpo.desfecho === "REDE" && r.aoBanco.length === 1, r);
}
// 5. tempo
{
  const decisao = decidirCancelamentoDePix(1, await chamarCancelamentoDePix({ corpo: {}, cabecalhos: {}, tempoLimiteMs: 30, buscar: ((_u: string, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch }));
  confere("TEMPO esgotado: a decisao e nao cancelar (502, TEMPO_ESGOTADO)", !decisao.cancelarNoVibe && decisao.statusHttp === 502 && decisao.desfecho === "TEMPO_ESGOTADO", decisao);
}
// 6. sem código do banco: como antes
{
  fetchFalso({ corpo: CONFIRMOU });
  const r = await cancelar({ ...COBRANCA, cod_solicitacao_inter: null });
  confere("SEM CODIGO do banco: cancela so no Vibe, como antes, sem chamar o banco", r.status === 200 && r.cancelouNoVibe && r.aoBanco.length === 0, r);
}
// 7. já pago
{
  fetchFalso({ corpo: CONFIRMOU });
  const r = await cancelar({ ...COBRANCA, status: "PAID", paid_at: "2026-10-09T12:00:00Z" });
  confere("JA PAGO: recusa antes de chamar o banco (o caso e devolucao), nada gravado", r.status === 409 && r.corpo.success === false && r.aoBanco.length === 0 && !r.cancelouNoVibe && r.escritas.length === 0 && /devolu/i.test(String(r.corpo.message)), r);
}
// Inter (Birô): decide como antes neste passo, agora com o motivo
{
  fetchFalso({ corpo: `=[Object: ${JSON.stringify(RECUSOU)}]` });
  const r = await cancelar({ ...COBRANCA, id_empresa: 2, cod_solicitacao_inter: "c0316103-0000-4000-8000-000000000000" });
  confere("INTER (Biro): 200 cancela como antes (a regra rigida ali espera o n8n)", r.status === 200 && r.cancelouNoVibe, r);
  confere("INTER: o motivo fixo vai no corpo (o Inter exige e nunca recebia)", JSON.parse(r.aoBanco[0].body).motivo === MOTIVO_FIXO_DE_CANCELAMENTO && JSON.parse(r.aoBanco[0].body).id_empresa === "2", r.aoBanco[0]?.body);
}
{
  fetchFalso({ status: 409, corpo: { success: false } });
  const r = await cancelar({ ...COBRANCA, id_empresa: 2 });
  confere("INTER: erro HTTP deixa a cobranca ATIVA, com a mensagem pedida", recusada(r), r);
}
{
  fetchFalso("REDE");
  const r = await cancelar({ ...COBRANCA, id_empresa: 2 });
  confere("INTER: rede deixa a cobranca ATIVA, com a mensagem pedida", recusada(r) && r.status === 502, r);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
