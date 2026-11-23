/**
 * Trocar forma de pagamento (PIX -> Faturado), com NF-e autorizada — 05/11/2026.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/trocar-forma-pagamento.test.mts
 *
 * SEM banco de dados, SEM n8n e SEM banco emissor: cliente Supabase falso, que
 * só anota o que foi pedido, e `fetch` falso no lugar do webhook do PIX.
 *   A. regras puras: quem aceita a troca, a linha nova, as recusas aplicadas;
 *   B. troca feliz: a nova nasce ANTES da antiga cair; a antiga cai com o
 *      motivo; o Histórico liga as duas; `propostas` não é gravada;
 *   C. banco recusa / não responde: a antiga continua, a nova é cancelada com
 *      o motivo, a marca da antiga é solta, o Histórico registra;
 *   D. cancelar sem trocar continua barrado pela nota (rota cancelar-externo);
 *   E. recusas antes de gravar: Birô, produção, paga, sem motivo, troca em
 *      andamento, falha ao criar a nova;
 *   F. a consulta GET que a janela faz ao abrir;
 *   G. as outras formas internas (10/11/2026): E-Permuta, E-Amostra e
 *      E-Retrabalho; as formas de banco recusadas;
 *   H. E-Crédito: consome o crédito, devolve se o banco não confirmar,
 *      recusa sem saldo;
 *   I. Chave Pix (17/11/2026): PIX já recebido na chave da empresa; nasce
 *      paga pela função do banco, só para quem confirma pagamento.
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

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.N8N_WEBHOOK_SECRET = "segredo-de-teste";

const { falso } = await import("./_supabase-falso.mts");
const { WEBHOOK_CANCELA_PIX } = await import("../../src/features/cobrancas/services/cancelamento-pix.ts");
const regras = await import("../../src/features/cobrancas/troca-forma-pagamento.ts");
const rota = await import("../../src/app/api/cobrancas/trocar-forma-pagamento/route.ts");
const cancelarExterno = await import("../../src/app/api/cobrancas/cancelar-externo/route.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

const CONFIRMOU = { success: true, cancelado: true, status: "REMOVIDA_PELO_USUARIO_RECEBEDOR", txid: "QRS1TX" };
const RECUSOU = { success: true, cancelado: false, mensagem: "Cobrança PIX não foi cancelada" };

const ANTIGA = {
  id: "a0000000-0000-0000-0000-000000000001",
  id_int: 24692,
  id_cliente: 777,
  id_pagamento: "24692-A",
  cliente: "E3 CLIENTE DE TESTE",
  documento: "12345678000199",
  valor: "213.00",
  status: "A_RECEBER",
  confirmado: false,
  paid_at: null as string | null,
  data_confirmacao: null,
  tipo_cobranca: "PIX",
  cod_solicitacao_inter: "QRS1TXCODIGODOBANCO",
  id_empresa: 3,
  empresa: "E3 BRINDES LTDA",
  os_ideal: null,
  atendente: "Vendedor Teste",
  obs_v2: null,
  descricao: "PIX",
  reserva_estado: null,
  id_pendencia: null,
  chave_reserva: null,
  motivo_troca: null as string | null
};
const NOVA = { id: "b0000000-0000-0000-0000-000000000002", id_pagamento: "24692-B" };
const MODELO = { id: "m0000000-0000-0000-0000-000000000003", resultado: "30 DIAS", qtd_parcela: 1, inicio: 30, intervalo: 0, entrada_porcento: 0 };
const NOTA = [{ numero_nf: "41391", status: "AUTORIZADA", ambiente: "producao" }];

function prepararBanco(opcoes: {
  antiga?: Record<string, unknown>;
  proposta?: Record<string, unknown>;
  marcou?: boolean;
  insereErro?: string;
} = {}) {
  const antiga = { ...ANTIGA, ...(opcoes.antiga ?? {}) };
  falso.zerar();
  falso.responder("usuarios:select", { data: { id_perfil: 1, id_empresa: 1, is_super_adm: true, is_admin: true, nome_usuario: "Financeiro Teste" }, error: null });
  falso.responder("pagamentos_v2:select", { data: Object.assign([antiga], antiga), error: null });
  falso.responder("pagamentos_v2:update", { data: opcoes.marcou === false ? [] : [{ id: antiga.id }], error: null });
  falso.responder(
    "pagamentos_v2:insert",
    opcoes.insereErro ? { data: null, error: { message: opcoes.insereErro } } : { data: NOVA, error: null }
  );
  falso.responder("propostas:select", {
    data: { id_int: 24692, status_interno: "AGUARDANDO", is_prd_aprovado: false, is_avulso: false, empresa: "E3 BRINDES LTDA", vendedor: "Y", ...(opcoes.proposta ?? {}) },
    error: null
  });
  falso.responder("notas_fiscais:select", { data: NOTA, error: null });
  falso.responder("modelos_cobranca:select", { data: MODELO, error: null });
  falso.responder("propostas_chat:insert", { data: null, error: null });
}

type ChamadaRede = { url: string; body: string };
let rede: ChamadaRede[] = [];
function fetchFalso(resposta: { status?: number; corpo?: unknown } | "REDE") {
  rede = [];
  globalThis.fetch = (async (u: string, init?: RequestInit) => {
    rede.push({ url: String(u), body: String(init?.body ?? "") });
    if (resposta === "REDE") throw new TypeError("fetch failed");
    const texto = typeof resposta.corpo === "string" ? resposta.corpo : JSON.stringify(resposta.corpo ?? {});
    return new Response(texto, { status: resposta.status ?? 200 });
  }) as typeof fetch;
}

async function trocar(corpo: Record<string, unknown> = {}) {
  const req = new Request("http://localhost/api/cobrancas/trocar-forma-pagamento", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ id: ANTIGA.id, id_modelo_cobranca: MODELO.id, motivo: "cliente paga faturado", ...corpo })
  });
  const resposta = await rota.POST(req);
  const json = (await resposta.json()) as Record<string, unknown>;
  const chamadas = falso.chamadas;
  const idx = (pred: (c: (typeof chamadas)[number]) => boolean) => chamadas.findIndex(pred);
  const p = (c: (typeof chamadas)[number]) => (c.payload ?? {}) as Record<string, unknown>;
  const filtroId = (c: (typeof chamadas)[number]) => c.filtros.find((f) => f[0] === "eq" && (f[1] as unknown[])[0] === "id")?.[1] as unknown[] | undefined;
  return {
    status: resposta.status,
    json,
    chamadas,
    insertNova: chamadas.find((c) => c.tabela === "pagamentos_v2" && c.op === "insert"),
    posInsert: idx((c) => c.tabela === "pagamentos_v2" && c.op === "insert"),
    posCancelaAntiga: idx((c) => c.tabela === "pagamentos_v2" && c.op === "update" && p(c).status === "CANCELADO" && filtroId(c)?.[1] === ANTIGA.id),
    cancelaAntiga: chamadas.find((c) => c.tabela === "pagamentos_v2" && c.op === "update" && p(c).status === "CANCELADO" && filtroId(c)?.[1] === ANTIGA.id),
    cancelaNova: chamadas.find((c) => c.tabela === "pagamentos_v2" && c.op === "update" && p(c).status === "CANCELADO" && filtroId(c)?.[1] === NOVA.id),
    soltouMarca: chamadas.some((c) => c.tabela === "pagamentos_v2" && c.op === "update" && p(c).motivo_troca === null && filtroId(c)?.[1] === ANTIGA.id),
    historico: chamadas.filter((c) => c.tabela === "propostas_chat" && c.op === "insert").map((c) => String(((c.payload as Record<string, unknown>[])[0] ?? {}).mensagem ?? "")),
    gravouProposta: chamadas.some((c) => c.tabela === "propostas" && c.op !== "select"),
    escritas: chamadas.filter((c) => c.op !== "select"),
    aoBanco: rede.filter((c) => c.url === WEBHOOK_CANCELA_PIX)
  };
}

// ── A. regras puras ─────────────────────────────────────────────────────────
console.log("== A. regras puras");
confere("PIX A_RECEBER da E3 (3) aceita a troca", regras.cobrancaAceitaTroca({ tipo_cobranca: "PIX", id_empresa: 3, status: "A_RECEBER", paid_at: null }));
confere("PIX A_RECEBER da Ideal Gráfica (1) aceita a troca", regras.cobrancaAceitaTroca({ tipo_cobranca: "PIX", id_empresa: 1, status: "A_RECEBER" }));
confere("PIX da Ideal Birô (2) NÃO aceita (a ação não aparece)", !regras.cobrancaAceitaTroca({ tipo_cobranca: "PIX", id_empresa: 2, status: "A_RECEBER" }));
confere("PIX pago NÃO aceita", !regras.cobrancaAceitaTroca({ tipo_cobranca: "PIX", id_empresa: 3, status: "PAID", paid_at: "2026-11-05T10:00:00Z" }));
confere("Boleto NÃO aceita", !regras.cobrancaAceitaTroca({ tipo_cobranca: "BOLETO", id_empresa: 3, status: "A_RECEBER" }));
confere("recusas da troca = todas as de hoje menos NOTA_AUTORIZADA",
  !regras.RECUSAS_DA_TROCA.includes("NOTA_AUTORIZADA") && ["COBRANCA_RECEBIDA", "TITULO_LIQUIDADO", "PRODUCAO_ATIVA", "VINCULO_AMBIGUO", "CREDITO_CONSUMIDO", "TITULO_EM_ABERTO"].every((c) => regras.RECUSAS_DA_TROCA.includes(c as never)));
{
  const linha = regras.montarCobrancaDaTroca({ ...ANTIGA, id_empresa: 3 }, MODELO, new Date("2026-11-05T21:00:00-03:00"));
  confere("linha nova: mesma proposta, valor e pagador", linha.id_int === 24692 && linha.valor === 213 && linha.id_cliente === 777 && linha.documento === ANTIGA.documento && linha.cliente === ANTIGA.cliente, linha);
  confere("linha nova: Faturado A_VENCER não confirmado, condição da tela", linha.tipo_cobranca === "E-FATURADO" && linha.status === "A_VENCER" && linha.confirmado === false && linha.forma_fatu === "30 DIAS" && linha.id_modelo_cobranca === MODELO.id, linha);
  confere("vencimento = hoje em São Paulo + dias da condição (05/11 21h -> 05/12)", linha.vencimento === "2026-12-05", linha.vencimento);
}

// ── B. troca feliz ─────────────────────────────────────────────────────────
console.log("== B. troca PIX -> Faturado com NF-e autorizada");
{
  prepararBanco();
  fetchFalso({ corpo: `=[Object: ${JSON.stringify(CONFIRMOU)}]` });
  const r = await trocar();
  confere("responde sucesso", r.status === 200 && r.json.success === true, r.json);
  confere("a nova nasce (insert em pagamentos_v2)", Boolean(r.insertNova));
  const nova = ((r.insertNova?.payload as Record<string, unknown>[]) ?? [])[0] ?? {};
  confere("a nova copia proposta, valor e pagador da antiga", nova.id_int === 24692 && nova.valor === 213 && nova.id_cliente === 777 && nova.id_empresa === 3, nova);
  confere("o PIX foi pedido ao banco com o código da antiga", r.aoBanco.length === 1 && JSON.parse(r.aoBanco[0].body).cod_validador === ANTIGA.cod_solicitacao_inter, r.aoBanco);
  confere("a antiga cai (CANCELADO)", Boolean(r.cancelaAntiga));
  confere("ORDEM: a nova nasce antes de a antiga cair", r.posInsert >= 0 && r.posCancelaAntiga > r.posInsert, { insert: r.posInsert, cancela: r.posCancelaAntiga });
  const pc = (r.cancelaAntiga?.payload ?? {}) as Record<string, unknown>;
  confere("motivo_cancela da antiga cita a nova e o motivo", String(pc.motivo_cancela).includes("24692-B") && String(pc.motivo_cancela).includes("cliente paga faturado"), pc);
  confere("motivo_troca da antiga registra autor, nova e motivo", String(pc.motivo_troca).includes("Financeiro Teste") && String(pc.motivo_troca).includes("24692-B"), pc);
  const h = r.historico.join(" | ");
  confere("Histórico liga as duas cobranças, com autor e motivo", h.includes("24692-A") && h.includes("24692-B") && h.includes("Financeiro Teste") && h.includes("cliente paga faturado") && h.includes("Nota fiscal mantida"), r.historico);
  confere("a nova não é cancelada", !r.cancelaNova);
  confere("STATUS: a rota não grava em propostas", !r.gravouProposta, r.escritas);
  confere("NF-e: nada gravado em notas_fiscais", !r.chamadas.some((c) => c.tabela === "notas_fiscais" && c.op !== "select"));
  confere("só o webhook do PIX foi chamado (liberação automática fica para a tela)", rede.length === 1);
}

// ── C. banco não confirma ───────────────────────────────────────────────────
console.log("== C. banco recusa ou não responde");
for (const [nome, resposta] of [
  ["banco recusou", { corpo: `=[Object: ${JSON.stringify(RECUSOU)}]` }],
  ["PIX consta pago no banco", { corpo: { txid: "X", status: "CONCLUIDA" } }],
  ["200 sem confirmação", { corpo: "=[object Object]" }],
  ["erro HTTP", { status: 500, corpo: { success: false } }],
  ["rede", "REDE"]
] as const) {
  prepararBanco();
  fetchFalso(resposta as Parameters<typeof fetchFalso>[0]);
  const r = await trocar();
  confere(`${nome}: responde que não trocou`, r.json.success === false && r.json.code === "PIX_NAO_CANCELADO_NO_BANCO" && /não foi trocada/.test(String(r.json.message)), r.json);
  confere(`${nome}: a antiga continua (nenhum CANCELADO nela)`, !r.cancelaAntiga);
  const pn = (r.cancelaNova?.payload ?? {}) as Record<string, unknown>;
  confere(`${nome}: a nova é cancelada com o motivo`, Boolean(r.cancelaNova) && /não confirmou/.test(String(pn.motivo_cancela)) && String(pn.motivo_cancela).includes("cliente paga faturado"), pn);
  confere(`${nome}: a marca da antiga é solta`, r.soltouMarca);
  confere(`${nome}: Histórico registra a troca não concluída`, r.historico.some((m) => /não concluída/.test(m) && m.includes("24692-A") && m.includes("24692-B")), r.historico);
  confere(`${nome}: STATUS: a rota não grava em propostas`, !r.gravouProposta);
}

// ── D. cancelar sem trocar continua barrado ────────────────────────────────
console.log("== D. cancelar sem trocar, com nota autorizada");
{
  prepararBanco();
  fetchFalso({ corpo: CONFIRMOU });
  const req = new Request("http://localhost/api/cobrancas/cancelar-externo", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ id: ANTIGA.id, id_int: ANTIGA.id_int, tipo_cobranca: "PIX", acao_local: "CANCEL", motivo: "teste" })
  });
  const resposta = await cancelarExterno.POST(req);
  const json = (await resposta.json()) as Record<string, unknown>;
  confere("cancelar-externo recusa com NOTA_AUTORIZADA", resposta.status === 409 && json.code === "NOTA_AUTORIZADA" && /41391/.test(String(json.message)), json);
  confere("nada foi ao banco e nada foi gravado", rede.length === 0 && falso.chamadas.every((c) => c.op === "select"));
}

// ── E. recusas antes de gravar ──────────────────────────────────────────────
console.log("== E. recusas antes de gravar qualquer coisa");
async function recusaSemEscrita(nome: string, opcoes: Parameters<typeof prepararBanco>[0], corpo: Record<string, unknown>, codigo?: string) {
  prepararBanco(opcoes);
  fetchFalso({ corpo: CONFIRMOU });
  const r = await trocar(corpo);
  confere(`${nome}: recusa${codigo ? ` (${codigo})` : ""}`, r.json.success === false && (!codigo || r.json.code === codigo), r.json);
  confere(`${nome}: nada gravado e nada ao banco`, r.escritas.length === 0 && r.aoBanco.length === 0, r.escritas);
}
await recusaSemEscrita("Ideal Birô", { antiga: { id_empresa: 2 } }, {}, "EMPRESA_NAO_ACEITA");
await recusaSemEscrita("produção ativa", { proposta: { status_interno: "EM PRODUCAO" } }, {}, "PRODUCAO_ATIVA");
await recusaSemEscrita("PIX já pago", { antiga: { status: "PAID", paid_at: "2026-11-05T12:00:00Z" } }, {}, "COBRANCA_RECEBIDA");
await recusaSemEscrita("sem motivo", {}, { motivo: "  " });
await recusaSemEscrita("sem condição", {}, { id_modelo_cobranca: "" });
await recusaSemEscrita("troca já registrada", { antiga: { motivo_troca: "TROCA EM ANDAMENTO por X" } }, {}, "TROCA_EM_ANDAMENTO");
await recusaSemEscrita("pedido entregue", { proposta: { status_interno: "ENTREGUE" } }, {});
{
  prepararBanco({ marcou: false });
  fetchFalso({ corpo: CONFIRMOU });
  const r = await trocar();
  confere("outra troca venceu a trava: recusa sem criar nada", r.json.code === "TROCA_EM_ANDAMENTO" && !r.insertNova && r.aoBanco.length === 0, r.json);
}
{
  prepararBanco({ insereErro: "falha qualquer" });
  fetchFalso({ corpo: CONFIRMOU });
  const r = await trocar();
  confere("falha ao criar a nova: PIX intocado, nada ao banco, marca solta", r.json.success === false && r.aoBanco.length === 0 && !r.cancelaAntiga && r.soltouMarca, r.json);
}

// ── F. a consulta da janela ─────────────────────────────────────────────────
console.log("== F. GET (a janela consulta ao abrir)");
async function consultar() {
  const resposta = await rota.GET(new Request(`http://localhost/api/cobrancas/trocar-forma-pagamento?id=${ANTIGA.id}`, { headers: { authorization: "Bearer token-de-teste" } }));
  return (await resposta.json()) as Record<string, unknown>;
}
prepararBanco();
{
  const j = await consultar();
  confere("PIX com nota: pode trocar, e a janela sabe da nota", j.success === true && j.pode === true && j.notaAutorizada === true && j.valor === 213, j);
  confere("a consulta não grava nada", falso.chamadas.every((c) => c.op === "select"));
}
prepararBanco({ antiga: { id_empresa: 2 } });
{
  const j = await consultar();
  confere("Birô: não pode trocar, com o motivo", j.success === true && j.pode === false && j.code === "EMPRESA_NAO_ACEITA", j);
}


// ── G. outras formas internas (10/11/2026) ──────────────────────────────────
console.log("== G. outras formas internas: E-Permuta, E-Amostra, E-Retrabalho; E-Crédito e externas fora");
/** Contexto do retrabalho: motivo_copia na proposta e E-Retrabalho anterior no pedido. */
function contextoRetrabalho(motivoCopia: string | null, jaTeveRetrabalho: boolean) {
  falso.interceptar("pagamentos_v2:select", (_p, chamada) =>
    chamada.filtros.some((f) => f[0] === "ilike") ? { data: jaTeveRetrabalho ? [{ id: "r1" }] : [], error: null } : undefined
  );
  falso.responder("propostas:select", {
    data: { id_int: 24692, status_interno: "AGUARDANDO", is_prd_aprovado: false, is_avulso: false, empresa: "E3 BRINDES LTDA", vendedor: "Y", motivo_copia: motivoCopia },
    error: null
  });
}
const tipos = (j: Record<string, unknown>) => ((j.destinos ?? []) as { tipo: string }[]).map((d) => d.tipo).join(",");

