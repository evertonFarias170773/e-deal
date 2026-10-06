/**
 * NFS-e: as duas barreiras que preparam a produção (06/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/nfse-barreiras-de-producao.test.mts
 *
 * SEM banco, SEM n8n e SEM Focus: cliente Supabase falso e `fetch` falso. Roda as
 * ROTAS de verdade (`POST`), não uma cópia da regra.
 *
 * O QUE PROVA
 *   A. `/api/fiscal/cancelar-nfe` com `ref` de NFS-e: recusa com a mensagem
 *      combinada, em qualquer status, sem chamar o webhook e sem gravar nada.
 *   B. A mesma rota com `ref` de NF-e: o caminho de sempre, passo a passo —
 *      reserva, webhook `cancelamento` com o corpo de sempre, autoria.
 *   C. `/api/fiscal/emitir-nfse`:
 *        - empresa fora de `EMPRESAS_NFSE_LIBERADAS` é recusada em homologação e
 *          em produção, antes de qualquer escrita (a reserva é a primeira);
 *        - empresa 2 em homologação passa como antes;
 *        - empresa 2 em produção passa (não há mais `AMBIENTE_SEM_CAMINHO`);
 *        - ambiente vazio ou desconhecido é recusado;
 *        - o corpo mandado ao n8n não leva o ambiente.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
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
const { POST: cancelar } = await import("../../src/app/api/fiscal/cancelar-nfe/route.ts");
const { POST: emitir } = await import("../../src/app/api/fiscal/emitir-nfse/route.ts");
const { EMPRESAS_NFSE_LIBERADAS } = await import("../../src/features/nfse/lib/regras-emissao.ts");

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
delete process.env.N8N_WEBHOOK_SECRET;

/** `fetch` falso: anota a chamada e devolve o que o teste combinou. */
type Saida = { url: string; metodo: string; corpo: unknown };
let saidas: Saida[] = [];
let respostaDoWebhook: () => Response = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
globalThis.fetch = (async (alvo: unknown, init?: { method?: string; body?: unknown }) => {
  saidas.push({ url: String(alvo), metodo: String(init?.method ?? "GET"), corpo: init?.body ? JSON.parse(String(init.body)) : null });
  return respostaDoWebhook();
}) as typeof fetch;

function preparar() {
  falso.zerar();
  saidas = [];
  respostaDoWebhook = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  falso.responder("usuarios:select", { data: { id_perfil: null, is_super_adm: true, is_admin: true }, error: null });
}

function pedido(corpo: unknown) {
  return new Request("https://vibe.local/api", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify(corpo)
  });
}

const escritas = () => falso.chamadas.filter((c) => c.op !== "select").map((c) => `${c.tabela}:${c.op}`);
const rpcs = () => falso.chamadas.filter((c) => c.tabela.startsWith("rpc:")).map((c) => c.tabela);
const JUSTIFICATIVA = "Nota emitida com o valor errado.";

/* ------------------------------------------------ A. cancelar NFS-e: recusa */

const MENSAGEM =
  "Cancelamento de NFS-e ainda não está disponível no Vibe. Cancele pelo portal nacional (www.nfse.gov.br) e avise o fiscal.";

for (const status of ["AUTORIZADA", "PENDENTE", "CANCELADA"]) {
  preparar();
  falso.responder("notas_fiscais:select", { data: null, error: null });
  falso.responder("notas_servico:select", { data: { id: "nfs-1", ref: "NFS-99999-001", status, id_empresa: 2 }, error: null });
  const r = await cancelar(pedido({ ref: "NFS-99999-001", justificativa: JUSTIFICATIVA }));
  const corpo = await r.json();
  checar(`cancelar NFS-e ${status}: recusa 422 com a mensagem combinada`, [r.status, corpo.success, corpo.code, corpo.message], [422, false, "CANCELAMENTO_NFSE_INDISPONIVEL", MENSAGEM]);
  checar(`cancelar NFS-e ${status}: nenhuma chamada ao webhook`, saidas, []);
  checar(`cancelar NFS-e ${status}: nada gravado`, escritas(), []);
}

preparar();
falso.responder("notas_fiscais:select", { data: null, error: null });
falso.responder("notas_servico:select", { data: null, error: null });
{
  const r = await cancelar(pedido({ ref: "NAO-EXISTE", justificativa: JUSTIFICATIVA }));
  checar("cancelar ref inexistente: 404 como antes, sem webhook", [r.status, saidas.length], [404, 0]);
}

/* ------------------------------------------- B. cancelar NF-e: como sempre */

