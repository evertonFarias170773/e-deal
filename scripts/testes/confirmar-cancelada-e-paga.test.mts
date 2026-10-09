/**
 * A rota de confirmar conferência recusa cobrança cancelada que consta como paga (09/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/confirmar-cancelada-e-paga.test.mts
 *
 * SEM banco: cliente Supabase falso, que só anota o que foi pedido.
 *   A. a regra (lib/cancelada-que-consta-paga): motivo vazio não conta, "." conta,
 *      status cancelado conta;
 *   B. a rota `POST /api/cobrancas/confirmar`:
 *        - cobrança NORMAL passa e é confirmada (uma gravação);
 *        - cancelada que consta paga é recusada com 409 e a mensagem, SEM gravar;
 *        - motivo vazio ou só com espaços não recusa;
 *        - já confirmada com rastro de cancelamento também recusa (não responde
 *          "já estava confirmada").
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
    // O serviço de orçamentos importa o cliente de navegador; aqui ele também é o falso.
    if (especificador === "@/lib/supabase/client") return { url: FALSO_CLIENTE, shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { falso } = await import("./_supabase-falso.mts");
const {
  CODIGO_CANCELADA_E_PAGA,
  MENSAGEM_CANCELADA_E_PAGA,
  SELO_CANCELADA_E_PAGA,
  confirmacaoDeveSerRecusada,
  ehCanceladaQueConstaPaga,
  temMotivoDeCancelamento
} = await import("../../src/features/cobrancas/lib/cancelada-que-consta-paga.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

// ── A. a regra ──────────────────────────────────────────────────────────────
console.log("== A. a regra");
confere("mensagem pedida, palavra por palavra", MENSAGEM_CANCELADA_E_PAGA === "Esta cobrança foi cancelada e consta como paga. Não confirme: o dinheiro pode ter entrado em duplicidade. Avise a gestão para decidir entre reativar ou devolver.");
confere("texto do selo", SELO_CANCELADA_E_PAGA === "Cancelada e paga: não confirmar");

confere("cobranca normal (PAID, sem motivo): nao recusa", confirmacaoDeveSerRecusada({ status: "PAID", motivo_cancela: null }) === false);
confere("cobranca normal (A_VENCER, motivo ausente): nao recusa", confirmacaoDeveSerRecusada({ status: "A_VENCER" }) === false);
confere("motivo VAZIO nao conta (caso 19128-A)", confirmacaoDeveSerRecusada({ status: "PAID", motivo_cancela: "" }) === false && !ehCanceladaQueConstaPaga({ status: "PAID", motivo_cancela: "" }));
confere("motivo so com espacos nao conta", confirmacaoDeveSerRecusada({ status: "PAID", motivo_cancela: "   " }) === false && !temMotivoDeCancelamento(" \n\t "));
confere("PAID com motivo 'duplicado' (caso 20059-A): recusa e leva o selo", confirmacaoDeveSerRecusada({ status: "PAID", motivo_cancela: "duplicado" }) && ehCanceladaQueConstaPaga({ status: "PAID", motivo_cancela: "duplicado" }));
confere("PAID com motivo '.' (caso 23411-A, cancelada de verdade): recusa e leva o selo", confirmacaoDeveSerRecusada({ status: "PAID", motivo_cancela: "." }) && ehCanceladaQueConstaPaga({ status: "PAID", motivo_cancela: "." }));
confere("A_VENCER com motivo gravado: recusa", confirmacaoDeveSerRecusada({ status: "A_VENCER", motivo_cancela: "mudou para ecredito" }));
confere("status CANCELADO: a confirmacao e recusada", confirmacaoDeveSerRecusada({ status: "CANCELADO", motivo_cancela: "duplicado" }) && confirmacaoDeveSerRecusada({ status: "cancelada", motivo_cancela: null }));
confere("status CANCELADO nao leva o selo de 'consta paga' (ela esta so cancelada)", ehCanceladaQueConstaPaga({ status: "CANCELADO", motivo_cancela: "duplicado" }) === false);

// ── B. a rota ───────────────────────────────────────────────────────────────
console.log("== B. a rota de confirmar");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
const { POST } = await import("../../src/app/api/cobrancas/confirmar/route.ts");

const COBRANCA = {
  id: "c0000000-0000-0000-0000-000000000001",
  id_int: 22999,
  id_cliente: 14,
  id_pagamento: "22999-A",
  tipo_cobranca: "PIX",
  valor: 100,
  status: "PAID",
  confirmado: false,
  motivo_cancela: null as string | null,
  paid_at: "2026-10-09T12:00:00Z",
  reserva_estado: null,
  obs_v2: null
};

function prepararBanco(cobranca: Record<string, unknown>) {
  falso.zerar();
  falso.responder("usuarios:select", { data: { id_perfil: 1, is_super_adm: true, is_admin: true }, error: null });
  // A mesma chave serve à leitura de UMA cobrança (`.single()`) e à lista de
  // cobranças do pedido: um array que também carrega os campos da linha.
  falso.responder("pagamentos_v2:select", { data: Object.assign([cobranca], cobranca), error: null });
  falso.responder("pagamentos_v2:update", { data: null, error: null });
  // Pedido fora da família financeira: a reconciliação de status não tem o que fazer.
  falso.responder("propostas:select", { data: { valor_total: 100, status_interno: "ENTREGUE", is_avulso: true }, error: null });
}
async function confirmar(cobranca: Record<string, unknown>) {
  prepararBanco(cobranca);
  const requisicao = new Request("http://localhost/api/cobrancas/confirmar", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ idCobranca: cobranca.id, confirmadoPor: "Financeiro de Teste" })
  });
  const resposta = await POST(requisicao as never);
  const corpo = (await resposta.json()) as Record<string, unknown>;
  const gravacoes = falso.chamadas.filter((c) => c.tabela === "pagamentos_v2" && c.op === "update");
  return { status: resposta.status, corpo, gravacoes };
}

{
  const r = await confirmar({ ...COBRANCA });
  confere("cobranca NORMAL: passa (200, success)", r.status === 200 && r.corpo.success === true, r);
  confere("cobranca NORMAL: e confirmada com UMA gravacao", r.gravacoes.length === 1 && (r.gravacoes[0].payload as Record<string, unknown>)?.confirmado === true, r.gravacoes);
}
{
  const r = await confirmar({ ...COBRANCA, motivo_cancela: "" });
  confere("motivo VAZIO: passa e confirma (nao conta como cancelamento)", r.status === 200 && r.corpo.success === true && r.gravacoes.length === 1, r);
}
{
  const r = await confirmar({ ...COBRANCA, motivo_cancela: "   " });
  confere("motivo so com espacos: passa e confirma", r.status === 200 && r.gravacoes.length === 1, r);
}
{
  const r = await confirmar({ ...COBRANCA, motivo_cancela: "duplicado" });
  confere("cancelada que consta paga: 409", r.status === 409, r);
  confere("cancelada que consta paga: a mensagem pedida e o codigo", r.corpo.error === MENSAGEM_CANCELADA_E_PAGA && r.corpo.code === CODIGO_CANCELADA_E_PAGA && r.corpo.success === false, r.corpo);
  confere("cancelada que consta paga: NADA e gravado", r.gravacoes.length === 0 && falso.chamadas.every((c) => c.op === "select"), falso.chamadas.map((c) => `${c.tabela}:${c.op}`));
}
{
  const r = await confirmar({ ...COBRANCA, motivo_cancela: "." });
  confere("motivo '.': 409, sem gravar", r.status === 409 && r.corpo.code === CODIGO_CANCELADA_E_PAGA && r.gravacoes.length === 0, r);
}
{
  const r = await confirmar({ ...COBRANCA, status: "CANCELADO", motivo_cancela: "duplicado" });
  confere("status CANCELADO: 409 com a mesma mensagem, sem gravar", r.status === 409 && r.corpo.error === MENSAGEM_CANCELADA_E_PAGA && r.gravacoes.length === 0, r);
}
{
  const r = await confirmar({ ...COBRANCA, confirmado: true, motivo_cancela: "mudou" });
  confere("ja confirmada, com rastro de cancelamento: 409, e nao 'ja estava confirmada'", r.status === 409 && r.corpo.success === false, r);
}
{
  const r = await confirmar({ ...COBRANCA, confirmado: true });
  confere("ja confirmada, normal: continua respondendo sucesso sem gravar (como antes)", r.status === 200 && r.corpo.success === true && r.gravacoes.length === 0, r);
}
{
  const r = await confirmar({ ...COBRANCA, status: "EXTORNADO" });
  confere("status EXTORNADO: a recusa de antes (400) continua", r.status === 400 && r.gravacoes.length === 0, r);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
