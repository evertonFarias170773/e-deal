/**
 * Cancelamento de título no C6 pelo SERVIDOR (07/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/cancelar-boleto-c6.test.mts
 *
 * Até essa data o navegador chamava o webhook `del-boleto-vibe` do n8n. A rota
 * `POST /api/cobrancas/cancelar-boleto-faturado` passou a chamar. O que este
 * teste trava, SEM banco, SEM n8n e SEM C6 (cliente falso e `fetch` falso):
 *   A. o motivo da recusa sai IGUAL ao que o navegador montava, e
 *      `titulo-inativo-no-banco` (`ehRecusaPorTituloInativo`) decide igual;
 *   B. a rota, caso a caso da tabela: sucesso, recusa do banco, título pago,
 *      inexistente, sem permissão, vínculo ambíguo, rede, tempo, resposta
 *      inválida, título sem código do banco — e a Birô, que não muda;
 *   C. o que o navegador faz com cada resposta, e que ele nunca mais chama o
 *      banco (nem com aba antiga, nem com servidor antigo);
 *   D. o teto de tempo e a entrada do webhook na rota de prova.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FALSO_JS = pathToFileURL(path.join(AQUI, "_supabase-js-falso.mts")).href;
const FALSO_NEXT = pathToFileURL(path.join(AQUI, "_next-server-falso.mts")).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: FALSO_JS, shortCircuit: true };
    if (especificador === "next/server") return { url: FALSO_NEXT, shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { falso } = await import("./_supabase-falso.mts");
const { POST } = await import("../../src/app/api/cobrancas/cancelar-boleto-faturado/route.ts");
const {
  TEMPO_LIMITE_CANCELAMENTO_C6_MS,
  WEBHOOK_CANCELA_C6_FATURADO,
  cancelarTituloNoC6,
  destinoDaRespostaDoCancelamento,
  lerRespostaDoCancelamentoC6
} = await import("../../src/features/cobrancas/services/cancelamento-c6.ts");
const { mensagemDoRetornoBancario } = await import("../../src/features/cobrancas/services/boleto-c6.ts");
const { ehRecusaPorTituloInativo } = await import("../../src/features/cobrancas/recusa-bancaria.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

// ── A. o motivo, lado a lado ────────────────────────────────────────────────
console.log("== A. motivo da recusa: navegador de antes x servidor de agora");

/**
 * O QUE O NAVEGADOR FAZIA, copiado de `deleteBoletoFromBankViaN8n` como estava
 * até 07/10/2026 (nfe.service.ts). Devolve o motivo que ia para a tela e para
 * `titulo-inativo-no-banco`, `null` quando era sucesso, ou a exceção.
 */
function motivoComoONavegadorMontava(resposta: { ok: boolean; statusText: string; texto: string }): { recusa: string } | { sucesso: true } | { excecao: string } {
  if (!resposta.ok) {
    const errorText = resposta.texto;
    let legivel = "";
    try {
      legivel = mensagemDoRetornoBancario(JSON.parse(errorText), "");
    } catch {
      legivel = "";
    }
    return { recusa: legivel || errorText || `Erro no processamento da exclusão do boleto: ${resposta.statusText}` };
  }
  let resData;
  try {
    resData = JSON.parse(resposta.texto);
  } catch {
    return { excecao: "A resposta do servidor não é um JSON válido." };
  }
  if (!resData) return { excecao: "Resposta do banco vazia ou inválida." };
  if (resData.error || resData.message || resData.status === "error" || resData.success === false) {
    return { recusa: mensagemDoRetornoBancario(resData.error ?? resData.message, "Erro retornado pelo webhook.") };
  }
  return { sucesso: true };
}

/** Só o campo de motivo da execução 133090 do n8n (01/10/2026), a única recusa do C6 guardada. */
const MOTIVO_REAL_133090 =
  "O C6 recusou o cancelamento: [BoletoClient]: Evento não pode ser realizado, pois já existe uma requisição à CIP sujeita a aprovação.";
