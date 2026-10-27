/**
 * Cancelamento de NF-e: CANCELADA só quando a SEFAZ confirma (27/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/cancelamento-nfe.test.mts
 *
 * SEM banco, SEM n8n e SEM Focus: cliente Supabase falso e `fetch` falso.
 *   A. a decisão com os retornos REAIS gravados em notas_eventos
 *      (fixtures/cancelamento-nfe-retornos-reais.json: 14 cancelados, 3 "autorizado");
 *   B. os embrulhos que o webhook pode devolver e as respostas que não confirmam;
 *   C. o prazo de 24 h pela data de autorização;
 *   D. a linha de notas_eventos (confirmado x falha) e quem a lê;
 *   E. a rota POST /api/fiscal/cancelar-nfe até a chamada do webhook simulado.
 */
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const url = (arquivo: string) => pathToFileURL(path.join(AQUI, arquivo)).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: url("_supabase-js-falso-com-tipos.mts"), shortCircuit: true };
    if (especificador === "next/server") return { url: url("_next-server-falso-com-tipos.mts"), shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { falso } = await import("./_supabase-falso.mts");
const {
  PRAZO_CANCELAMENTO_HORAS,
  STATUS_EVENTO_FALHA,
  desfechoDoCancelamento,
  montarEventoCancelamento,
  prazoDoCancelamento,
  retornoDaFocus
} = await import("../../src/lib/fiscal/cancelamento-nfe.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

type Linha = { gravado_em: string; retorno: Record<string, unknown> };
const REAIS = JSON.parse(readFileSync(path.join(AQUI, "fixtures", "cancelamento-nfe-retornos-reais.json"), "utf8")) as {
  sucessos: Linha[];
  autorizados: Linha[];
};

// ── A. retornos reais ───────────────────────────────────────────────────────
console.log("== A. retornos reais gravados");
confere("fixture tem 14 cancelamentos confirmados", REAIS.sucessos.length === 14, REAIS.sucessos.length);
confere("fixture tem os 3 'autorizado' de outubro", REAIS.autorizados.length === 3 &&
  ["NFE-23138-001", "NFE-23564-002", "NFE-23702-001"].every((r) => REAIS.autorizados.some((l) => l.retorno.ref === r)),
  REAIS.autorizados.map((l) => l.retorno.ref));
for (const l of REAIS.sucessos) {
  const d = desfechoDoCancelamento(l.retorno);
  confere(`${l.retorno.ref} (${l.gravado_em}) cancelado/135 com XML -> CONFIRMADO`, d.confirmado === true && d.statusSefaz === "135", d);
}
for (const l of REAIS.autorizados) {
  const d = desfechoDoCancelamento(l.retorno);
  confere(`${l.retorno.ref} (${l.gravado_em}) autorizado/100 -> NAO confirmado`, d.confirmado === false, d);
  if (!d.confirmado) {
    confere(`${l.retorno.ref}: mensagem diz que continua AUTORIZADA e mostra o que a Focus disse`,
      /continua AUTORIZADA/.test(d.mensagem) && /autorizado/.test(d.mensagem) && /100/.test(d.mensagem) && /Autorizado o uso/.test(d.mensagem), d.mensagem);
  }
}

// ── B. embrulhos e respostas que não confirmam ─────────────────────────────
console.log("== B. embrulhos do webhook e respostas que nao confirmam");
const OK = REAIS.sucessos[REAIS.sucessos.length - 1].retorno;
const RECUSA = REAIS.autorizados[0].retorno;
const embrulhos: Array<[string, (o: unknown) => unknown]> = [
  ["objeto puro", (o) => o],
  ["{ data: texto JSON } (consulta do n8n em modo texto)", (o) => ({ data: JSON.stringify(o) })],
  ["lista com um item", (o) => [o]],
  ["lista com { data: texto }", (o) => [{ data: JSON.stringify(o) }]],
  ["{ body: objeto }", (o) => ({ body: o })],
  ["{ body: { payload_retorno } }", (o) => ({ body: { payload_retorno: o } })],
  ["texto JSON", (o) => JSON.stringify(o)],
  ["{ data: objeto }", (o) => ({ data: o })]
];
for (const [nome, embrulhar] of embrulhos) {
  confere(`${nome}: cancelado -> CONFIRMADO`, desfechoDoCancelamento(embrulhar(OK)).confirmado === true);
  confere(`${nome}: autorizado -> NAO confirmado`, desfechoDoCancelamento(embrulhar(RECUSA)).confirmado === false);
}
const caso = (o: unknown) => desfechoDoCancelamento(o);
confere("cancelado/135 SEM caminho do XML -> NAO", caso({ ...OK, caminho_xml_cancelamento: null }).confirmado === false);
confere("cancelado/135 com caminho vazio -> NAO", caso({ ...OK, caminho_xml_cancelamento: "  " }).confirmado === false);
{
  const d = caso({ ...OK, caminho_xml_cancelamento: undefined });
  confere("cancelado sem XML: a mensagem diz que falta o XML", !d.confirmado && /sem o XML/.test(d.mensagem), d);
}
confere("cancelado com cStat 100 -> NAO", caso({ ...OK, status_sefaz: "100" }).confirmado === false);
confere("cancelado sem cStat -> NAO", caso({ ...OK, status_sefaz: null }).confirmado === false);
confere("cancelado com cStat 155 (homologado fora de prazo) -> CONFIRMADO", caso({ ...OK, status_sefaz: "155" }).confirmado === true);
confere("cStat numerico 135 -> CONFIRMADO", caso({ ...OK, status_sefaz: 135 }).confirmado === true);
confere("cStat so em codigo_status_sefaz -> CONFIRMADO", caso({ ...OK, status_sefaz: undefined, codigo_status_sefaz: "135" }).confirmado === true);
confere("status 'Cancelado' maiusculo -> CONFIRMADO", caso({ ...OK, status: "Cancelado" }).confirmado === true);
{
  const d = caso({ status: "erro_cancelamento", status_sefaz: "501", mensagem_sefaz: "Rejeicao: Prazo de Cancelamento Superior ao Previsto na Legislacao" });
  confere("erro_cancelamento -> NAO, com a mensagem da SEFAZ", !d.confirmado && /Prazo de Cancelamento Superior/.test(d.mensagem) && /501/.test(d.mensagem), d);
}
confere("processando_autorizacao -> NAO", caso({ status: "processando_autorizacao" }).confirmado === false);
for (const vazio of [null, undefined, "", "=[object Object]", {}, [], { success: true }]) {
  const d = caso(vazio);
  confere(`sem resultado (${JSON.stringify(vazio) ?? "undefined"}) -> NAO, e diz que nao veio resultado`, !d.confirmado && /n[aã]o devolveu o resultado/.test(d.mensagem), d);
}
confere("retornoDaFocus nao inventa objeto de texto solto", retornoDaFocus("erro qualquer") === null);

// ── C. prazo ────────────────────────────────────────────────────────────────
console.log("== C. prazo de 24 h");
const agora = new Date("2026-10-27T15:00:00Z");
const horasAntes = (h: number) => new Date(agora.getTime() - h * 3600_000).toISOString();
confere("prazo e de 24 h", PRAZO_CANCELAMENTO_HORAS === 24);
confere("autorizada ha 1 h -> dentro", prazoDoCancelamento(horasAntes(1), agora).dentro === true);
confere("autorizada ha 23h59 -> dentro", prazoDoCancelamento(horasAntes(23 + 59 / 60), agora).dentro === true);
{
  const p = prazoDoCancelamento(horasAntes(24), agora);
  confere("autorizada ha exatamente 24 h -> fora", !p.dentro && p.motivo === "FORA_DO_PRAZO" && /contabilidade/.test(p.mensagem), p);
}
{
  // NFE-23138-001: autorizada 09/10 11:42, cancelamento pedido 14/10 13:15 (horario de Brasilia).
  const p = prazoDoCancelamento("2026-10-09T14:42:00+00:00", new Date("2026-10-14T16:15:00Z"));
  confere("caso real 23138 (5 dias depois) -> fora do prazo", !p.dentro && p.motivo === "FORA_DO_PRAZO", p);
}
for (const sem of [null, undefined, "", "lixo"]) {
  const p = prazoDoCancelamento(sem as string | null, agora);
  confere(`sem data de autorizacao (${JSON.stringify(sem) ?? "undefined"}) -> fechado, orienta contabilidade`, !p.dentro && p.motivo === "SEM_DATA_AUTORIZACAO" && /contabilidade/.test(p.mensagem), p);
}

// ── D. o evento ─────────────────────────────────────────────────────────────
console.log("== D. linha de notas_eventos");
const evOk = montarEventoCancelamento({ ref: "NFE-1-001", idEmpresa: 1, justificativa: "justificativa de teste longa", desfecho: desfechoDoCancelamento(OK), criadoPor: "u1", criadoPorNome: "Teste" });
const evFalha = montarEventoCancelamento({ ref: "NFE-1-001", idEmpresa: 1, justificativa: "justificativa de teste longa", desfecho: desfechoDoCancelamento(RECUSA), criadoPor: "u1", criadoPorNome: "Teste" });
const evRede = montarEventoCancelamento({ ref: "NFE-1-001", idEmpresa: 1, justificativa: "justificativa de teste longa", desfecho: desfechoDoCancelamento(null), respostaSemCorpo: { motivo: "Integração fiscal inacessível." }, criadoPor: "u1", criadoPorNome: "Teste" });
confere("confirmado: status_evento 'cancelado', cStat e caminho do XML", evOk.status_evento === "cancelado" && evOk.status_sefaz === "135" && evOk.caminho_xml === OK.caminho_xml_cancelamento && evOk.origem === "FOCUS_CANCELAMENTO", evOk);
confere("falha: status_evento 'falha', sem caminho, com o que a Focus disse", evFalha.status_evento === STATUS_EVENTO_FALHA && evFalha.caminho_xml === null && evFalha.status_sefaz === "100" && evFalha.payload_retorno?.status === "autorizado", evFalha);
confere("falha de rede: 'falha' com o motivo registrado", evRede.status_evento === "falha" && evRede.mensagem_sefaz === "Integração fiscal inacessível." && (evRede.payload_retorno as Record<string, unknown>)?.erro_integracao === "Integração fiscal inacessível.", evRede);
// Os dois leitores de evento de cancelamento: o relatório (rpc_relatorio_notas_fiscais)
// so conta status_evento = 'cancelado'; o fluxo de copia do XML so le 'cancelado'/'autorizado'.
const relatorioConta = (e: { status_evento: string }) => e.status_evento === "cancelado";
const copiaLe = (e: { status_evento: string }) => ["cancelado", "autorizado"].includes(e.status_evento);
confere("relatorio conta o confirmado e ignora a falha", relatorioConta(evOk) && !relatorioConta(evFalha) && !relatorioConta(evRede));
confere("fluxo de copia do XML le o confirmado e ignora a falha", copiaLe(evOk) && !copiaLe(evFalha) && !copiaLe(evRede));
confere("payload_envio e o corpo de sempre do webhook", JSON.stringify(evOk.payload_envio) === JSON.stringify({ id_empresa: 1, referencia: "NFE-1-001", justificativa: "justificativa de teste longa" }));

// ── E. a rota ───────────────────────────────────────────────────────────────
console.log("== E. a rota de cancelar");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.N8N_WEBHOOK_SECRET = "segredo-de-teste";
const { POST } = await import("../../src/app/api/fiscal/cancelar-nfe/route.ts");
const WEBHOOK = "https://10074.hostoo.net.br/webhook/cancelamento";

const NOTA = {
  id: "n0000000-0000-0000-0000-000000000001",
  ref: "NFE-99999-001",
  status: "AUTORIZADA",
  id_empresa: 1,
  data_cancelamento: null as string | null,
  data_autorizacao: new Date(Date.now() - 2 * 3600_000).toISOString() as string | null
};
type Resp = { data: unknown; error: { message: string } | null };
const R = (data: unknown, error: Resp["error"] = null): Resp => ({ data, error });

function prepararBanco(nota: Record<string, unknown>, opcoes: { eventoCancelado?: boolean; reservaCasa?: boolean; finalCasa?: boolean } = {}) {
  falso.zerar();
  falso.responder("usuarios:select", R({ id_perfil: null, is_super_adm: true, is_admin: true }));
  falso.responder("notas_fiscais:select", R(nota));
  falso.responder("notas_eventos:select", R(opcoes.eventoCancelado ? [{ id: "ev1" }] : []));
  falso.responder("notas_eventos:insert", R(null));
  // updates em ordem: reserva, (liberacao ou marcacao final)
  falso.responderEmSequencia("notas_fiscais:update", [
    R(opcoes.reservaCasa === false ? [] : [{ id: nota.id }]),
    R(opcoes.finalCasa === false ? [] : [{ id: nota.id }])
  ]);
}

type ChamadaWebhook = { url: string; headers: Record<string, string>; body: string };
let aoWebhook: ChamadaWebhook[] = [];
function webhookFalso(resposta: { status?: number; corpo?: unknown } | "REDE") {
  aoWebhook = [];
  globalThis.fetch = (async (u: string, init?: RequestInit) => {
    aoWebhook.push({ url: String(u), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") });
    if (resposta === "REDE") throw new TypeError("fetch failed");
    const texto = typeof resposta.corpo === "string" ? resposta.corpo : JSON.stringify(resposta.corpo ?? {});
    return new Response(texto, { status: resposta.status ?? 200 });
  }) as typeof fetch;
}

const JUSTIFICATIVA = "Pedido cancelado pelo cliente antes do envio";
async function cancelar(nota: Record<string, unknown>, opcoes: Parameters<typeof prepararBanco>[1] = {}) {
  prepararBanco(nota, opcoes);
  const resposta = await POST(new Request("http://localhost/api/fiscal/cancelar-nfe", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ ref: nota.ref, justificativa: JUSTIFICATIVA })
  }));
  const corpo = (await resposta.json()) as Record<string, unknown>;
  const updates = falso.chamadas.filter((c) => c.tabela === "notas_fiscais" && c.op === "update");
  const marcouCancelada = updates.some((c) => (c.payload as Record<string, unknown>)?.status === "CANCELADA");
  const eventos = falso.chamadas.filter((c) => c.tabela === "notas_eventos" && c.op === "insert").map((c) => c.payload as Record<string, unknown>);
  const escritas = falso.chamadas.filter((c) => c.op !== "select");
  return { status: resposta.status, corpo, updates, marcouCancelada, eventos, escritas, webhook: aoWebhook.filter((c) => c.url === WEBHOOK) };
}
const temFiltro = (c: { filtros: [string, unknown][] }, coluna: string, valor: unknown) =>
  c.filtros.some(([f, a]) => f === "eq" && Array.isArray(a) && a[0] === coluna && a[1] === valor);

// 1. confirmado
{
  webhookFalso({ corpo: { data: JSON.stringify(OK) } });
  const r = await cancelar({ ...NOTA });
  const reserva = r.updates[0];
  const marca = (reserva?.payload as Record<string, unknown>)?.data_cancelamento;
  const final = r.updates[1];
  confere("CONFIRMADO: 200, success, nota marcada", r.status === 200 && r.corpo.success === true && r.corpo.notaAtualizada === true && r.marcouCancelada, r.corpo);
  confere("CONFIRMADO: uma chamada ao webhook, com o corpo de sempre e o segredo",
    r.webhook.length === 1 && JSON.stringify(JSON.parse(r.webhook[0].body)) === JSON.stringify({ id_empresa: 1, referencia: NOTA.ref, justificativa: JUSTIFICATIVA }) && r.webhook[0].headers["x-vibe-webhook-secret"] === "segredo-de-teste",
    r.webhook);
  confere("trava da reserva: so casa AUTORIZADA e data_cancelamento nula",
    temFiltro(reserva, "status", "AUTORIZADA") && reserva.filtros.some(([f, a]) => f === "is" && Array.isArray(a) && a[0] === "data_cancelamento" && a[1] === null), reserva?.filtros);
  confere("trava do UPDATE final: so casa AUTORIZADA e a PROPRIA reserva",
    temFiltro(final, "id", NOTA.id) && temFiltro(final, "status", "AUTORIZADA") && typeof marca === "string" && temFiltro(final, "data_cancelamento", marca), final?.filtros);
  const p = final.payload as Record<string, unknown>;
  confere("UPDATE final grava o que a Focus confirmou e a autoria", p.status === "CANCELADA" && p.status_focus === "cancelado" && p.status_sefaz === "135" && p.cancelado_por === "usuario-de-teste" && (p.payload_retorno as Record<string, unknown>)?.caminho_xml_cancelamento === OK.caminho_xml_cancelamento, p);
  confere("CONFIRMADO: um evento 'cancelado' com o caminho do XML", r.eventos.length === 1 && r.eventos[0].status_evento === "cancelado" && r.eventos[0].caminho_xml === OK.caminho_xml_cancelamento, r.eventos);
  confere("a resposta nao carrega mais o corpo cru do webhook", !("retorno" in r.corpo));
}
// 2. os 3 casos reais "autorizado"
for (const l of REAIS.autorizados) {
  webhookFalso({ corpo: { data: JSON.stringify(l.retorno) } });
  const r = await cancelar({ ...NOTA, ref: l.retorno.ref });
  const liberacao = r.updates[1];
  confere(`${l.retorno.ref} real: 422, nota NAO vira CANCELADA`, r.status === 422 && r.corpo.success === false && r.corpo.code === "CANCELAMENTO_NAO_CONFIRMADO" && !r.marcouCancelada, r.corpo);
  confere(`${l.retorno.ref} real: status e mensagem da Focus na resposta`, r.corpo.status_focus === "autorizado" && r.corpo.status_sefaz === "100" && /continua AUTORIZADA/.test(String(r.corpo.message)), r.corpo);
  confere(`${l.retorno.ref} real: reserva liberada (so a propria)`,
    (liberacao?.payload as Record<string, unknown>)?.data_cancelamento === null && temFiltro(liberacao, "status", "AUTORIZADA") && temFiltro(liberacao, "data_cancelamento", (r.updates[0].payload as Record<string, unknown>).data_cancelamento),
    liberacao);
  confere(`${l.retorno.ref} real: um evento gravado como 'falha', sem caminho`, r.eventos.length === 1 && r.eventos[0].status_evento === "falha" && r.eventos[0].caminho_xml === null, r.eventos);
}
// 3. rejeicao da SEFAZ
{
  webhookFalso({ corpo: { status: "erro_cancelamento", status_sefaz: "501", mensagem_sefaz: "Rejeicao: Prazo de Cancelamento Superior ao Previsto na Legislacao" } });
  const r = await cancelar({ ...NOTA });
  confere("REJEICAO: 422, motivo da SEFAZ na mensagem, evento falha", r.status === 422 && /Prazo de Cancelamento Superior/.test(String(r.corpo.message)) && !r.marcouCancelada && r.eventos[0]?.status_evento === "falha", r.corpo);
}
// 4. fora do prazo / sem data
{
  webhookFalso({ corpo: OK });
  const r = await cancelar({ ...NOTA, data_autorizacao: new Date(Date.now() - 25 * 3600_000).toISOString() });
  confere("FORA DO PRAZO: 422, nada enviado a Focus, nada gravado", r.status === 422 && r.corpo.code === "FORA_DO_PRAZO" && r.webhook.length === 0 && r.escritas.length === 0 && /contabilidade/.test(String(r.corpo.message)), r.corpo);
}
{
  webhookFalso({ corpo: OK });
  const r = await cancelar({ ...NOTA, data_autorizacao: null });
  confere("SEM DATA DE AUTORIZACAO: 422, nada enviado, nada gravado", r.status === 422 && r.corpo.code === "SEM_DATA_AUTORIZACAO" && r.webhook.length === 0 && r.escritas.length === 0, r.corpo);
}
// 5. idempotencia
{
  webhookFalso({ corpo: OK });
  const r = await cancelar({ ...NOTA }, { eventoCancelado: true });
  confere("JA EXISTE evento 'cancelado': 409, nada enviado, nenhum segundo evento", r.status === 409 && r.corpo.code === "CANCELAMENTO_JA_CONFIRMADO" && r.webhook.length === 0 && r.escritas.length === 0, r.corpo);
  const busca = falso.chamadas.find((c) => c.tabela === "notas_eventos" && c.op === "select");
  confere("a busca do evento olha ref, CANCELAMENTO e status 'cancelado'", !!busca && temFiltro(busca, "ref", NOTA.ref) && temFiltro(busca, "tipo_evento", "CANCELAMENTO") && temFiltro(busca, "status_evento", "cancelado"), busca?.filtros);
}
{
  webhookFalso({ corpo: OK });
  const r = await cancelar({ ...NOTA }, { reservaCasa: false });
  confere("CLIQUE CONCORRENTE (reserva nao casa): 409, nada enviado", r.status === 409 && r.corpo.code === "CANCELAMENTO_EM_ANDAMENTO" && r.webhook.length === 0 && r.eventos.length === 0, r.corpo);
}
{
  webhookFalso({ corpo: OK });
  const r = await cancelar({ ...NOTA, status: "CANCELADA" });
  confere("nota ja CANCELADA: 409, nada enviado", r.status === 409 && r.webhook.length === 0 && r.escritas.length === 0, r.corpo);
}
{
  webhookFalso({ corpo: OK });
  const r = await cancelar({ ...NOTA, data_cancelamento: "2026-10-27T10:00:00Z" });
  confere("reserva de outra chamada em aberto: 409, nada enviado", r.status === 409 && r.webhook.length === 0 && r.escritas.length === 0, r.corpo);
}
// 6. falhas de transporte
{
  webhookFalso({ status: 500, corpo: { message: "Workflow falhou" } });
  const r = await cancelar({ ...NOTA });
  confere("HTTP 500 do webhook: 502, nota AUTORIZADA, reserva liberada, evento falha", r.status === 502 && !r.marcouCancelada && (r.updates[1]?.payload as Record<string, unknown>)?.data_cancelamento === null && r.eventos[0]?.status_evento === "falha" && /continua AUTORIZADA/.test(String(r.corpo.message)), r.corpo);
}
{
  webhookFalso("REDE");
  const r = await cancelar({ ...NOTA });
  confere("REDE: 502, nota AUTORIZADA, reserva liberada, evento falha", r.status === 502 && !r.marcouCancelada && (r.updates[1]?.payload as Record<string, unknown>)?.data_cancelamento === null && r.eventos[0]?.status_evento === "falha", r.corpo);
}
// 7. confirmado, mas a nota mudou no meio
{
  webhookFalso({ corpo: OK });
  const r = await cancelar({ ...NOTA }, { finalCasa: false });
  confere("CONFIRMADO mas o UPDATE nao casou: 200 com aviso, evento 'cancelado' gravado igual", r.status === 200 && r.corpo.success === true && r.corpo.notaAtualizada === false && /Recarregue/.test(String(r.corpo.message)) && r.eventos[0]?.status_evento === "cancelado", r.corpo);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