prepararBanco();
contextoRetrabalho(null, false);
{
  const j = await consultar();
  confere("pedido comum: a janela oferece Faturado, Chave Pix, E-Permuta e E-Amostra", j.pode === true && tipos(j) === "E-FATURADO,CHAVE-PIX,E-PERMUTA,E-AMOSTRA", j.destinos);
  confere("pedido comum: E-Crédito, E-Retrabalho e formas de banco não aparecem", !tipos(j).split(",").some((t) => ["E-CREDITO", "E-RETRABALHO", "BOLETO", "PIX", "CARD_PARCELADO"].includes(t)), j.destinos);
}
prepararBanco();
contextoRetrabalho("RETRABALHO", false);
{
  const j = await consultar();
  confere("pedido de retrabalho: só E-Retrabalho", j.pode === true && tipos(j) === "E-RETRABALHO", j.destinos);
}

// E-Amostra: cortesia, sem condição.
prepararBanco();
contextoRetrabalho(null, false);
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar({ tipo: "E-AMOSTRA", id_modelo_cobranca: "", motivo: "amostra combinada" });
  const linha = ((r.insertNova?.payload as Record<string, unknown>[]) ?? [])[0] ?? {};
  confere("E-Amostra: troca concluída", r.status === 200 && r.json.success === true && /E-Amostra/.test(String(r.json.message)), r.json);
  confere("E-Amostra: nova com o mesmo valor, A_VENCER, não confirmada", linha.tipo_cobranca === "E-AMOSTRA" && linha.valor === 213 && linha.status === "A_VENCER" && linha.confirmado === false, linha);
  confere("E-Amostra: sem condição (forma_fatu, id_modelo e p_* nulos)", linha.forma_fatu === null && linha.id_modelo_cobranca === null && linha.p_qtd_parcelas === null, linha);
  confere("E-Amostra: condição nem é lida", !r.chamadas.some((c) => c.tabela === "modelos_cobranca"));
  confere("E-Amostra: a nova nasce antes de a antiga cair", r.posInsert >= 0 && r.posCancelaAntiga > r.posInsert);
  const pc = (r.cancelaAntiga?.payload ?? {}) as Record<string, unknown>;
  confere("E-Amostra: antiga cai citando a forma nova", /E-Amostra/.test(String(pc.motivo_cancela)) && /Trocada por E-Amostra, cobrança 24692-B/.test(String(pc.motivo_troca)), pc);
  confere("E-Amostra: Histórico liga as duas e diz a forma", r.historico.some((m) => m.includes("24692-A") && m.includes("24692-B") && m.includes("(E-Amostra)") && m.includes("amostra combinada")), r.historico);
  confere("E-Amostra: nada em propostas nem em notas", !r.gravouProposta && !r.chamadas.some((c) => c.tabela === "notas_fiscais" && c.op !== "select"));
}