/** Redação do C6 para título inativo, a registrada em `recusa-bancaria.ts`, com o prefixo que o n8n põe. */
const MOTIVO_INATIVO = "O C6 recusou o cancelamento: Titulo esta em situacao que nao permite a operacao solicitada.";

const RESPOSTAS: Array<{ nome: string; resposta: { ok: boolean; statusText: string; texto: string }; inativo?: boolean }> = [
  { nome: "recusa REAL do C6 (execucao 133090): requisicao a CIP pendente", resposta: { ok: false, statusText: "Conflict", texto: JSON.stringify({ success: false, message: MOTIVO_REAL_133090 }) }, inativo: false },
  { nome: "recusa por titulo inativo (redacao do C6)", resposta: { ok: false, statusText: "Conflict", texto: JSON.stringify({ success: false, message: MOTIVO_INATIVO }) }, inativo: true },
  { nome: "recusa com acentos (variante prevista)", resposta: { ok: false, statusText: "Conflict", texto: JSON.stringify({ success: false, message: "O C6 recusou o cancelamento: Título está em situação que não permite a operação." }) }, inativo: true },
  { nome: "erro HTTP com texto cru, sem JSON", resposta: { ok: false, statusText: "Bad Gateway", texto: "upstream caiu" }, inativo: false },
  { nome: "erro HTTP com corpo vazio", resposta: { ok: false, statusText: "Internal Server Error", texto: "" }, inativo: false },
  { nome: "erro HTTP com objeto de erro cru do banco", resposta: { ok: false, statusText: "Bad Request", texto: JSON.stringify({ message: '400 - "{\\"title\\":\\"Regra\\",\\"detail\\":\\"Titulo esta em situacao que nao permite\\"}"' }) }, inativo: true },
  { nome: "200 com message", resposta: { ok: true, statusText: "OK", texto: JSON.stringify({ message: MOTIVO_INATIVO }) }, inativo: true },
  { nome: "200 com error em objeto", resposta: { ok: true, statusText: "OK", texto: JSON.stringify({ error: { message: "falha qualquer do banco" } }) }, inativo: false },
  { nome: "200 com success false e mais nada", resposta: { ok: true, statusText: "OK", texto: JSON.stringify({ success: false }) }, inativo: false },
  { nome: "200 de sucesso", resposta: { ok: true, statusText: "OK", texto: JSON.stringify({ success: true, cancelado: true, cod_C6: "C6-1" }) } },
  { nome: "200 que nao e JSON", resposta: { ok: true, statusText: "OK", texto: "<html>erro</html>" } },
  { nome: "200 com null", resposta: { ok: true, statusText: "OK", texto: "null" } }
];

for (const caso of RESPOSTAS) {
  const antes = motivoComoONavegadorMontava(caso.resposta);
  const agora = lerRespostaDoCancelamentoC6(caso.resposta);
  if ("recusa" in antes) {
    confere(`${caso.nome}: mesmo motivo, caractere a caractere`, agora.tipo === "RECUSA" && agora.motivo === antes.recusa, { antes, agora });
    const decideAgora = agora.tipo === "RECUSA" ? ehRecusaPorTituloInativo(agora.motivo) : null;
    confere(
      `${caso.nome}: titulo-inativo decide igual (${ehRecusaPorTituloInativo(antes.recusa) ? "inativo" : "nao e inatividade"})`,
      decideAgora === ehRecusaPorTituloInativo(antes.recusa) && decideAgora === caso.inativo,
      { antes: ehRecusaPorTituloInativo(antes.recusa), agora: decideAgora, esperado: caso.inativo }
    );
  } else if ("sucesso" in antes) {
    confere(`${caso.nome}: sucesso dos dois lados`, agora.tipo === "SUCESSO", agora);
  } else {
    confere(`${caso.nome}: invalida, com a mesma frase`, agora.tipo === "INVALIDA" && agora.mensagem === antes.excecao, { antes, agora });
  }
}
confere("o motivo real nao ganha prefixo nem corte", (() => {
  const lido = lerRespostaDoCancelamentoC6({ ok: false, statusText: "Conflict", texto: JSON.stringify({ success: false, message: MOTIVO_REAL_133090 }) });
  return lido.tipo === "RECUSA" && lido.motivo === MOTIVO_REAL_133090;
})());

