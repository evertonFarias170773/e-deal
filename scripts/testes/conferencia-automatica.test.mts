/**
 * Conferência automática — Fase 2 (16/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/conferencia-automatica.test.mts
 *
 * SEM banco: cliente Supabase falso, que só anota o que foi pedido.
 *   A. quem entra e quem fica para o financeiro;
 *   B. a varredura nos três modos (desligado, sombra, ligado), idempotência e
 *      falha de uma cobrança que não para as outras;
 *   C. a rota: segredo ausente, errado e certo; modo desligado não lê o banco.
 * O clique manual é provado pelos testes da rota de confirmar, que rodam junto.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FALSO_JS = pathToFileURL(path.join(AQUI, "_supabase-js-falso-com-tipos.mts")).href;
const FALSO_NEXT = pathToFileURL(path.join(AQUI, "_next-server-falso-com-tipos.mts")).href;
const FALSO_CLIENTE = pathToFileURL(path.join(AQUI, "_supabase-falso.mts")).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: FALSO_JS, shortCircuit: true };
    if (especificador === "next/server") return { url: FALSO_NEXT, shortCircuit: true };
    if (especificador === "@/lib/supabase/client") return { url: FALSO_CLIENTE, shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { falso, getSupabaseClient } = await import("./_supabase-falso.mts");
const auto = await import("../../src/features/cobrancas/services/conferencia-automatica.server.ts");
const {
  AUTOR_CONFERENCIA_AUTOMATICA,
  lerModoConferenciaAutomatica,
  motivoParaFicarManual,
  temAbatimentoDeContaCorrente,
  varrerConferenciaAutomatica
} = auto;

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

const BASE = {
  id: "c0000000-0000-0000-0000-000000000001",
  id_pagamento: "23900-A",
  id_int: 23900,
  id_cliente: 14,
  tipo_cobranca: "PIX",
  status: "PAID",
  confirmado: false,
  motivo_cancela: null as string | null,
  reserva_estado: null as string | null,
  id_pendencia: null as number | null,
  chave_reserva: null as string | null,
  obs_v2: null as string | null,
  paid_at: "2026-10-16T21:00:00Z"
};

// ── A. quem entra ───────────────────────────────────────────────────────────
console.log("== A. quem entra e quem fica para o financeiro");
confere("modo padrao (vazio ou desconhecido) e desligado", lerModoConferenciaAutomatica(undefined) === "desligado" && lerModoConferenciaAutomatica("sim") === "desligado");
confere("modos sombra e ligado sao lidos", lerModoConferenciaAutomatica(" Sombra ") === "sombra" && lerModoConferenciaAutomatica("ligado") === "ligado");
for (const forma of ["PIX", "BOLETO", "CARD_PARCELADO", "E-CREDITO"]) {
  confere(`${forma} pago, marca false, sem abatimento: segue para a quitacao`, motivoParaFicarManual({ ...BASE, tipo_cobranca: forma }, false) === null);
}
for (const forma of ["E-FATURADO", "E-PERMUTA", "E-AMOSTRA", "E-RETRABALHO", "OUTRA"]) {
  confere(`${forma}: fica manual (FORMA_FORA)`, motivoParaFicarManual({ ...BASE, tipo_cobranca: forma }, false) === "FORMA_FORA");
}
confere("marca true: fica manual", motivoParaFicarManual(BASE, true) === "MARCA_SISTEMA_ANTIGO");
confere("marca NULL: fica manual", motivoParaFicarManual(BASE, null) === "MARCA_NULL");
confere("proposta nao encontrada (marca indefinida): fica manual", motivoParaFicarManual(BASE, undefined) === "MARCA_NULL");
confere("nao paga (A_RECEBER): fica manual", motivoParaFicarManual({ ...BASE, status: "A_RECEBER" }, false) === "NAO_PAGA");
confere("ja confirmada: fica de fora", motivoParaFicarManual({ ...BASE, confirmado: true }, false) === "JA_CONFIRMADA");
confere("cancelada que consta paga (motivo gravado): fica manual", motivoParaFicarManual({ ...BASE, motivo_cancela: "duplicado" }, false) === "CANCELADA_E_PAGA");
confere("abatimento com reserva: fica manual", motivoParaFicarManual({ ...BASE, reserva_estado: "RESERVA_ATIVA", id_pendencia: 9, chave_reserva: "k" }, false) === "ABATIMENTO");
confere("abatimento com marcador antigo: fica manual", motivoParaFicarManual({ ...BASE, obs_v2: "x [ABATIMENTO_DEBITO:10.00] y" }, false) === "ABATIMENTO");
confere("sem abatimento nenhum: nao e abatimento", temAbatimentoDeContaCorrente(BASE) === false);

// ── B. a varredura ──────────────────────────────────────────────────────────
console.log("== B. a varredura");
const client = getSupabaseClient() as never;
const quitaOk = async () => ({ podeConfirmar: true, valorTotalProposta: 100, novoValorQuitado: 100 }) as never;
const quitaBloqueia = async () => ({ podeConfirmar: false, valorTotalProposta: 100, novoValorQuitado: 60 }) as never;
let posChamadas: Array<{ id: unknown; opcoes: unknown }> = [];
const posFalso = async (_s: unknown, c: { id: unknown }, opcoes: unknown) => { posChamadas.push({ id: c.id, opcoes }); };
const logs: string[] = [];

async function varrer(modo: "desligado" | "sombra" | "ligado", candidatas: unknown[], marcas: Array<{ id_int: number; is_sistema_antigo: boolean | null }>, opcoes: { quitacao?: typeof quitaOk; update?: { data: unknown; error: unknown } } = {}) {
  falso.zerar();
  posChamadas = [];
  logs.length = 0;
  falso.responder("pagamentos_v2:select", { data: candidatas, error: null });
  falso.responder("propostas:select", { data: marcas, error: null });
  falso.responder("pagamentos_v2:update", (opcoes.update ?? { data: [{ id: BASE.id, status: "PAID", confirmado: true }], error: null }) as never);
  falso.responder("propostas_chat:insert", { data: null, error: null });
  const resumo = await varrerConferenciaAutomatica(client, modo, {
    calcularQuitacao: (opcoes.quitacao ?? quitaOk) as never,
    posConfirmacao: posFalso as never,
    agoraIso: () => "2026-10-16T22:00:00.000Z",
    log: (l) => logs.push(l)
  });
  const updates = falso.chamadas.filter((c) => c.tabela === "pagamentos_v2" && c.op === "update");
  const chats = falso.chamadas.filter((c) => c.tabela === "propostas_chat");
  return { resumo, updates, chats };
}

{
  const r = await varrer("desligado", [BASE], [{ id_int: 23900, is_sistema_antigo: false }]);
  confere("desligado: nao le nem grava nada", falso.chamadas.length === 0 && r.resumo.examinadas === 0, falso.chamadas);
}
{
  const r = await varrer("sombra", [BASE], [{ id_int: 23900, is_sistema_antigo: false }]);
  confere("sombra: elegivel aparece como CONFERIRIA", r.resumo.conferiria === 1 && r.resumo.itens[0].decisao === "CONFERIRIA", r.resumo);
  confere("sombra: nenhuma gravacao (nem cobranca, nem chat, nem pos)", r.updates.length === 0 && r.chats.length === 0 && posChamadas.length === 0 && falso.chamadas.every((c) => c.op === "select"), falso.chamadas.map((c) => `${c.tabela}:${c.op}`));
  const linha = JSON.parse(logs[0] ?? "{}");
  confere("sombra: log estruturado com forma, marca, decisao e quitacao", linha.evento === "conferencia_automatica" && linha.modo === "sombra" && linha.forma === "PIX" && linha.marca === false && linha.decisao === "CONFERIRIA" && linha.quitacao?.podeConfirmar === true, linha);
  confere("sombra: o log nao leva dado pessoal (nem obs_v2, nem cliente)", !/obs_v2|cliente|documento|nome/.test(logs[0] ?? ""), logs[0]);
}
{
  const r = await varrer("ligado", [BASE], [{ id_int: 23900, is_sistema_antigo: false }]);
  confere("ligado: elegivel e conferida, UMA gravacao", r.resumo.conferidas === 1 && r.updates.length === 1, r.resumo);
  const p = r.updates[0]?.payload as Record<string, unknown>;
  confere("ligado: grava confirmado=true, confirmado_por=Sistema e data_confirmacao", p?.confirmado === true && p?.confirmado_por === AUTOR_CONFERENCIA_AUTOMATICA && AUTOR_CONFERENCIA_AUTOMATICA === "Sistema" && p?.data_confirmacao === "2026-10-16T22:00:00.000Z" && !("status" in p), p);
  const f = JSON.stringify(r.updates[0]?.filtros);
  confere("ligado: o UPDATE leva id, status PAID e confirmado false na condicao", f.includes('["eq",["id","c0000000-0000-0000-0000-000000000001"]]') && f.includes('["eq",["status","PAID"]]') && f.includes('["eq",["confirmado",false]]') && !f.includes('"or"'), r.updates[0]?.filtros);
  const chat = (r.chats[0]?.payload as Array<Record<string, unknown>>)?.[0];
  confere("ligado: grava no chat o aviso da tela, com autor Sistema", chat?.mensagem === "Cobrança conferida e liberada para os próximos fluxos operacionais: expedição, fiscal, boletos e produção." && chat?.autor_nome === "Sistema" && chat?.tipo === "SISTEMA", chat);
  const op = posChamadas[0]?.opcoes as Record<string, unknown> | undefined;
  confere("ligado: chama o pos-confirmacao do nucleo (engine e prateleira) como Sistema, sem usuario", posChamadas.length === 1 && op?.confirmadoPor === "Sistema" && (op?.autorReconciliacao as Record<string, unknown>)?.uid === "", posChamadas);
}
{
  // Repetir: a linha ja foi confirmada por outra varredura ou pelo clique; o UPDATE nao pega nada.
  const r = await varrer("ligado", [BASE], [{ id_int: 23900, is_sistema_antigo: false }], { update: { data: [], error: null } });
  confere("repetir (UPDATE sem linha): nao conta como conferida, sem chat e sem pos", r.resumo.conferidas === 0 && r.resumo.itens[0].decisao === "JA_CONFERIDA_POR_OUTRO" && r.chats.length === 0 && posChamadas.length === 0, r.resumo);
}
{
  const r = await varrer("ligado", [], [{ id_int: 23900, is_sistema_antigo: false }]);
  confere("repetir (ja nao e candidata): nenhuma gravacao", r.updates.length === 0 && r.resumo.examinadas === 0, r.resumo);
}
{
  const cands = [
    { ...BASE, id: "a1", id_int: 1 },
    { ...BASE, id: "a2", id_int: 2 },
    { ...BASE, id: "a3", id_int: 3, tipo_cobranca: "E-FATURADO" },
    { ...BASE, id: "a4", id_int: 4, obs_v2: "[ABATIMENTO_DEBITO:5.00]" },
    { ...BASE, id: "a5", id_int: 5, motivo_cancela: "." },
    { ...BASE, id: "a6", id_int: 6 }
  ];
  const marcas = [
    { id_int: 1, is_sistema_antigo: true },
    { id_int: 2, is_sistema_antigo: null },
    { id_int: 3, is_sistema_antigo: false },
    { id_int: 4, is_sistema_antigo: false },
    { id_int: 5, is_sistema_antigo: false }
  ];
  const r = await varrer("ligado", cands, marcas);
  const motivos = Object.fromEntries(r.resumo.itens.map((i) => [i.id, i.motivo ?? i.decisao]));
  confere("ligado: true, NULL, faturado, abatimento, cancelada paga e proposta sumida NAO gravam",
    r.updates.length === 0 && motivos.a1 === "MARCA_SISTEMA_ANTIGO" && motivos.a2 === "MARCA_NULL" && motivos.a3 === "FORMA_FORA" &&
    motivos.a4 === "ABATIMENTO" && motivos.a5 === "CANCELADA_E_PAGA" && motivos.a6 === "MARCA_NULL", motivos);
}
{
  const r = await varrer("ligado", [BASE], [{ id_int: 23900, is_sistema_antigo: false }], { quitacao: quitaBloqueia as never });
  confere("ligado: trava de quitacao fica manual, sem gravar", r.updates.length === 0 && r.resumo.itens[0].motivo === "QUITACAO", r.resumo);
}
{
  const quitaQuebra = async () => { throw new Error("falha"); };
  const r = await varrer("ligado", [BASE], [{ id_int: 23900, is_sistema_antigo: false }], { quitacao: quitaQuebra as never });
  confere("ligado: erro ao calcular a quitacao fica manual, sem gravar", r.updates.length === 0 && r.resumo.itens[0].motivo === "ERRO_NA_QUITACAO", r.resumo);
}
{
  // Uma cobranca falha na gravacao; a seguinte e conferida mesmo assim.
  falso.zerar();
  posChamadas = [];
  falso.responder("pagamentos_v2:select", { data: [{ ...BASE, id: "b1", id_int: 7 }, { ...BASE, id: "b2", id_int: 8 }], error: null });
  falso.responder("propostas:select", { data: [{ id_int: 7, is_sistema_antigo: false }, { id_int: 8, is_sistema_antigo: false }], error: null });
  falso.responderEmSequencia("pagamentos_v2:update", [
    { data: null, error: { message: "falha simulada" } },
    { data: [{ id: "b2", status: "PAID", confirmado: true }], error: null }
  ]);
  falso.responder("propostas_chat:insert", { data: null, error: null });
  const resumo = await varrerConferenciaAutomatica(client, "ligado", { calcularQuitacao: quitaOk as never, posConfirmacao: posFalso as never, log: () => {} });
  const dec = resumo.itens.map((i) => i.decisao).join(",");
  confere("falha de uma cobranca nao impede as outras (FALHOU, CONFERIDA)", dec === "FALHOU,CONFERIDA" && resumo.falhas === 1 && resumo.conferidas === 1, resumo);
}

// ── C. a rota ───────────────────────────────────────────────────────────────
console.log("== C. a rota");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-de-servico-de-teste";
const { POST } = await import("../../src/app/api/cobrancas/conferencia-automatica/route.ts");
async function chamar(segredo: string | null) {
  falso.zerar();
  falso.responder("pagamentos_v2:select", { data: [], error: null });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (segredo !== null) headers["x-vibe-conferencia-segredo"] = segredo;
  const resposta = await POST(new Request("http://localhost/api/cobrancas/conferencia-automatica", { method: "POST", headers }) as never);
  return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}
delete process.env.CONFERENCIA_AUTOMATICA_SEGREDO;
{
  const r = await chamar("qualquer");
  confere("sem segredo configurado no servidor: 503 e nada lido", r.status === 503 && falso.chamadas.length === 0, r);
}
process.env.CONFERENCIA_AUTOMATICA_SEGREDO = "segredo-certo-de-teste";
{
  const r = await chamar("segredo-errado");
  confere("segredo errado: 401 e nada lido", r.status === 401 && falso.chamadas.length === 0, r);
  const r2 = await chamar(null);
  confere("sem cabecalho: 401", r2.status === 401, r2);
}
delete process.env.CONFERENCIA_AUTOMATICA_MODO;
{
  const r = await chamar("segredo-certo-de-teste");
  confere("segredo certo, modo padrao (desligado): 200 e nada lido", r.status === 200 && r.corpo.modo === "desligado" && falso.chamadas.length === 0, r);
}
process.env.CONFERENCIA_AUTOMATICA_MODO = "sombra";
{
  const r = await chamar("segredo-certo-de-teste");
  confere("segredo certo, modo sombra: 200, so leitura", r.status === 200 && r.corpo.modo === "sombra" && falso.chamadas.every((c) => c.op === "select"), { r, chamadas: falso.chamadas.map((c) => `${c.tabela}:${c.op}`) });
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