// E-Amostra com o banco recusando: a antiga continua, a nova é desfeita.
prepararBanco();
contextoRetrabalho(null, false);
fetchFalso({ corpo: `=[Object: ${JSON.stringify(RECUSOU)}]` });
{
  const r = await trocar({ tipo: "E-AMOSTRA", id_modelo_cobranca: "", motivo: "amostra combinada" });
  confere("E-Amostra, banco recusa: não trocou", r.json.success === false && r.json.code === "PIX_NAO_CANCELADO_NO_BANCO", r.json);
  confere("E-Amostra, banco recusa: antiga intacta, nova cancelada, marca solta", !r.cancelaAntiga && Boolean(r.cancelaNova) && r.soltouMarca);
  confere("E-Amostra, banco recusa: Histórico cita a E-Amostra cancelada", r.historico.some((m) => /não concluída/.test(m) && m.includes("(E-Amostra) foi cancelada")), r.historico);
}

// E-Permuta: exige condição, como no Gerar cobrança.
await (async () => {
  prepararBanco();
  contextoRetrabalho(null, false);
  fetchFalso({ corpo: CONFIRMOU });
  const r = await trocar({ tipo: "E-PERMUTA", id_modelo_cobranca: "" });
  confere("E-Permuta sem condição: recusa sem gravar", r.json.success === false && r.escritas.length === 0 && r.aoBanco.length === 0, r.json);
})();
prepararBanco();
contextoRetrabalho(null, false);
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar({ tipo: "E-PERMUTA" });
  const linha = ((r.insertNova?.payload as Record<string, unknown>[]) ?? [])[0] ?? {};
  confere("E-Permuta com condição: nova E-PERMUTA com a condição", r.json.success === true && linha.tipo_cobranca === "E-PERMUTA" && linha.forma_fatu === "30 DIAS" && linha.id_modelo_cobranca === MODELO.id, linha);
  confere("E-Permuta: Histórico com forma e condição", r.historico.some((m) => m.includes("(E-Permuta, 30 DIAS)")), r.historico);
}

// Regra do retrabalho, antes de gravar.
async function recusaDeDestino(nome: string, contexto: [string | null, boolean], corpo: Record<string, unknown>, codigo: string) {
  prepararBanco();
  contextoRetrabalho(...contexto);
  fetchFalso({ corpo: CONFIRMOU });
  const r = await trocar(corpo);
  confere(`${nome}: recusa (${codigo})`, r.json.success === false && r.json.code === codigo, r.json);
  confere(`${nome}: nada gravado e nada ao banco`, r.escritas.length === 0 && r.aoBanco.length === 0, r.escritas);
}
await recusaDeDestino("E-Retrabalho em pedido comum", [null, false], { tipo: "E-RETRABALHO", id_modelo_cobranca: "" }, "DESTINO_NAO_PERMITIDO");
await recusaDeDestino("Faturado em pedido de retrabalho", ["RETRABALHO", false], { tipo: "E-FATURADO" }, "DESTINO_NAO_PERMITIDO");
await recusaDeDestino("Boleto (forma de banco, fora)", [null, false], { tipo: "BOLETO" }, "DESTINO_NAO_ACEITO");
await recusaDeDestino("PIX novo (forma de banco, fora)", [null, false], { tipo: "PIX" }, "DESTINO_NAO_ACEITO");
await recusaDeDestino("Cartão (forma de banco, fora)", [null, false], { tipo: "CARD_PARCELADO" }, "DESTINO_NAO_ACEITO");