// ── B. a rota ───────────────────────────────────────────────────────────────
console.log("== B. a rota, caso a caso");

const TITULO = {
  id: "b0000000-0000-0000-0000-000000000001",
  id_int: 22999,
  id_empresa: 1,
  id_pagamento: null,
  id_boleto_c6: "C6-DO-BANCO-123",
  status: "A_VENCER",
  paid_at: null,
  is_faturado: false
};

function prepararBanco(opcoes: { titulo?: Record<string, unknown> | null; superAdm?: boolean; permissoes?: string[]; pagamentos?: unknown[] } = {}) {
  falso.zerar();
  falso.responder("usuarios:select", { data: { is_super_adm: opcoes.superAdm ?? true, id_perfil: 2, is_admin: false }, error: null });
  falso.responder("perfis:select", { data: { permissoes: opcoes.permissoes ?? [] }, error: null });
  falso.responder("boletos:select", { data: opcoes.titulo === undefined ? TITULO : opcoes.titulo, error: null });
  falso.responder("pagamentos_v2:select", { data: opcoes.pagamentos ?? [], error: null });
}

type Chamada = { url: string; headers: Record<string, string>; body: string };
let chamadas: Chamada[] = [];
function fetchFalso(resposta: { status?: number; json?: unknown; texto?: string } | "REDE") {
  chamadas = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    chamadas.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") });
    if (resposta === "REDE") throw new TypeError("fetch failed");
    const corpo = resposta.texto ?? JSON.stringify(resposta.json ?? {});
    return new Response(corpo, { status: resposta.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

async function chamarRota(corpo: Record<string, unknown> = {}) {
  const requisicao = new Request("http://localhost/api/cobrancas/cancelar-boleto-faturado", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ boletoId: TITULO.id, motivo: "teste", ...corpo })
  });
  const resposta = await POST(requisicao);
  return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}
const aoC6 = () => chamadas.filter((c) => c.url === WEBHOOK_CANCELA_C6_FATURADO);
const escritas = () => falso.chamadas.filter((c) => c.op !== "select");

// sucesso
{
  process.env.N8N_WEBHOOK_SECRET = "segredo-de-teste";
  prepararBanco();
  fetchFalso({ json: { success: true, cancelado: true, cod_C6: "C6-DO-BANCO-123" } });
  // A tela manda dados FALSOS: a rota tem de ignorar e usar o que releu.
  const r = await chamarRota({ cod_C6: "CODIGO-DA-TELA", id_empresa: 3, idBoletoC6: "OUTRO" });
  confere("sucesso: 200 com canceladoNoC6 e o corpo do n8n em data", r.status === 200 && igual(r.corpo, { success: true, canceladoNoC6: true, data: { success: true, cancelado: true, cod_C6: "C6-DO-BANCO-123" } }), r);
  confere("sucesso: a rota NAO devolve delegarLegado", !("delegarLegado" in r.corpo));
  confere("sucesso: UMA chamada, ao del-boleto-vibe", chamadas.length === 1 && aoC6().length === 1, chamadas.map((c) => c.url));
  confere("sucesso: corpo com os dados RELIDOS do titulo, e nao os da tela", aoC6()[0]?.body === JSON.stringify({ boleto_id: TITULO.id, cod_C6: "C6-DO-BANCO-123", id_empresa: 1 }), aoC6()[0]?.body);
  confere("sucesso: id_empresa vai como NUMERO", typeof JSON.parse(aoC6()[0].body).id_empresa === "number");
  confere("sucesso: o cabecalho do segredo vai", aoC6()[0]?.headers["x-vibe-webhook-secret"] === "segredo-de-teste" && aoC6()[0]?.headers["Content-Type"] === "application/json", aoC6()[0]?.headers);
  confere("sucesso: a rota nao grava nada no banco de dados", escritas().length === 0, escritas());
}
{
  delete process.env.N8N_WEBHOOK_SECRET;
  prepararBanco({ titulo: { ...TITULO, id_empresa: 3 } });
  fetchFalso({ json: { success: true, cancelado: true, cod_C6: "C6-DO-BANCO-123" } });
  const r = await chamarRota();
  confere("empresa 3: tambem vai ao C6 pela rota, com id_empresa 3", r.status === 200 && JSON.parse(aoC6()[0].body).id_empresa === 3, aoC6()[0]?.body);
  confere("sem a variavel do segredo: a chamada sai sem o cabecalho (como o boletos-vibe)", !("x-vibe-webhook-secret" in aoC6()[0].headers));
  process.env.N8N_WEBHOOK_SECRET = "segredo-de-teste";
}

