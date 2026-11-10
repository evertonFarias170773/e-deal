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
 *      E-Retrabalho; E-Crédito e as formas de banco recusadas.
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
  confere("pedido comum: a janela oferece Faturado, E-Permuta e E-Amostra", j.pode === true && tipos(j) === "E-FATURADO,E-PERMUTA,E-AMOSTRA", j.destinos);
  confere("pedido comum: E-Crédito, E-Retrabalho e formas de banco não aparecem", !/E-CREDITO|E-RETRABALHO|BOLETO|PIX|CARD/.test(tipos(j)), j.destinos);
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
await recusaDeDestino("E-Crédito (fora nesta etapa)", [null, false], { tipo: "E-CREDITO", id_modelo_cobranca: "" }, "DESTINO_NAO_ACEITO");
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

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