// E-Retrabalho em pedido de retrabalho: passa, sem condição.
prepararBanco();
contextoRetrabalho("RETRABALHO", false);
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar({ tipo: "E-RETRABALHO", id_modelo_cobranca: "" });
  const linha = ((r.insertNova?.payload as Record<string, unknown>[]) ?? [])[0] ?? {};
  confere("E-Retrabalho em retrabalho: troca concluída, sem condição", r.json.success === true && linha.tipo_cobranca === "E-RETRABALHO" && linha.forma_fatu === null, r.json);
}

// Faturado sem tipo no corpo (a tela antiga): igual a antes.
prepararBanco();
contextoRetrabalho(null, false);
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar();
  const linha = ((r.insertNova?.payload as Record<string, unknown>[]) ?? [])[0] ?? {};
  confere("Faturado sem tipo no corpo: E-FATURADO com a condição, mensagem de sempre", r.json.success === true && linha.tipo_cobranca === "E-FATURADO" && linha.forma_fatu === "30 DIAS" && String(r.json.message).includes("(Faturado) criada"), r.json);
  confere("Faturado: Histórico de sempre", r.historico.some((m) => m.includes("(Faturado, 30 DIAS)")), r.historico);
}


// ── H. E-Crédito (10/11/2026, caso 24574) ───────────────────────────────────
console.log("== H. E-Crédito: consome o crédito, devolve se o banco não confirmar, recusa sem saldo");
/** Saldo de crédito do pagador e, se quiser, uma pendência a favor do cliente. */
function prepararCredito(saldo: number, opcoes: { pendencia?: number; consumoFalha?: string; desfazerFalha?: string } = {}) {
  prepararBanco();
  contextoRetrabalho(null, false);
  falso.responder("movimento_credito:select", { data: [{ id: 1, valor: saldo, tipo: "CREDITO" }], error: null });
  falso.responder("conta_corrente_pendencias:select", {
    data: opcoes.pendencia ? [{ id: 77, valor_saldo: opcoes.pendencia }] : [],
    error: null
  });
  falso.responder("rpc:cc_usar_pendencia", { data: 900, error: null });
  falso.responder("rpc:mc_usar_credito_avulso", opcoes.consumoFalha ? { data: null, error: { message: opcoes.consumoFalha } } : { data: 901, error: null });
  falso.responder(
    "rpc:mc_desfazer_credito_da_troca",
    opcoes.desfazerFalha ? { data: null, error: { message: opcoes.desfazerFalha } } : { data: { ja_desfeito: false, devolvido: 213, movimentos: [902] }, error: null }
  );
}
const rpcs = (r: { chamadas: { tabela: string; payload?: unknown }[] }, nome: string) =>
  r.chamadas.filter((c) => c.tabela === `rpc:${nome}`).map((c) => (c.payload ?? {}) as Record<string, unknown>);
const posicao = (r: { chamadas: { tabela: string; op: string; payload?: unknown }[] }, pred: (c: { tabela: string; op: string; payload?: unknown }) => boolean) =>
  r.chamadas.findIndex(pred);

// GET: com saldo, E-Crédito aparece, com o saldo.
prepararCredito(500);
{
  const j = await consultar();
  const cred = j.credito as { disponivel: boolean; saldo: number } | null;
  confere("com saldo: a janela oferece E-Crédito, com o saldo", tipos(j).includes("E-CREDITO") && cred?.disponivel === true && cred?.saldo === 500, j);
}

// PROVA 1: com saldo, banco confirma — a nova nasce e consome o crédito, a antiga cai.
prepararCredito(500);
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar({ tipo: "E-CREDITO", id_modelo_cobranca: "", motivo: "cliente pagou o PIX pela chave" });
  const linha = ((r.insertNova?.payload as Record<string, unknown>[]) ?? [])[0] ?? {};
  const usos = rpcs(r, "mc_usar_credito_avulso");
  confere("E-Crédito com saldo: troca concluída", r.status === 200 && r.json.success === true && /E-Crédito/.test(String(r.json.message)), r.json);
  confere("E-Crédito: nova E-CREDITO paga, não conferida, mesmo valor", linha.tipo_cobranca === "E-CREDITO" && linha.status === "PAID" && Boolean(linha.paid_at) && linha.confirmado === false && linha.valor === 213, linha);
  confere("E-Crédito: descrição liga a nova ao PIX (a função do banco confere)", String(linha.descricao).includes("(troca da 24692-A)"), linha.descricao);
  confere("E-Crédito: consome o valor inteiro na nova", usos.length === 1 && usos[0].p_valor === 213 && usos[0].p_id_pagamento === NOVA.id && usos[0].p_id_cliente === 777, usos);
  const posConsumo = posicao(r, (c) => c.tabela === "rpc:mc_usar_credito_avulso");
  confere("ORDEM: nova -> consumo -> antiga cai", r.posInsert >= 0 && posConsumo > r.posInsert && r.posCancelaAntiga > posConsumo, { insert: r.posInsert, consumo: posConsumo, antiga: r.posCancelaAntiga });
  confere("E-Crédito: o PIX foi ao banco uma vez", r.aoBanco.length === 1);
  confere("E-Crédito: nada devolvido (troca concluída)", rpcs(r, "mc_desfazer_credito_da_troca").length === 0);
  const pc = (r.cancelaAntiga?.payload ?? {}) as Record<string, unknown>;
  confere("E-Crédito: antiga cai citando a E-Crédito", /Trocada por E-Crédito, cobrança 24692-B/.test(String(pc.motivo_troca)), pc);
  confere("E-Crédito: Histórico liga as duas", r.historico.some((m) => m.includes("24692-A") && m.includes("24692-B") && m.includes("(E-Crédito)")), r.historico);
  confere("E-Crédito: nada em propostas nem em notas", !r.gravouProposta && !r.chamadas.some((c) => c.tabela === "notas_fiscais" && c.op !== "select"));
}

// Pendência primeiro, o resto no avulso (ordem de usar-credito).
prepararCredito(500, { pendencia: 100 });
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar({ tipo: "E-CREDITO", id_modelo_cobranca: "" });
  const pend = rpcs(r, "cc_usar_pendencia");
  const avulso = rpcs(r, "mc_usar_credito_avulso");
  confere("E-Crédito: pendência 100 primeiro, avulso 113 depois", pend.length === 1 && pend[0].p_valor === 100 && pend[0].p_id_pendencia === 77 && pend[0].p_modo === "CREDITO_IMEDIATO" && avulso.length === 1 && avulso[0].p_valor === 113, { pend, avulso });
}

// PROVA 2: banco recusa — a antiga continua, a nova é desfeita e o crédito volta.
prepararCredito(500);
fetchFalso({ corpo: `=[Object: ${JSON.stringify(RECUSOU)}]` });
{
  const r = await trocar({ tipo: "E-CREDITO", id_modelo_cobranca: "", motivo: "cliente pagou o PIX pela chave" });
  const volta = rpcs(r, "mc_desfazer_credito_da_troca");
  confere("E-Crédito, banco recusa: não trocou", r.json.success === false && r.json.code === "PIX_NAO_CANCELADO_NO_BANCO", r.json);
  confere("E-Crédito, banco recusa: o crédito volta pela função do banco, ligada às duas cobranças", volta.length === 1 && volta[0].p_id_pagamento === NOVA.id && volta[0].p_id_pagamento_antiga === ANTIGA.id && /não confirmou/.test(String(volta[0].p_motivo)), volta);
  const posVolta = posicao(r, (c) => c.tabela === "rpc:mc_desfazer_credito_da_troca");
  const posSolta = posicao(r, (c) => c.tabela === "pagamentos_v2" && c.op === "update" && ((c.payload ?? {}) as Record<string, unknown>).motivo_troca === null);
  confere("E-Crédito, banco recusa: devolve antes de soltar a marca (a função exige a troca em andamento)", posVolta >= 0 && posSolta > posVolta, { posVolta, posSolta });
  confere("E-Crédito, banco recusa: a antiga continua", !r.cancelaAntiga);
  confere("E-Crédito, banco recusa: a nova não é cancelada à parte (a função cancela junto)", !r.cancelaNova);
  confere("E-Crédito, banco recusa: Histórico registra", r.historico.some((m) => /não concluída/.test(m) && m.includes("(E-Crédito) foi cancelada")), r.historico);
}