// recusa do banco
{
  prepararBanco();
  fetchFalso({ status: 409, json: { success: false, message: MOTIVO_REAL_133090 } });
  const r = await chamarRota();
  confere("recusa do banco (409 do n8n): 409 RECUSA_DO_BANCO com o motivo intacto", r.status === 409 && igual(r.corpo, { success: false, code: "RECUSA_DO_BANCO", message: MOTIVO_REAL_133090 }), r);
  confere("recusa do banco: nada gravado", escritas().length === 0);
}
{
  prepararBanco();
  fetchFalso({ status: 200, json: { message: MOTIVO_INATIVO } });
  const r = await chamarRota();
  confere("recusa do banco (200 com message): tambem RECUSA_DO_BANCO", r.status === 409 && r.corpo.code === "RECUSA_DO_BANCO" && r.corpo.message === MOTIVO_INATIVO, r);
  confere("recusa por titulo inativo: o texto que chega e reconhecido por titulo-inativo-no-banco", ehRecusaPorTituloInativo(String(r.corpo.message)) === true);
}

// titulo sem codigo do banco: comportamento de sempre
{
  prepararBanco({ titulo: { ...TITULO, id_boleto_c6: null } });
  fetchFalso({ status: 409, json: { success: false, message: "O C6 recusou o cancelamento: Not Found" } });
  const r = await chamarRota();
  confere("sem codigo do banco: a rota CHAMA o webhook, com cod_C6 vazio", aoC6().length === 1 && JSON.parse(aoC6()[0].body).cod_C6 === "", aoC6()[0]?.body);
  confere("sem codigo do banco: nenhum 400 novo; segue pela recusa do banco", r.status === 409 && r.corpo.code === "RECUSA_DO_BANCO", r);
}

