/**
 * Clique manual de "Confirmar Conferência" e "Autorizar e conferir" leva o
 * pedido a LIBERADO, como a conferência automática (16/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/confirmar-engine-liberado.test.mts
 *
 * A CAUSA, IMITADA AQUI
 *   O aviso de tentativa da engine sai pelo chat do servidor, que grava como
 *   anon. Com `autor_uid`, o gatilho trg_preencher_autor_propostas_chat lê
 *   public.usuarios como anon e recebe 42501 (sem SELECT desde 29/09); a engine
 *   retorna antes do UPDATE. O Supabase falso recusa com 42501 todo INSERT em
 *   propostas_chat que leve `autor_uid`, como o gatilho real.
 *
 * SEM banco. O usuário da sessão tem um uid válido (senão o chat já o zeraria
 * e o teste não distinguiria antes e depois).
 *   A. controle: a engine com uid aborta; sem uid, grava o status;
 *   B. a rota: cobertura integral vai a LIBERADO; R$ 0,01 devedor fica em
 *      AGUARDANDO; o aviso da engine vai sem uid e com o nome de quem clicou;
 *   C. "Autorizar e conferir" passa pela mesma engine, sem abortar.
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
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
const { POST } = await import("../../src/app/api/cobrancas/confirmar/route.ts");
const { aplicarStatusRecomendadoProposta } = await import("../../src/features/orcamentos/services/status-writer.service.ts");
const { ACAO_AUTORIZAR_E_CONFERIR } = await import("../../src/features/cobrancas/lib/autorizar-e-conferir.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

const UID = "11111111-1111-4111-8111-111111111111";
const PEDIDO = 23999;
const PIX = {
  id: "c0000000-0000-0000-0000-000000023999",
  id_int: PEDIDO,
  id_cliente: 14,
  id_pagamento: "23999-A",
  tipo_cobranca: "PIX",
  valor: 100,
  status: "PAID",
  confirmado: false,
  aprovado_por: null as string | null,
  confirmado_por: null as string | null,
  motivo_cancela: null as string | null,
  paid_at: "2026-10-16T21:00:00Z",
  reserva_estado: null,
  obs_v2: null
};

/** O "banco": proposta APROVADO de R$ 100,00, um item comum, sem modelos. */
function prepararBanco(cobranca: Record<string, unknown>, opcoes: { statusProposta?: string } = {}) {
  falso.zerar();
  falso.definirUsuario(UID);
  falso.responder("usuarios:select", { data: { id_perfil: 1, is_super_adm: true, is_admin: true }, error: null });
  falso.responder("pagamentos_v2:select", { data: Object.assign([cobranca], cobranca), error: null });
  falso.responder("pagamentos_v2:update", { data: [{ id: cobranca.id }], error: null });
  falso.responder("propostas:select", { data: { status_interno: opcoes.statusProposta ?? "APROVADO", is_avulso: false, valor_total: 100 }, error: null });
  falso.responder("propostas:update", { data: [{ id_int: PEDIDO }], error: null });
  falso.responder("pedidos_modelos:select", { data: [], error: null });
  falso.responder("produtos_proposta:select", { data: [{ is_estoque: false, status_item: "PENDENTE" }], error: null });
  // O gatilho do chat: com autor_uid, o anon nao le usuarios -> 42501.
  falso.interceptar("propostas_chat:insert", (payload) => {
    const linha = (Array.isArray(payload) ? payload[0] : payload) as Record<string, unknown>;
    return linha?.autor_uid
      ? { data: null, error: { message: "permission denied for table usuarios", code: "42501" } }
      : { data: { id: 1, ...linha }, error: null };
  });
}

const statusGravados = () =>
  falso.chamadas.filter((c) => c.tabela === "propostas" && c.op === "update").map((c) => (c.payload as Record<string, unknown>)?.status_interno);
const chatsDaEngine = () =>
  falso.chamadas
    .filter((c) => c.tabela === "propostas_chat" && c.op === "insert")
    .map((c) => (c.payload as Array<Record<string, unknown>>)[0])
    .filter((l) => String(l?.setor) === "AUTO_FINANCEIRO");

// ── A. controle ─────────────────────────────────────────────────────────────
console.log("== A. controle: o falso imita a causa");
{
  prepararBanco(PIX);
  const r = await aplicarStatusRecomendadoProposta(PEDIDO, { uid: UID, nome: "Financeiro de Teste", email: "fin@teste" }, getSupabaseClient() as never, "AUTO_FINANCEIRO");
  confere("engine COM uid (como o clique fazia ate hoje): aborta no aviso e NAO grava status", r.success === false && /log de tentativa/.test(r.errorMessage ?? "") && statusGravados().length === 0, { r, status: statusGravados() });
}
{
  prepararBanco(PIX);
  const r = await aplicarStatusRecomendadoProposta(PEDIDO, { uid: "", nome: "Financeiro de Teste", email: "fin@teste" }, getSupabaseClient() as never, "AUTO_FINANCEIRO");
  confere("engine SEM uid: grava LIBERADO", statusGravados().includes("LIBERADO"), { r, status: statusGravados() });
}

// ── B. a rota (Confirmar Conferência) ───────────────────────────────────────
console.log("== B. clique manual de Confirmar Conferencia");
async function confirmar(cobranca: Record<string, unknown>, acao?: string) {
  const requisicao = new Request("http://localhost/api/cobrancas/confirmar", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ idCobranca: cobranca.id, confirmadoPor: "Marielle Fonseca", ...(acao ? { acao } : {}) })
  });
  const resposta = await POST(requisicao as never);
  return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}
{
  prepararBanco(PIX);
  const r = await confirmar(PIX);
  confere("cobertura integral (R$ 100,00 de R$ 100,00): 200 e o pedido vai a LIBERADO", r.status === 200 && statusGravados().includes("LIBERADO"), { r, status: statusGravados() });
  const avisos = chatsDaEngine();
  confere("o aviso da engine vai SEM uid e com o nome de quem clicou", avisos.length > 0 && avisos.every((l) => l.autor_uid === null && l.autor_nome === "Marielle Fonseca"), avisos);
  const conferencia = falso.chamadas.find((c) => c.tabela === "pagamentos_v2" && c.op === "update")?.payload as Record<string, unknown>;
  confere("a confirmacao da cobranca segue com o nome de quem clicou", conferencia?.confirmado === true && conferencia?.confirmado_por === "Marielle Fonseca", conferencia);
}
{
  const devedora = { ...PIX, valor: 99.99 };
  prepararBanco(devedora);
  const r = await confirmar(devedora);
  confere("R$ 0,01 devedor (R$ 99,99 de R$ 100,00): NAO vai a LIBERADO, a engine poe AGUARDANDO", r.status === 200 && !statusGravados().includes("LIBERADO") && statusGravados().includes("AGUARDANDO"), { r, status: statusGravados() });
}

// ── C. Autorizar e conferir ─────────────────────────────────────────────────
console.log("== C. Autorizar e conferir");
{
  const faturado = { ...PIX, id: "c0000000-0000-0000-0000-000000023998", id_pagamento: "23999-B", tipo_cobranca: "E-FATURADO", status: "A_VENCER", paid_at: null };
  prepararBanco(faturado);
  const r = await confirmar(faturado, ACAO_AUTORIZAR_E_CONFERIR);
  const avisos = chatsDaEngine();
  confere("autorizar e conferir: 200, o aviso da engine vai sem uid e a engine chega a gravar status (nao aborta)",
    r.status === 200 && avisos.length > 0 && avisos.every((l) => l.autor_uid === null) && statusGravados().length > 0, { r, avisos, status: statusGravados() });
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