// PROVA 3: sem saldo — recusa mostrando o saldo, sem gravar nada.
prepararCredito(100);
{
  const j = await consultar();
  const cred = j.credito as { disponivel: boolean; saldo: number; motivo: string } | null;
  confere("sem saldo: E-Crédito não aparece na lista", j.pode === true && !tipos(j).includes("E-CREDITO") && tipos(j).includes("E-FATURADO"), j.destinos);
  confere("sem saldo: a janela recebe o saldo e o motivo", cred?.disponivel === false && cred?.saldo === 100 && /R\$\s100,00/.test(cred?.motivo ?? "") && /R\$\s213,00/.test(cred?.motivo ?? ""), cred);
}
prepararCredito(100);
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar({ tipo: "E-CREDITO", id_modelo_cobranca: "" });
  confere("sem saldo: recusa (CREDITO_INDISPONIVEL) mostrando o saldo", r.json.success === false && r.json.code === "CREDITO_INDISPONIVEL" && r.json.saldoCredito === 100 && /R\$\s100,00/.test(String(r.json.message)), r.json);
  confere("sem saldo: nada gravado, nenhum crédito usado, nada ao banco", r.escritas.length === 0 && rpcs(r, "mc_usar_credito_avulso").length === 0 && r.aoBanco.length === 0, r.escritas);
}

// Consumo falha: devolve o que saiu, cancela a nova e o PIX nem vai ao banco.
prepararCredito(500, { consumoFalha: "CC_SALDO_INSUFICIENTE: saldo R$ 10 < solicitado R$ 213" });
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar({ tipo: "E-CREDITO", id_modelo_cobranca: "" });
  confere("consumo falha: não trocou e avisa que o PIX segue", r.json.code === "CREDITO_NAO_CONSUMIDO" && /PIX continua ativo/.test(String(r.json.message)), r.json);
  confere("consumo falha: devolve pela função do banco, PIX intocado e fora do banco", rpcs(r, "mc_desfazer_credito_da_troca").length === 1 && !r.cancelaAntiga && r.aoBanco.length === 0 && r.soltouMarca);
}

// Devolução falha depois da recusa do banco: alerta forte.
prepararCredito(500, { desfazerFalha: "MC_CONCORRENCIA: mudou" });
fetchFalso({ corpo: `=[Object: ${JSON.stringify(RECUSOU)}]` });
{
  const r = await trocar({ tipo: "E-CREDITO", id_modelo_cobranca: "" });
  confere("devolução falha: DESFAZER_FALHOU e ATENÇÃO no Histórico", r.json.code === "DESFAZER_FALHOU" && r.historico.some((m) => m.startsWith("ATENÇÃO") && m.includes("E-Crédito")), r);
}

// E-Crédito em pedido de retrabalho: não vale (regra do gatilho).
prepararCredito(500);
contextoRetrabalho("RETRABALHO", false);
{
  const j = await consultar();
  confere("retrabalho: E-Crédito não aparece", !tipos(j).includes("E-CREDITO"), j.destinos);
}

// ── I. Chave Pix (17/11/2026) ────────────────────────────────────────────────
console.log("== I. Chave Pix: PIX já recebido na chave da empresa");
const E2E = "E18236120202611171030ABCDEFGHIJK";
const HOJE_SP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const NOVA_CHAVE = { id: NOVA.id, id_pagamento: NOVA.id_pagamento };

{
  const ok = { dataPagamento: HOJE_SP, e2eId: E2E.toLowerCase(), comprovante: "" };
  confere("regra: campos completos passam", regras.problemaNaChavePix(ok, HOJE_SP) === null);
  confere("regra: sem e2eId e sem comprovante passa (opcionais desde 17/11)", regras.problemaNaChavePix({ ...ok, e2eId: "", comprovante: "" }, HOJE_SP) === null);
  confere("regra: só o comprovante passa", regras.problemaNaChavePix({ ...ok, e2eId: "", comprovante: "Autenticação 9F2A" }, HOJE_SP) === null);
  confere("regra: e2eId curto recusa", /32 letras/.test(regras.problemaNaChavePix({ ...ok, e2eId: "E123" }, HOJE_SP) ?? ""));
  confere("regra: data futura recusa", /futura/.test(regras.problemaNaChavePix({ ...ok, dataPagamento: "2999-01-01" }, HOJE_SP) ?? ""));
  confere("regra: descrição com data e e2eId normalizado", regras.descricaoDaChavePix({ dataPagamento: "2026-11-13", e2eId: " " + E2E.toLowerCase(), comprovante: "" }) === "recebido na chave em 13/11/2026, e2eId " + E2E);
  const dup = regras.recusaDaFuncaoChavePix("CHAVE_DUPLICADA: este e2eId já foi registrado na cobrança 24500-B");
  confere("regra: recusa da função vira 409 com a mensagem", dup?.status === 409 && dup.code === "CHAVE_DUPLICADA" && /24500-B/.test(dup.message), dup);
  const perm = regras.recusaDaFuncaoChavePix("PERM: sem permissão conferencia.confirm");
  confere("regra: PERM do banco vira 403", perm?.status === 403 && perm.code === "CHAVE_PERMISSAO", perm);
  confere("regra: erro sem código não é recusa", regras.recusaDaFuncaoChavePix("connection reset") === null);
}

/** Usuário sem super admin: perfil com troca e escopo, com ou sem confirmar pagamento. */
function usuarioComum(confirmaPagamento: boolean) {
  falso.responder("usuarios:select", { data: { id_perfil: 5, id_empresa: 1, is_super_adm: false, is_admin: false, nome_usuario: "Atendente Teste" }, error: null });
  falso.responder("perfis:select", {
    data: { permissoes: ["cobrancas.cancel", "propostas.view_all", ...(confirmaPagamento ? ["conferencia.confirm"] : [])] },
    error: null
  });
}
/**
 * Banco da Chave Pix: a função cria a nova; a releitura da nova, a lista de
 * cobranças do pedido (trava de quitação) e a gravação da conferência.
 */
function prepararChave(opcoes: {
  funcao?: { data: unknown; error: unknown };
  totalProposta?: number;
  outraAtiva?: number;
  jaConferidaPorOutro?: boolean;
} = {}) {
  prepararBanco();
  contextoRetrabalho(null, false);
  falso.responder("rpc:fin_troca_criar_chave_pix", opcoes.funcao ?? { data: NOVA_CHAVE, error: null });
  const novaLida = { ...ANTIGA, id: NOVA.id, id_pagamento: NOVA.id_pagamento, status: "PAID", paid_at: new Date().toISOString(), forma_pgto: "CHAVE PIX", motivo_troca: null, cod_solicitacao_inter: null };
  const doPedido = [
    { id: ANTIGA.id, id_int: 24692, valor: 213, status: "CANCELADO", confirmado: false, tipo_cobranca: "PIX" },
    { id: NOVA.id, id_int: 24692, valor: 213, status: "PAID", confirmado: false, tipo_cobranca: "PIX" },
    ...(opcoes.outraAtiva ? [{ id: "c0000000-0000-0000-0000-000000000009", id_int: 24692, valor: opcoes.outraAtiva, status: "A_RECEBER", confirmado: false, tipo_cobranca: "PIX" }] : [])
  ];
  const eq = (chamada: { filtros: unknown[][] }, campo: string) =>
    (chamada.filtros.find((f) => f[0] === "eq" && (f[1] as unknown[])[0] === campo)?.[1] as unknown[] | undefined)?.[1];
  falso.interceptar("pagamentos_v2:select", (_p, chamada) => {
    if (chamada.filtros.some((f) => f[0] === "ilike")) return { data: [], error: null };
    if (eq(chamada, "id") === NOVA.id) return { data: novaLida, error: null };
    if (eq(chamada, "id_int") !== undefined && eq(chamada, "id") === undefined) return { data: doPedido, error: null };
    return undefined;
  });
  falso.interceptar("pagamentos_v2:update", (payload) =>
    (payload as Record<string, unknown>)?.confirmado === true
      ? { data: opcoes.jaConferidaPorOutro ? [] : [{ id: NOVA.id }], error: null }
      : undefined
  );
  falso.responder("propostas:select", {
    data: { id_int: 24692, status_interno: "AGUARDANDO", is_prd_aprovado: false, is_avulso: false, empresa: "E3 BRINDES LTDA", vendedor: "Y", motivo_copia: null, valor_total: opcoes.totalProposta ?? 213 },
    error: null
  });
}
/** A gravação da conferência: update com confirmado = true. */
const conferenciaGravada = (r: { chamadas: { tabela: string; op: string; payload?: unknown; filtros: unknown[][] }[] }) =>
  r.chamadas.find((c) => c.tabela === "pagamentos_v2" && c.op === "update" && ((c.payload ?? {}) as Record<string, unknown>).confirmado === true);