// recusas que ficam ANTES do banco
{
  prepararBanco({ titulo: { ...TITULO, paid_at: "2026-10-01T12:00:00Z" } });
  fetchFalso({ json: { success: true } });
  const r = await chamarRota();
  confere("titulo ja pago (paid_at): 409 PAGAMENTO_QUITADO", r.status === 409 && r.corpo.code === "PAGAMENTO_QUITADO", r);
  confere("titulo ja pago: o banco NAO e chamado", chamadas.length === 0);
}
{
  prepararBanco({ titulo: { ...TITULO, status: "PAID" } });
  fetchFalso({ json: { success: true } });
  const r = await chamarRota();
  confere("titulo com status PAID: 409 PAGAMENTO_QUITADO, sem chamar o banco", r.status === 409 && r.corpo.code === "PAGAMENTO_QUITADO" && chamadas.length === 0, r);
}
{
  prepararBanco({ titulo: { ...TITULO, status: "CANCELADO" } });
  fetchFalso({ json: { success: true } });
  const r = await chamarRota();
  confere("titulo ja cancelado: 409, sem chamar o banco", r.status === 409 && chamadas.length === 0, r);
}
{
  prepararBanco({ titulo: null });
  fetchFalso({ json: { success: true } });
  const r = await chamarRota();
  confere("titulo inexistente: 404, sem chamar o banco", r.status === 404 && r.corpo.success === false && chamadas.length === 0, r);
}
{
  prepararBanco({ superAdm: false, permissoes: ["propostas.view"] });
  fetchFalso({ json: { success: true } });
  const r = await chamarRota();
  confere("sem permissao: 403, sem chamar o banco", r.status === 403 && chamadas.length === 0, r);
}
{
  prepararBanco({ superAdm: false, permissoes: ["cobrancas.cancel"] });
  fetchFalso({ json: { success: true, cancelado: true, cod_C6: "C6-DO-BANCO-123" } });
  const r = await chamarRota();
  confere("com cobrancas.cancel (sem ser super admin): passa e cancela", r.status === 200 && aoC6().length === 1, r);
}
{
  prepararBanco({
    titulo: { ...TITULO, is_faturado: true },
    pagamentos: [{ id: "p1", tipo_cobranca: "E-FATURADO" }, { id: "p2", tipo_cobranca: "E-FATURADO" }]
  });
  fetchFalso({ json: { success: true } });
  const r = await chamarRota();
  confere("vinculo ambiguo: 409 VINCULO_AMBIGUO, sem chamar o banco", r.status === 409 && r.corpo.code === "VINCULO_AMBIGUO" && chamadas.length === 0, r);
}

// rede, tempo e resposta invalida
{
  prepararBanco();
  fetchFalso("REDE");
  const r = await chamarRota();
  confere("erro de rede: 502 BANCO_INDISPONIVEL", r.status === 502 && r.corpo.code === "BANCO_INDISPONIVEL" && r.corpo.success === false, r);
  confere("erro de rede: uma tentativa so, sem repetir sozinho", chamadas.length === 1);
  confere("erro de rede: nada gravado", escritas().length === 0);
}
{
  prepararBanco();
  fetchFalso({ status: 200, texto: "<html>pagina de erro</html>" });
  const r = await chamarRota();
  confere("200 que nao e JSON: 502 RESPOSTA_INVALIDA", r.status === 502 && r.corpo.code === "RESPOSTA_INVALIDA", r);
}
{
  // Tempo esgotado: `fetch` que só termina quando o sinal aborta.
  let abortou = false;
  const lento = ((_url: string, init?: RequestInit) =>
    new Promise((_resolver, rejeitar) => {
      init?.signal?.addEventListener("abort", () => {
        abortou = true;
        rejeitar(new DOMException("aborted", "AbortError"));
      });
    })) as unknown as typeof fetch;
  const inicio = Date.now();
  const r = await cancelarTituloNoC6({ corpo: { id_empresa: 1 }, cabecalhos: {}, tempoLimiteMs: 40, buscar: lento });
  const levou = Date.now() - inicio;
  confere("tempo esgotado: a chamada e abortada no teto", abortou && levou < 2000, { abortou, levou });
  confere("tempo esgotado: INDISPONIVEL com tempoEsgotado", r.tipo === "INDISPONIVEL" && r.tempoEsgotado === true, r);
}
{
  // Corpo que começa e não termina também conta no teto.
  const semFim = (async (_url: string, init?: RequestInit) => ({
    ok: true,
    statusText: "OK",
    text: () => new Promise((_r, rejeitar) => init?.signal?.addEventListener("abort", () => rejeitar(new DOMException("aborted", "AbortError"))))
  })) as unknown as typeof fetch;
  const r = await cancelarTituloNoC6({ corpo: {}, cabecalhos: {}, tempoLimiteMs: 40, buscar: semFim });
  confere("resposta que nao termina: tambem vira INDISPONIVEL por tempo", r.tipo === "INDISPONIVEL" && r.tempoEsgotado === true, r);
}

