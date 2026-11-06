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
 *        - o corpo mandado ao n8n não leva o ambiente;
 *        - (05/11/2026) leva o percentual do Simples do mês da emissão
 *          ("15.20"); sem percentual cadastrado, ou com a leitura falhando, a
 *          rota recusa antes da reserva e não chama o webhook.
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
const { competenciaDaData } = await import("../../src/features/nfse/lib/percentual-simples.ts");
const MES_ATUAL = competenciaDaData(new Date());

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

// Contrato desde ee5cb824 (27/10/2026): prazo de 24 h pela data_autorizacao,
// confere evento "cancelado" anterior, CANCELADA so com status cancelado +
// cStat 135/155 + caminho do XML, autoria no mesmo UPDATE final e o evento
// gravado em notas_eventos. A regra fina do cancelamento esta em
// cancelamento-nfe.test.mts; aqui so importa que a NF-e NAO cai na barreira
// da NFS-e e segue o caminho completo.
preparar();
falso.responder("notas_fiscais:select", {
  data: { id: "nfe-1", ref: "NFE-12345-001", status: "AUTORIZADA", id_empresa: 1, data_cancelamento: null, data_autorizacao: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
  error: null
});
falso.responder("notas_eventos:select", { data: [], error: null });
falso.responder("notas_fiscais:update", { data: [{ id: "nfe-1" }], error: null });
falso.responder("notas_eventos:insert", { data: null, error: null });
respostaDoWebhook = () =>
  new Response(JSON.stringify({ status: "cancelado", status_sefaz: "135", mensagem_sefaz: "Evento registrado e vinculado a NF-e", caminho_xml_cancelamento: "/arquivos/nfe-cancelamento.xml" }), { status: 200 });
{
  const r = await cancelar(pedido({ ref: "NFE-12345-001", justificativa: JUSTIFICATIVA }));
  const corpo = await r.json();
  checar("cancelar NF-e: sucesso, tipo NFE, nota marcada, cStat 135", [r.status, corpo.success, corpo.tipo, corpo.ref, corpo.notaAtualizada, corpo.status_sefaz], [200, true, "NFE", "NFE-12345-001", true, "135"]);
  checar("cancelar NF-e: um webhook, o de NF-e, com o corpo de sempre", saidas, [
    { url: "https://10074.hostoo.net.br/webhook/cancelamento", metodo: "POST", corpo: { id_empresa: 1, referencia: "NFE-12345-001", justificativa: JUSTIFICATIVA } }
  ]);
  checar("cancelar NF-e: sequencia de leituras e escritas", falso.chamadas.map((c) => `${c.tabela}:${c.op}`), [
    "usuarios:select",
    "notas_fiscais:select",
    "notas_eventos:select",
    "notas_fiscais:update",
    "notas_fiscais:update",
    "notas_eventos:insert"
  ]);
  const [reserva, final] = falso.chamadas.filter((c) => c.op === "update").map((c) => c.payload as Record<string, unknown>);
  checar("cancelar NF-e: a reserva marca data_cancelamento", Object.keys(reserva ?? {}).sort(), ["data_cancelamento", "updated_at"]);
  checar("cancelar NF-e: o UPDATE final marca CANCELADA com a autoria", [final?.status, "cancelado_por" in (final ?? {}), "cancelado_por_nome" in (final ?? {})], ["CANCELADA", true, true]);
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

type Percentual = { data: unknown; error: { message: string } | null };
const PERCENTUAL_DO_MES: Percentual = { data: [{ competencia: MES_ATUAL, percentual: "15.20" }], error: null };

async function emitirCom(idEmpresa: number | null, ambiente: string | null, percentual: Percentual = PERCENTUAL_DO_MES) {
  preparar();
  falso.responder("empresas_percentual_simples:select", percentual);
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
  checar(`emitir empresa 2 em ${ambiente}: um webhook, sem o ambiente, com o percentual do mes`, saidas, [
    {
      url: "https://10074.hostoo.net.br/webhook/emitir-nfse-focus",
      metodo: "POST",
      corpo: {
        ref: "NFS-88888-001",
        supabase_url: "https://exemplo.supabase.co",
        percentual_total_tributos_simples_nacional: "15.20",
        competencia_percentual_simples: `${MES_ATUAL.slice(5, 7)}/${MES_ATUAL.slice(0, 4)}`
      }
    }
  ]);
  const leitura = falso.chamadas.find((c) => c.tabela === "empresas_percentual_simples");
  checar(`emitir empresa 2 em ${ambiente}: le o percentual da empresa 2 no mes atual`, leitura?.filtros, [["eq", ["id_empresa", 2]], ["eq", ["competencia", MES_ATUAL]]]);
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

for (const [rotulo, percentual] of [
  ["sem linha do mes", { data: [], error: null }],
  ["so o mes anterior", { data: [{ competencia: "2000-01-01", percentual: 15.2 }], error: null }],
  ["leitura falhou", { data: null, error: { message: "permission denied" } }]
] as [string, Percentual][]) {
  const { status, corpo } = await emitirCom(2, "producao", percentual);
  checar(`emitir empresa 2, ${rotulo}: PERCENTUAL_SIMPLES_NAO_CADASTRADO`, [status, corpo.success, corpo.code], [422, false, "PERCENTUAL_SIMPLES_NAO_CADASTRADO"]);
  checar(`emitir empresa 2, ${rotulo}: sem reserva, sem webhook, sem escrita`, [rpcs(), saidas, escritas()], [[], [], []]);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