const corpoChave = { tipo: "CHAVE-PIX", id_modelo_cobranca: "", motivo: "cliente pagou pela chave Pix", data_pagamento: HOJE_SP, e2e_id: E2E, comprovante: "" };

prepararChave();
usuarioComum(false);
{
  const j = await consultar();
  confere("sem conferencia.confirm: Chave Pix não aparece", j.pode === true && !tipos(j).includes("CHAVE-PIX") && tipos(j).includes("E-FATURADO"), j.destinos);
}
prepararChave();
usuarioComum(true);
{
  const j = await consultar();
  confere("com conferencia.confirm: Chave Pix aparece", tipos(j).includes("CHAVE-PIX"), j.destinos);
}
prepararChave();
usuarioComum(false);
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar(corpoChave);
  confere("sem conferencia.confirm: POST recusa (DESTINO_NAO_PERMITIDO) sem gravar", r.json.code === "DESTINO_NAO_PERMITIDO" && r.escritas.length === 0 && r.aoBanco.length === 0, r.json);
}

// Feliz: banco confirma.
prepararChave();
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar(corpoChave);
  const funcao = rpcs(r, "fin_troca_criar_chave_pix");
  confere("Chave Pix: troca concluída", r.status === 200 && r.json.success === true && /Chave Pix/.test(String(r.json.message)), r.json);
  confere("Chave Pix: a nova nasce pela função do banco, não por insert direto", funcao.length === 1 && !r.insertNova, { funcao, insert: r.insertNova });
  confere("Chave Pix: a função recebe origem, data, e2eId, comprovante e motivo", funcao[0]?.p_id_origem === ANTIGA.id && funcao[0]?.p_data_pagamento === HOJE_SP && funcao[0]?.p_e2e_id === E2E && funcao[0]?.p_comprovante === null && funcao[0]?.p_motivo === "cliente pagou pela chave Pix", funcao[0]);
  const posFuncao = posicao(r, (c) => c.tabela === "rpc:fin_troca_criar_chave_pix");
  const posMarca = posicao(r, (c) => c.tabela === "pagamentos_v2" && c.op === "update" && String(((c.payload ?? {}) as Record<string, unknown>).motivo_troca ?? "").startsWith("TROCA EM ANDAMENTO"));
  confere("ORDEM: marca -> nova (função) -> antiga cai", posMarca >= 0 && posFuncao > posMarca && r.posCancelaAntiga > posFuncao, { posMarca, posFuncao, antiga: r.posCancelaAntiga });
  confere("Chave Pix: o PIX do Vibe foi ao banco uma vez", r.aoBanco.length === 1);
  const pc = (r.cancelaAntiga?.payload ?? {}) as Record<string, unknown>;
  confere("Chave Pix: antiga cai citando a Chave Pix, a data e o e2eId", /Trocada por Chave Pix \(recebido na chave em \d{2}\/\d{2}\/\d{4}, e2eId E18236/.test(String(pc.motivo_troca)) && /\(Chave Pix\)/.test(String(pc.motivo_cancela)), pc);
  confere("Chave Pix: Histórico liga as duas, com o recebimento", r.historico.some((m) => m.includes("24692-A") && m.includes("24692-B") && m.includes("Chave Pix, recebido na chave em")), r.historico);
  confere("Chave Pix: nada em notas", !r.chamadas.some((c) => c.tabela === "notas_fiscais" && c.op !== "select"));
  const conf = conferenciaGravada(r);
  const pconf = (conf?.payload ?? {}) as Record<string, unknown>;
  const filtrosConf = JSON.stringify(conf?.filtros ?? []);
  confere("AJUSTE: a Chave Pix é conferida pelo mesmo usuário (payload do Confirmar Conferência)", pconf.confirmado === true && pconf.confirmado_por === "Financeiro Teste" && Boolean(pconf.data_confirmacao), pconf);
  confere("AJUSTE: grava só se ainda PAID e não conferida (mesma trava da conferência automática)", filtrosConf.includes(NOVA.id) && filtrosConf.includes('"status","PAID"') && filtrosConf.includes('"confirmado",false'), conf?.filtros);
  const posConf = r.chamadas.indexOf(conf as never);
  confere("AJUSTE: conferência só depois que o banco confirmou e a antiga caiu", r.aoBanco.length === 1 && posConf > r.posCancelaAntiga && r.posCancelaAntiga > 0, { posConf, antiga: r.posCancelaAntiga });
  confere("AJUSTE: aviso de cobrança conferida no chat, em nome do usuário", r.historico.some((m) => m.startsWith("Cobrança conferida e liberada")), r.historico);
  confere("AJUSTE: a resposta diz que foi conferida", r.json.conferida === true && r.json.motivoNaoConferida === null, r.json);
}

// AJUSTE: a trava de quitação barra — a troca vale, a cobrança fica na Conferência.
prepararChave({ totalProposta: 500, outraAtiva: 287 });
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar(corpoChave);
  confere("quitação barra: a troca vale (antiga cai)", r.status === 200 && r.json.success === true && Boolean(r.cancelaAntiga), r.json);
  confere("quitação barra: não confere e diz o motivo", r.json.conferida === false && /menor que o total/.test(String(r.json.motivoNaoConferida)) && !conferenciaGravada(r), r.json);
  confere("quitação barra: Histórico avisa que segue na Fila de Conferência", r.historico.some((m) => m.includes("(Chave Pix) foi criada paga, mas não foi conferida") && m.includes("Fila de Conferência")), r.historico);
}

// AJUSTE: outra conferência chegou antes — vale como conferida, sem segundo aviso.
prepararChave({ jaConferidaPorOutro: true });
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar(corpoChave);
  confere("já conferida por outro: responde conferida, sem aviso de conferência repetido", r.json.conferida === true && !r.historico.some((m) => m.startsWith("Cobrança conferida e liberada")), r.json);
}

// Banco recusa: a nova é cancelada, o PIX continua.
prepararChave();
fetchFalso({ corpo: `=[Object: ${JSON.stringify(RECUSOU)}]` });
{
  const r = await trocar(corpoChave);
  const pn = (r.cancelaNova?.payload ?? {}) as Record<string, unknown>;
  confere("Chave Pix, banco recusa: não trocou", r.json.success === false && r.json.code === "PIX_NAO_CANCELADO_NO_BANCO", r.json);
  confere("Chave Pix, banco recusa: a nova é cancelada com o motivo e o PIX continua", /não confirmou o cancelamento do PIX 24692-A/.test(String(pn.motivo_cancela)) && !r.cancelaAntiga && r.soltouMarca, { pn, antiga: r.cancelaAntiga });
  confere("Chave Pix, banco recusa: Histórico registra", r.historico.some((m) => /não concluída/.test(m) && m.includes("(Chave Pix) foi cancelada")), r.historico);
  confere("AJUSTE, banco recusa: a nova não é conferida", !conferenciaGravada(r), r.chamadas.filter((c) => c.op === "update").map((c) => c.payload));
}

// A função recusa (e2eId já usado): nada ao banco, marca solta.
prepararChave({ funcao: { data: null, error: { message: "CHAVE_DUPLICADA: este e2eId já foi registrado na cobrança 24500-B" } } });
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar(corpoChave);
  confere("e2eId repetido: 409 CHAVE_DUPLICADA dizendo a cobrança", r.status === 409 && r.json.code === "CHAVE_DUPLICADA" && /24500-B/.test(String(r.json.message)) && /PIX continua ativo/.test(String(r.json.message)), r.json);
  confere("e2eId repetido: PIX fora do banco, antiga intacta, marca solta", r.aoBanco.length === 0 && !r.cancelaAntiga && r.soltouMarca);
}
prepararChave({ funcao: { data: null, error: { message: "PERM: sem permissão conferencia.confirm" } } });
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar(corpoChave);
  confere("banco nega a permissão: 403 CHAVE_PERMISSAO, nada ao banco", r.status === 403 && r.json.code === "CHAVE_PERMISSAO" && r.aoBanco.length === 0 && r.soltouMarca, r.json);
}

// Sem e2eId e sem comprovante (opcionais desde 17/11/2026): a troca segue e a função recebe nulo nos dois.
prepararChave();
fetchFalso({ corpo: CONFIRMOU });
{
  const r = await trocar({ ...corpoChave, e2e_id: "", comprovante: "  " });
  const funcao = rpcs(r, "fin_troca_criar_chave_pix");
  confere("sem e2eId e sem comprovante: troca concluída", r.status === 200 && r.json.success === true, r.json);
  confere("sem e2eId e sem comprovante: a função recebe nulo nos dois", funcao[0]?.p_e2e_id === null && funcao[0]?.p_comprovante === null, funcao[0]);
  const pc = (r.cancelaAntiga?.payload ?? {}) as Record<string, unknown>;
  confere("sem e2eId e sem comprovante: a antiga cita só a data do recebimento", /Trocada por Chave Pix \(recebido na chave em \d{2}\/\d{2}\/\d{4}\)/.test(String(pc.motivo_troca)), pc.motivo_troca);
}