// a Biro nao muda
{
  prepararBanco({ titulo: { ...TITULO, id_empresa: 2, id_boleto_c6: "INTER-1" } });
  fetchFalso({ json: { success: true, parcelas_ativas_restantes: 0 } });
  const r = await chamarRota();
  confere("Biro (empresa 2): continua no webhook do Inter, e nao no del-boleto-vibe", chamadas.length === 1 && chamadas[0].url.endsWith("/webhook/cancela-boleto-fat-inter") && aoC6().length === 0, chamadas.map((c) => c.url));
  confere("Biro: resposta de sempre, sem canceladoNoC6", r.status === 200 && r.corpo.success === true && !("canceladoNoC6" in r.corpo) && "diagnosticoWebhook" in r.corpo, r);
}
{
  prepararBanco({ titulo: { ...TITULO, id_empresa: 2, id_boleto_c6: null } });
  fetchFalso({ json: { success: true } });
  const r = await chamarRota();
  confere("Biro sem codigo do banco: o 400 de sempre continua", r.status === 400 && chamadas.length === 0, r);
}

// ── C. o navegador ──────────────────────────────────────────────────────────
console.log("== C. o que o navegador faz com cada resposta");
{
  const sucesso = { success: true, canceladoNoC6: true, data: { success: true, cancelado: true, cod_C6: "X" } };
  confere("sucesso (C6): devolve o corpo do n8n, como antes", igual(destinoDaRespostaDoCancelamento({ ok: true, resultado: sucesso }), { acao: "SUCESSO", data: sucesso.data }));
  const biro = { success: true, boletoExcluido: true, cobrancaReativada: true };
  confere("sucesso (Biro): devolve a resposta da rota, com cobrancaReativada", igual(destinoDaRespostaDoCancelamento({ ok: true, resultado: biro }), { acao: "SUCESSO", data: biro }));

  const recusa = { success: false, code: "RECUSA_DO_BANCO", message: MOTIVO_INATIVO };
  confere("recusa do banco, telas comuns: relata a titulo-inativo-no-banco com o motivo intacto", igual(destinoDaRespostaDoCancelamento({ ok: false, resultado: recusa }), { acao: "RELATAR_RECUSA", motivo: MOTIVO_INATIVO }));
  confere("recusa do banco, Refazer boleto (semBaixaLocal): so lanca o motivo, sem relato", igual(destinoDaRespostaDoCancelamento({ ok: false, resultado: recusa }, { semBaixaLocal: true }), { acao: "LANCAR", mensagem: MOTIVO_INATIVO }));
  confere("recusa real (CIP): chega igual nos dois caminhos", igual(destinoDaRespostaDoCancelamento({ ok: false, resultado: { ...recusa, message: MOTIVO_REAL_133090 } }), { acao: "RELATAR_RECUSA", motivo: MOTIVO_REAL_133090 }));

  const outras: Array<[string, Record<string, unknown> | null, string]> = [
    ["titulo ja pago", { success: false, code: "PAGAMENTO_QUITADO", message: "Título já liquidado. Cancelamento não permitido." }, "Título já liquidado. Cancelamento não permitido."],
    ["vinculo ambiguo", { success: false, code: "VINCULO_AMBIGUO", message: "ambiguo" }, "ambiguo"],
    ["titulo inexistente", { success: false, message: "Título não encontrado ou fora do escopo de acesso do usuário." }, "Título não encontrado ou fora do escopo de acesso do usuário."],
    ["sem permissao", { success: false, message: "Sem permissão para cancelar título (cobrancas.cancel)." }, "Sem permissão para cancelar título (cobrancas.cancel)."],
    ["banco indisponivel", { success: false, code: "BANCO_INDISPONIVEL", message: "sem resposta" }, "sem resposta"],
    ["resposta invalida", { success: false, code: "RESPOSTA_INVALIDA", message: "A resposta do servidor não é um JSON válido." }, "A resposta do servidor não é um JSON válido."],
    ["resposta da rota ilegivel", null, "Falha na operação bancária do título faturado."]
  ];
  for (const [nome, resultado, mensagem] of outras) {
    const comum = destinoDaRespostaDoCancelamento({ ok: false, resultado });
    const refazer = destinoDaRespostaDoCancelamento({ ok: false, resultado }, { semBaixaLocal: true });
    confere(`${nome}: erro simples, sem relato e sem baixa (nos dois modos)`, igual(comum, { acao: "LANCAR", mensagem }) && igual(refazer, comum), { comum, refazer });
  }

  const antigo = destinoDaRespostaDoCancelamento({ ok: true, resultado: { success: true, delegarLegado: true, idEmpresa: 1 } });
  confere("servidor ANTIGO respondendo delegarLegado: vira erro, nao sucesso (nao da baixa sem cancelar no banco)", antigo.acao === "LANCAR" && /recarregue/i.test(antigo.acao === "LANCAR" ? antigo.mensagem : ""), antigo);

  const acoes = new Set<string>();
  for (const ok of [true, false]) {
    for (const resultado of [null, {}, { success: true }, { success: true, delegarLegado: true }, { success: true, canceladoNoC6: true }, { success: false }, { success: false, code: "RECUSA_DO_BANCO" }, { success: false, code: "RECUSA_DO_BANCO", message: "x" }]) {
      for (const semBaixaLocal of [true, false]) acoes.add(destinoDaRespostaDoCancelamento({ ok, resultado }, { semBaixaLocal }).acao);
    }
  }
  confere("nenhuma resposta manda o navegador chamar o banco: so SUCESSO, LANCAR ou RELATAR_RECUSA", igual([...acoes].sort(), ["LANCAR", "RELATAR_RECUSA", "SUCESSO"]), [...acoes]);
  confere("recusa do banco sem motivo: frase padrao, nunca texto vazio", igual(destinoDaRespostaDoCancelamento({ ok: false, resultado: { success: false, code: "RECUSA_DO_BANCO", message: "  " } }), { acao: "RELATAR_RECUSA", motivo: "Falha na operação bancária do título faturado." }));
}