preparar();
falso.responder("notas_fiscais:select", { data: { id: "nfe-1", ref: "NFE-12345-001", status: "AUTORIZADA", id_empresa: 1, data_cancelamento: null }, error: null });
falso.responder("notas_fiscais:update", { data: [{ id: "nfe-1" }], error: null });
respostaDoWebhook = () => new Response(JSON.stringify({ status: "cancelado" }), { status: 200 });
{
  const r = await cancelar(pedido({ ref: "NFE-12345-001", justificativa: JUSTIFICATIVA }));
  const corpo = await r.json();
  checar("cancelar NF-e: sucesso, tipo NFE, retorno do webhook repassado", [r.status, corpo.success, corpo.tipo, corpo.ref, corpo.retorno], [200, true, "NFE", "NFE-12345-001", { status: "cancelado" }]);
  checar("cancelar NF-e: um webhook, o de NF-e, com o corpo de sempre", saidas, [
    { url: "https://10074.hostoo.net.br/webhook/cancelamento", metodo: "POST", corpo: { id_empresa: 1, referencia: "NFE-12345-001", justificativa: JUSTIFICATIVA } }
  ]);
  checar("cancelar NF-e: sequencia de leituras e escritas", falso.chamadas.map((c) => `${c.tabela}:${c.op}`), [
    "usuarios:select",
    "notas_fiscais:select",
    "notas_fiscais:update",
    "notas_fiscais:update"
  ]);
  const [reserva, autoria] = falso.chamadas.filter((c) => c.op === "update").map((c) => Object.keys(c.payload as Record<string, unknown>).sort());
  checar("cancelar NF-e: a reserva marca data_cancelamento", reserva, ["data_cancelamento", "updated_at"]);
  checar("cancelar NF-e: a autoria grava quem cancelou", autoria, ["cancelado_por", "cancelado_por_nome", "updated_at"]);
  checar("cancelar NF-e: notas_servico nem e lida", falso.chamadas.some((c) => c.tabela === "notas_servico"), false);
}

preparar();
falso.responder("notas_fiscais:select", { data: { id: "nfe-2", ref: "NFE-12345-002", status: "PENDENTE", id_empresa: 1, data_cancelamento: null }, error: null });
{
  const r = await cancelar(pedido({ ref: "NFE-12345-002", justificativa: JUSTIFICATIVA }));
  const corpo = await r.json();
  checar("cancelar NF-e nao autorizada: recusa de sempre, sem webhook", [r.status, corpo.code, saidas.length, escritas()], [409, "NOTA_NAO_CANCELAVEL", 0, []]);
}

/* ----------------------------------------------------- C. emitir NFS-e */

checar("emitir: a lista de empresas e a de sempre", EMPRESAS_NFSE_LIBERADAS, [2]);

async function emitirCom(idEmpresa: number | null, ambiente: string | null) {
  preparar();
  falso.responder("notas_servico:select", {
    data: { id: "nfs-9", ref: "NFS-88888-001", status: "PENDENTE", numero_nfse: null, codigo_verificacao: null, tentativas_envio: 0, id_empresa: idEmpresa, payload_retorno: null },
    error: null
  });
  falso.responder("empresas:select", { data: ambiente === null ? null : { empresa: "EMPRESA DE TESTE", ambiente_nfse: ambiente }, error: null });
  falso.responder("rpc:fn_reservar_emissao_nfse", { data: { reservada: true, tentativas_envio: 1 }, error: null });
  respostaDoWebhook = () => new Response(JSON.stringify({ status: "PROCESSANDO" }), { status: 200 });
  const r = await emitir(pedido({ ref: "NFS-88888-001" }));
  return { status: r.status, corpo: await r.json() };
}

for (const [idEmpresa, ambiente] of [[1, "homologacao"], [1, "producao"], [3, "homologacao"], [3, "producao"], [null, "homologacao"]] as [number | null, string][]) {
  const { status, corpo } = await emitirCom(idEmpresa, ambiente);
  checar(`emitir empresa ${idEmpresa} em ${ambiente}: EMPRESA_NAO_LIBERADA`, [status, corpo.success, corpo.code], [422, false, "EMPRESA_NAO_LIBERADA"]);
  checar(`emitir empresa ${idEmpresa} em ${ambiente}: sem reserva, sem webhook, sem escrita`, [rpcs(), saidas, escritas()], [[], [], []]);
}

for (const ambiente of ["homologacao", "producao"]) {
  const { status, corpo } = await emitirCom(2, ambiente);
  checar(`emitir empresa 2 em ${ambiente}: passa`, [status, corpo.success, corpo.ref, corpo.tentativas_envio, corpo.code ?? null], [200, true, "NFS-88888-001", 1, null]);
  checar(`emitir empresa 2 em ${ambiente}: reserva pela funcao do banco, com o que foi lido`, falso.chamadas.filter((c) => c.tabela.startsWith("rpc:")).map((c) => [c.tabela, c.payload]), [
    ["rpc:fn_reservar_emissao_nfse", { p_id: "nfs-9", p_status_lido: "PENDENTE", p_tentativas_lidas: 0 }]
  ]);
  checar(`emitir empresa 2 em ${ambiente}: um webhook, o de sempre, sem o ambiente no corpo`, saidas, [
    { url: "https://10074.hostoo.net.br/webhook/emitir-nfse-focus", metodo: "POST", corpo: { ref: "NFS-88888-001", supabase_url: "https://exemplo.supabase.co" } }
  ]);
  checar(`emitir empresa 2 em ${ambiente}: a rota nao escreve direto em tabela`, escritas(), []);
}

for (const ambiente of ["", "teste", "PRODUCAO-X", null]) {
  const { status, corpo } = await emitirCom(2, ambiente);
  checar(`emitir empresa 2 com ambiente ${JSON.stringify(ambiente)}: AMBIENTE_NAO_DEFINIDO`, [status, corpo.success, corpo.code], [422, false, "AMBIENTE_NAO_DEFINIDO"]);
  checar(`emitir empresa 2 com ambiente ${JSON.stringify(ambiente)}: sem reserva e sem webhook`, [rpcs(), saidas], [[], []]);
}

{
  const { status, corpo } = await emitirCom(2, "Producao ");
  checar("emitir empresa 2 com ambiente em outra caixa e com espaco: normalizado, passa", [status, corpo.success], [200, true]);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