// Campos inválidos: recusa antes de qualquer leitura ou escrita.
for (const [nome, extra] of [
  ["e2eId curto", { e2e_id: "E123" }],
  ["data futura", { data_pagamento: "2999-01-01" }],
  ["sem data", { data_pagamento: "" }]
] as [string, Record<string, unknown>][]) {
  prepararChave();
  fetchFalso({ corpo: CONFIRMOU });
  const r = await trocar({ ...corpoChave, ...extra });
  confere(`${nome}: 400 CHAVE_CAMPOS sem gravar nem ir ao banco`, r.status === 400 && r.json.code === "CHAVE_CAMPOS" && r.escritas.length === 0 && r.aoBanco.length === 0, r.json);
}

// Chave Pix em pedido de retrabalho: não vale (PIX em retrabalho é recusado pelo gatilho).
prepararChave();
contextoRetrabalho("RETRABALHO", false);
{
  const j = await consultar();
  confere("retrabalho: Chave Pix não aparece", !tipos(j).includes("CHAVE-PIX"), j.destinos);
}

// ── J. Boleto à vista do C6 como origem (23/11/2026, caso 25255) ─────────────
console.log("== J. boleto à vista do C6 como origem (dublê do C6, sem banco)");
const { WEBHOOK_CANCELA_AVISTA_C6, WEBHOOK_CANCELA_AVISTA_BIRO_C6 } = await import("../../src/features/cobrancas/lib/banco-boleto-biro.ts");
const COD_C6 = "01M7SVGBW6KM8A0QAR3SR69RS7";
const BOLETO = { tipo_cobranca: "BOLETO", id_empresa: 1, empresa: "IDEAL GRÁFICA EXPRESSA EIRELI", cod_solicitacao_inter: COD_C6, valor: "762.45" };
const TITULO = { id_boleto_c6: COD_C6, id_pagamento: ANTIGA.id_pagamento, status: "A_RECEBER", paid_at: null, parcela: 1, total_parcelas: 1, deposito_conta: false };
const C6_CONFIRMOU = { success: true, cancelado: true, cod_C6: COD_C6 };
const C6_RECUSOU = { success: false, message: "O C6 recusou o cancelamento: boleto vencido em processamento." };

function prepararBoleto(opcoes: { antiga?: Record<string, unknown>; titulos?: Record<string, unknown>[] } = {}) {
  prepararChave();
  const antiga = { ...ANTIGA, ...BOLETO, ...(opcoes.antiga ?? {}) };
  // A antiga de origem é o boleto; a releitura da nova e a lista do pedido seguem as da Chave Pix.
  const eq = (chamada: { filtros: unknown[][] }, campo: string) =>
    (chamada.filtros.find((f) => f[0] === "eq" && (f[1] as unknown[])[0] === campo)?.[1] as unknown[] | undefined)?.[1];
  const interceptadorAnterior = (_p: unknown, chamada: { filtros: unknown[][] }) => {
    if (chamada.filtros.some((f) => f[0] === "ilike")) return { data: [], error: null };
    if (eq(chamada, "id") === NOVA.id) return { data: { ...antiga, id: NOVA.id, id_pagamento: NOVA.id_pagamento, tipo_cobranca: "PIX", status: "PAID", paid_at: new Date().toISOString(), forma_pgto: "CHAVE PIX", motivo_troca: null, cod_solicitacao_inter: null }, error: null };
    if (eq(chamada, "id_int") !== undefined && eq(chamada, "id") === undefined) {
      return { data: [{ id: ANTIGA.id, id_int: 24692, valor: 762.45, status: "CANCELADO", confirmado: false, tipo_cobranca: "BOLETO" }, { id: NOVA.id, id_int: 24692, valor: 762.45, status: "PAID", confirmado: false, tipo_cobranca: "PIX" }], error: null };
    }
    return undefined;
  };
  falso.interceptar("pagamentos_v2:select", interceptadorAnterior as never);
  falso.responder("pagamentos_v2:select", { data: Object.assign([antiga], antiga), error: null });
  falso.responder("propostas:select", {
    data: { id_int: 24692, status_interno: "AGUARDANDO", is_prd_aprovado: false, is_avulso: false, empresa: "Ideal Grafica", vendedor: "Y", motivo_copia: null, valor_total: 762.45 },
    error: null
  });
  falso.responder("boletos:select", { data: opcoes.titulos ?? [TITULO], error: null });
}
const aoC6 = () => rede.filter((c) => c.url === WEBHOOK_CANCELA_AVISTA_C6 || c.url === WEBHOOK_CANCELA_AVISTA_BIRO_C6);
const tituloCancelado = (r: { chamadas: { tabela: string; op: string; payload?: unknown; filtros: unknown[][] }[] }) =>
  r.chamadas.find((c) => c.tabela === "boletos" && c.op === "update");

// Regras puras.
confere("regra: boleto A_RECEBER da Ideal com código do C6 aceita a troca", regras.cobrancaAceitaTroca({ tipo_cobranca: "BOLETO", id_empresa: 1, status: "A_RECEBER", cod_solicitacao_inter: COD_C6 }));
confere("regra: boleto da E3 com código do C6 aceita", regras.cobrancaAceitaTroca({ tipo_cobranca: "BOLETO", id_empresa: 3, status: "A_RECEBER", cod_solicitacao_inter: COD_C6 }));
confere("regra: boleto da Birô no C6 aceita (cancelamento confere o banco, c38c00a7)", regras.cobrancaAceitaTroca({ tipo_cobranca: "BOLETO", id_empresa: 2, status: "A_RECEBER", cod_solicitacao_inter: COD_C6 }));
confere("regra: boleto da Birô no Inter (UUID) NÃO aceita", !regras.cobrancaAceitaTroca({ tipo_cobranca: "BOLETO", id_empresa: 2, status: "A_RECEBER", cod_solicitacao_inter: "0b9f6c2e-1d3a-4c5b-9e8f-7a6b5c4d3e2f" }));
confere("regra: boleto sem código NÃO aceita", !regras.cobrancaAceitaTroca({ tipo_cobranca: "BOLETO", id_empresa: 1, status: "A_RECEBER" }));
confere("regra: boleto pago NÃO aceita", !regras.cobrancaAceitaTroca({ tipo_cobranca: "BOLETO", id_empresa: 1, status: "PAID", paid_at: "2026-11-20", cod_solicitacao_inter: COD_C6 }));
confere("regra: E-Faturado NÃO aceita", !regras.cobrancaAceitaTroca({ tipo_cobranca: "E-FATURADO", id_empresa: 1, status: "A_VENCER" }));
confere("regra: título único passa", regras.recusaDoTituloDoBoleto([TITULO], { cod_solicitacao_inter: COD_C6, id_pagamento: ANTIGA.id_pagamento }) === null);
confere("regra: dois títulos ativos recusa", regras.recusaDoTituloDoBoleto([TITULO, { ...TITULO, parcela: 2 }], { cod_solicitacao_inter: COD_C6, id_pagamento: ANTIGA.id_pagamento })?.code === "TITULO_NAO_UNICO");
confere("regra: parcela 1 de 2 recusa", regras.recusaDoTituloDoBoleto([{ ...TITULO, total_parcelas: 2 }], { cod_solicitacao_inter: COD_C6, id_pagamento: ANTIGA.id_pagamento })?.code === "TITULO_NAO_UNICO");
confere("regra: sem título ativo recusa", regras.recusaDoTituloDoBoleto([{ ...TITULO, status: "CANCELADO" }], { cod_solicitacao_inter: COD_C6, id_pagamento: ANTIGA.id_pagamento })?.code === "TITULO_NAO_UNICO");
confere("regra: título com outro código recusa", regras.recusaDoTituloDoBoleto([{ ...TITULO, id_boleto_c6: "OUTRO" }], { cod_solicitacao_inter: COD_C6, id_pagamento: ANTIGA.id_pagamento })?.code === "BOLETO_CODIGO_DIVERGENTE");

// GET: a janela.
prepararBoleto();
{
  const j = await consultar();
  confere("GET boleto da Ideal com NF-e: pode trocar, origem BOLETO, Chave Pix na lista", j.success === true && j.pode === true && j.origem === "BOLETO" && j.notaAutorizada === true && tipos(j).includes("CHAVE-PIX"), j);
  confere("GET não grava nada", falso.chamadas.every((c) => c.op === "select"));
}