// o codigo do navegador nao cita mais o webhook
{
  const raiz = path.join(AQUI, "..", "..");
  const servico = readFileSync(path.join(raiz, "src/features/nfe/services/nfe.service.ts"), "utf8");
  const semComentarios = servico.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  confere("nfe.service.ts: nenhuma chamada ao webhook del-boleto-vibe fora de comentario", !semComentarios.includes("del-boleto-vibe"));
  confere("nfe.service.ts: nao trata mais delegarLegado como caminho", !/roteamento\.delegarLegado|if\s*\(\s*!?\w+\.delegarLegado/.test(semComentarios));

  const rota = readFileSync(path.join(raiz, "src/app/api/cobrancas/cancelar-boleto-faturado/route.ts"), "utf8");
  const rotaSemComentarios = rota.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  confere("rota: nao devolve mais delegarLegado", !rotaSemComentarios.includes("delegarLegado"));
  confere("rota: maxDuration de 60 s declarado", /export const maxDuration = 60;/.test(rota));

  // ── D. teto e rota de prova ───────────────────────────────────────────────
  console.log("== D. teto de tempo e rota de prova");
  confere("teto da chamada ao n8n: 25 s", TEMPO_LIMITE_CANCELAMENTO_C6_MS === 25000, TEMPO_LIMITE_CANCELAMENTO_C6_MS);
  confere("o teto da chamada fica abaixo do maxDuration da rota", TEMPO_LIMITE_CANCELAMENTO_C6_MS < 60000);
  const prova = readFileSync(path.join(raiz, "src/app/api/admin/n8n-segredo-prova/route.ts"), "utf8");
  confere(
    "rota de prova: del-boleto-vibe com id_empresa 0 (numero) e sem cod_C6 nem boleto_id",
    /\{ caminho: "del-boleto-vibe", corpo: \{ id_empresa: 0, prova: PROVA \} \}/.test(prova),
  );
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