// Feliz: boleto -> Chave Pix, o C6 confirma.
prepararBoleto();
fetchFalso({ corpo: C6_CONFIRMOU });
{
  const r = await trocar(corpoChave);
  const funcao = rpcs(r, "fin_troca_criar_chave_pix");
  confere("boleto -> Chave Pix: troca concluída", r.status === 200 && r.json.success === true && r.json.origem === "BOLETO" && /\(Boleto\) cancelada/.test(String(r.json.message)), r.json);
  confere("a nova nasce pela função do banco, com a origem do boleto", funcao.length === 1 && funcao[0]?.p_id_origem === ANTIGA.id, funcao);
  const c6 = aoC6();
  confere("o boleto foi pedido ao C6 uma vez, com o código e a empresa (fluxo da Ideal/E3)", c6.length === 1 && c6[0].url === WEBHOOK_CANCELA_AVISTA_C6 && JSON.parse(c6[0].body).cod_C6 === COD_C6 && JSON.parse(c6[0].body).id_empresa === 1, c6);
  confere("nenhum pedido de cancelamento de PIX", r.aoBanco.length === 0, r.aoBanco);
  const posFuncao = posicao(r, (c) => c.tabela === "rpc:fin_troca_criar_chave_pix");
  confere("ORDEM: nova (função) -> boleto cai", posFuncao >= 0 && r.posCancelaAntiga > posFuncao, { posFuncao, antiga: r.posCancelaAntiga });
  const t = tituloCancelado(r);
  const ft = JSON.stringify(t?.filtros ?? []);
  confere("o título na Carteira cai pelo código do C6 e pelo pedido", ((t?.payload ?? {}) as Record<string, unknown>).status === "CANCELADO" && ft.includes(COD_C6) && ft.includes('"id_int",24692'), t);
  confere("Histórico: boleto cancelado e Chave Pix criada", r.historico.some((m) => m.includes("24692-A (Boleto) cancelada") && m.includes("Chave Pix")), r.historico);
  confere("Chave Pix conferida na sequência", r.json.conferida === true && Boolean(conferenciaGravada(r)), r.json);
  confere("NF-e intocada", !r.chamadas.some((c) => c.tabela === "notas_fiscais" && c.op !== "select"));
}

// Boleto -> Faturado, o C6 confirma.
prepararBoleto();
fetchFalso({ corpo: C6_CONFIRMOU });
{
  const r = await trocar({ tipo: "E-FATURADO" });
  confere("boleto -> Faturado: concluída, nova inserida, boleto e título caem", r.status === 200 && Boolean(r.insertNova) && Boolean(r.cancelaAntiga) && Boolean(tituloCancelado(r)) && aoC6().length === 1, r.json);
}

// O C6 não confirma: a nova é desfeita e o boleto fica ativo.
for (const [nome, resposta] of [
  ["C6 recusou (409)", { status: 409, corpo: C6_RECUSOU }],
  ["200 sem cancelado: true", { corpo: { success: true } }],
  ["erro HTTP 500", { status: 500, corpo: { success: false } }],
  ["rede", "REDE"]
] as const) {
  prepararBoleto();
  fetchFalso(resposta as Parameters<typeof fetchFalso>[0]);
  const r = await trocar(corpoChave);
  const pn = (r.cancelaNova?.payload ?? {}) as Record<string, unknown>;
  confere(`${nome}: não trocou (BOLETO_NAO_CANCELADO_NO_BANCO)`, r.json.success === false && r.json.code === "BOLETO_NAO_CANCELADO_NO_BANCO" && /não foi trocada/.test(String(r.json.message)), r.json);
  confere(`${nome}: a nova é cancelada com o motivo do boleto`, /não confirmou o cancelamento do boleto 24692-A/.test(String(pn.motivo_cancela)) && /O boleto continua ativo/.test(String(pn.motivo_cancela)), pn);
  confere(`${nome}: o boleto e o título ficam como estavam; marca solta`, !r.cancelaAntiga && !tituloCancelado(r) && r.soltouMarca, { antiga: r.cancelaAntiga, titulo: tituloCancelado(r) });
  confere(`${nome}: a nova não é conferida`, !conferenciaGravada(r));
  confere(`${nome}: Histórico registra a troca não concluída`, r.historico.some((m) => /não concluída/.test(m) && m.includes("boleto 24692-A")), r.historico);
}
{
  prepararBoleto();
  fetchFalso({ status: 409, corpo: C6_RECUSOU });
  const r = await trocar(corpoChave);
  confere("C6 recusou: a mensagem do banco chega à tela", /O C6 recusou o cancelamento: boleto vencido/.test(String(r.json.message)), r.json);
}

// Birô no C6: o fluxo próprio, com o segredo.
prepararBoleto({ antiga: { id_empresa: 2, empresa: "IDEAL BIRO" } });
fetchFalso({ corpo: C6_CONFIRMOU });
{
  const r = await trocar(corpoChave);
  const c6 = aoC6();
  confere("Birô no C6: vai ao fluxo da Birô no C6", r.json.success === true && c6.length === 1 && c6[0].url === WEBHOOK_CANCELA_AVISTA_BIRO_C6, { json: r.json, c6 });
}

// Recusas antes de gravar: boleto do Inter, faturado, título não único, já pago.
async function recusaBoletoSemEscrita(nome: string, opcoes: Parameters<typeof prepararBoleto>[0], codigo: string) {
  prepararBoleto(opcoes);
  fetchFalso({ corpo: C6_CONFIRMOU });
  const j = await consultar();
  confere(`${nome}: GET diz que não pode (${codigo})`, j.success === true && j.pode === false && j.code === codigo, j);
  prepararBoleto(opcoes);
  fetchFalso({ corpo: C6_CONFIRMOU });
  const r = await trocar(corpoChave);
  confere(`${nome}: POST recusa (${codigo}) sem gravar nem ir ao banco`, r.json.success === false && r.json.code === codigo && r.escritas.length === 0 && rede.length === 0, { json: r.json, escritas: r.escritas.map((c) => `${c.op} ${c.tabela}`) });
}
await recusaBoletoSemEscrita("boleto da Birô no Inter", { antiga: { id_empresa: 2, cod_solicitacao_inter: "0b9f6c2e-1d3a-4c5b-9e8f-7a6b5c4d3e2f" } }, "BOLETO_FORA_DO_C6");
// Faturado com título é barrado antes, pela elegibilidade (TITULO_EM_ABERTO); sem título, pela origem.
await recusaBoletoSemEscrita("E-Faturado como origem", { antiga: { tipo_cobranca: "E-FATURADO", status: "A_VENCER", cod_solicitacao_inter: null }, titulos: [] }, "TIPO_NAO_ACEITO");
await recusaBoletoSemEscrita("boleto parcelado (2 títulos)", { titulos: [TITULO, { ...TITULO, parcela: 2, total_parcelas: 2 }] }, "TITULO_NAO_UNICO");
await recusaBoletoSemEscrita("boleto sem código do banco", { antiga: { cod_solicitacao_inter: null } }, "BOLETO_SEM_CODIGO");

// A função do banco ainda sem a migration 20261123: recusa limpa, nada ao C6.
prepararBoleto();
falso.responder("rpc:fin_troca_criar_chave_pix", { data: null, error: { message: "CHAVE_ORIGEM: a cobrança 24692-A não é PIX" } });
fetchFalso({ corpo: C6_CONFIRMOU });
{
  const r = await trocar(corpoChave);
  confere("sem a migration: 409 CHAVE_ORIGEM, o boleto continua ativo, nada ao C6, marca solta", r.status === 409 && r.json.code === "CHAVE_ORIGEM" && /O boleto continua ativo/.test(String(r.json.message)) && aoC6().length === 0 && !r.cancelaAntiga && r.soltouMarca, r.json);
}

// Cancelar sem trocar: o boleto com nota continua barrado (cancelar-externo intocado).
prepararBoleto();
fetchFalso({ corpo: C6_CONFIRMOU });
{
  const req = new Request("http://localhost/api/cobrancas/cancelar-externo", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ id: ANTIGA.id, id_int: ANTIGA.id_int, tipo_cobranca: "BOLETO", acao_local: "CANCEL", motivo: "teste" })
  });
  const resposta = await cancelarExterno.POST(req);
  const json = (await resposta.json()) as Record<string, unknown>;
  confere("cancelar o boleto sem trocar: recusa NOTA_AUTORIZADA, nada ao C6 nem gravado", resposta.status === 409 && json.code === "NOTA_AUTORIZADA" && rede.length === 0 && falso.chamadas.every((c) => c.op === "select"), json);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
