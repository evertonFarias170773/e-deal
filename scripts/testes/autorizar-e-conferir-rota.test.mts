/**
 * A rota POST /api/cobrancas/confirmar com a ação "autorizar_e_conferir".
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/autorizar-e-conferir-rota.test.mts
 *
 * SEM banco: cliente Supabase falso (_supabase-falso.mts), que só anota o que foi
 * pedido. Cada verificação é POR COBRANÇA (o que foi gravado nela, com qual
 * autoria), nunca contagem absoluta.
 *
 *   1. Caminho feliz: UM UPDATE só, com a soma dos dois passos e a autoria nos
 *      dois campos; condicionado ao status lido e a "ainda não confirmada".
 *   2. ERRO FORÇADO na gravação: a resposta traz a etapa, o código e a dica.
 *      A mesma falha em "Confirmar Conferência" continua só com a mensagem.
 *   3. Idempotência: já confirmada responde sucesso sem gravar; linha que mudou
 *      no meio responde 409 sem gravar mais nada.
 *   4. Servidor decide: sem cobrancas.aprovar é 403 e nada é gravado; o mesmo
 *      perfil ainda pode "Confirmar Conferência" (não muda).
 *   5. Não se aplica a cobrança já autorizada, nem sem autor, nem com a
 *      quitação da proposta bloqueada: nada é gravado.
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

const { falso } = await import("./_supabase-falso.mts");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
const { POST } = await import("../../src/app/api/cobrancas/confirmar/route.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

const PEDIDO = 23681;
const COBRANCA = {
  id: "c0000000-0000-0000-0000-000000000681",
  id_int: PEDIDO,
  id_cliente: 14,
  id_pagamento: "23681-A",
  tipo_cobranca: "E-FATURADO",
  valor: 19131,
  status: "A_VENCER",
  confirmado: false,
  aprovado_por: null as string | null,
  confirmado_por: null as string | null,
  motivo_cancela: null as string | null,
  paid_at: null as string | null,
  reserva_estado: null,
  obs_v2: null
};

type Perfil = "ADMIN" | "SO_CONFERIR";
function prepararBanco(cobranca: Record<string, unknown>, opcoes: { perfil?: Perfil; lista?: Record<string, unknown>[]; valorTotal?: number } = {}) {
  falso.zerar();
  if (opcoes.perfil === "SO_CONFERIR") {
    // Perfil com "Confirmar Pagamento" e SEM "Liberar OS / Confirmar".
    falso.responder("usuarios:select", { data: { id_perfil: 7, is_super_adm: false, is_admin: false }, error: null });
    falso.responder("perfis:select", { data: { permissoes: ["conferencia.confirm"] }, error: null });
  } else {
    falso.responder("usuarios:select", { data: { id_perfil: 1, is_super_adm: true, is_admin: true }, error: null });
  }
  const lista = opcoes.lista ?? [cobranca];
  falso.responder("pagamentos_v2:select", { data: Object.assign([...lista], cobranca), error: null });
  falso.responder("pagamentos_v2:update", { data: [{ id: cobranca.id }], error: null });
  falso.responder("propostas:select", { data: { valor_total: opcoes.valorTotal ?? Number(cobranca.valor), status_interno: "ENTREGUE", is_avulso: true }, error: null });
}

async function chamar(acao: string | undefined, cobranca: Record<string, unknown>, opcoes: Parameters<typeof prepararBanco>[1] = {}, confirmadoPor: string | null = "Marielle Fonseca") {
  prepararBanco(cobranca, opcoes);
  const requisicao = new Request("http://localhost/api/cobrancas/confirmar", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ idCobranca: cobranca.id, ...(confirmadoPor === null ? {} : { confirmadoPor }), ...(acao ? { acao } : {}) })
  });
  const resposta = await POST(requisicao as never);
  const corpo = (await resposta.json()) as Record<string, any>;
  const gravacoes = falso.chamadas.filter((c) => c.op !== "select");
  const updates = gravacoes.filter((c) => c.tabela === "pagamentos_v2" && c.op === "update");
  return { status: resposta.status, corpo, gravacoes, updates };
}

const COMBINADA = "autorizar_e_conferir";

// ----------------------------------------------------------- 1. CAMINHO FELIZ
console.log("== 1. caminho feliz ==");
{
  const r = await chamar(COMBINADA, { ...COBRANCA });
  confere("200 e success", r.status === 200 && r.corpo.success === true && r.corpo.jaConfirmada !== true, r);
  confere(`cobranca ${COBRANCA.id_pagamento}: UM UPDATE em pagamentos_v2`, r.updates.length === 1, r.updates.length);
  const p = (r.updates[0]?.payload ?? {}) as Record<string, unknown>;
  confere("status final A_VENCER (E-FATURADO nao vira PAID)", p.status === "A_VENCER", p);
  confere("confirmado = true", p.confirmado === true, p);
  confere("autoria nos DOIS campos", p.aprovado_por === "Marielle Fonseca" && p.confirmado_por === "Marielle Fonseca", p);
  confere("data_confirmacao e um instante valido", !Number.isNaN(Date.parse(String(p.data_confirmacao))), p.data_confirmacao);
  confere("nao escreve nada alem destes campos", Object.keys(p).sort().join(",") === "aprovado_por,confirmado,confirmado_por,data_confirmacao,status", Object.keys(p));
  const filtros = (r.updates[0]?.filtros ?? []) as [string, unknown[]][];
  const eqs = filtros.filter((f) => f[0] === "eq").map((f) => `${f[1][0]}=${JSON.stringify(f[1][1])}`);
  confere("so grava se a linha ainda e a lida: eq id, eq status (o lido) e eq confirmado=false",
    eqs.includes(`id=${JSON.stringify(COBRANCA.id)}`) && eqs.includes(`status=${JSON.stringify("A_VENCER")}`) && eqs.includes("confirmado=false"), eqs);
  confere("e SEM or/and: o PostgREST repete esses filtros no SELECT externo e quebra com 42703",
    filtros.every((f) => f[0] !== "or" && f[0] !== "and"), filtros.map((f) => f[0]));
  confere("nenhuma outra tabela e gravada", r.gravacoes.every((g) => g.tabela === "pagamentos_v2"), r.gravacoes.map((g) => g.tabela));
}
{
  const r = await chamar(COMBINADA, { ...COBRANCA, tipo_cobranca: "E-PERMUTA", status: "A_RECEBER" });
  const p = (r.updates[0]?.payload ?? {}) as Record<string, unknown>;
  confere("E-PERMUTA (quita na liberacao): PAID com paid_at, um UPDATE so", r.status === 200 && r.updates.length === 1 && p.status === "PAID" && typeof p.paid_at === "string", p);
}

// ----------------------------------------------------- 2. ERRO FORÇADO NA GRAVAÇÃO
console.log("== 2. erro forcado na gravacao ==");
const ERRO_DO_BANCO = {
  message: "column pagamentos_v2.confirmado does not exist",
  code: "42703",
  details: null,
  hint: "Perhaps you meant to reference the column \"pagamentos_v2.confirmado_por\"."
};
{
  prepararBanco({ ...COBRANCA });
  falso.responder("pagamentos_v2:update", { data: null, error: ERRO_DO_BANCO });
  const requisicao = new Request("http://localhost/api/cobrancas/confirmar", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ idCobranca: COBRANCA.id, confirmadoPor: "Marielle Fonseca", acao: COMBINADA })
  });
  const resposta = await POST(requisicao as never);
  const corpo = (await resposta.json()) as Record<string, any>;
  confere("status 500", resposta.status === 500, resposta.status);
  confere("etapa = gravacao da autorizacao e da conferencia", corpo.etapa === "GRAVACAO_AUTORIZACAO_E_CONFERENCIA", corpo);
  confere("traz a descricao da etapa", String(corpo.etapa_descricao).includes("UPDATE"), corpo.etapa_descricao);
  confere("traz o codigo e a mensagem do banco", corpo.code === "42703" && corpo.error === "column pagamentos_v2.confirmado does not exist", corpo);
  confere("traz a dica", String(corpo.hint).includes("confirmado_por"), corpo.hint);
  confere("diz que a gravacao NAO valeu", corpo.gravada === false, corpo);
}
{
  // A mesma falha no "Confirmar Conferência" (sem acao): resposta de sempre.
  prepararBanco({ ...COBRANCA });
  falso.responder("pagamentos_v2:update", { data: null, error: ERRO_DO_BANCO });
  const requisicao = new Request("http://localhost/api/cobrancas/confirmar", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ idCobranca: COBRANCA.id, confirmadoPor: "Marielle Fonseca" })
  });
  const resposta = await POST(requisicao as never);
  const corpo = (await resposta.json()) as Record<string, unknown>;
  confere("Confirmar Conferencia com a mesma falha: 500 so com { success, error }",
    resposta.status === 500 && Object.keys(corpo).sort().join(",") === "error,success" && corpo.error === ERRO_DO_BANCO.message, corpo);
}
{
  // Erro do banco na leitura da cobranca (nao "linha ausente") tambem sai diagnosticado.
  prepararBanco({ ...COBRANCA });
  falso.responder("pagamentos_v2:select", { data: null, error: { message: "permission denied for table pagamentos_v2", code: "42501" } as never });
  const requisicao = new Request("http://localhost/api/cobrancas/confirmar", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ idCobranca: COBRANCA.id, confirmadoPor: "Marielle Fonseca", acao: COMBINADA })
  });
  const resposta = await POST(requisicao as never);
  const corpo = (await resposta.json()) as Record<string, any>;
  confere("falha na LEITURA: etapa LEITURA_DA_COBRANCA, com o codigo", resposta.status === 500 && corpo.etapa === "LEITURA_DA_COBRANCA" && corpo.code === "42501", corpo);
}

// ------------------------------------------------------------ 3. IDEMPOTÊNCIA
console.log("== 3. idempotencia ==");
{
  const r = await chamar(COMBINADA, { ...COBRANCA, confirmado: true, aprovado_por: "Marielle Fonseca", confirmado_por: "Marielle Fonseca" });
  confere("ja confirmada: sucesso, jaConfirmada, e NADA gravado", r.status === 200 && r.corpo.success === true && r.corpo.jaConfirmada === true && r.gravacoes.length === 0, r);
}
{
  // O UPDATE condicional nao achou a linha (alguem mexeu no meio) e ela segue sem confirmar.
  prepararBanco({ ...COBRANCA });
  falso.responder("pagamentos_v2:update", { data: [], error: null });
  const requisicao = new Request("http://localhost/api/cobrancas/confirmar", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ idCobranca: COBRANCA.id, confirmadoPor: "Marielle Fonseca", acao: COMBINADA })
  });
  const resposta = await POST(requisicao as never);
  const corpo = (await resposta.json()) as Record<string, any>;
  const gravou = falso.chamadas.filter((c) => c.op !== "select");
  confere("linha mudou no meio: 409 COBRANCA_MUDOU", resposta.status === 409 && corpo.code === "COBRANCA_MUDOU", corpo);
  confere("e nenhum abatimento, status ou prateleira e gravado depois", gravou.every((g) => g.tabela === "pagamentos_v2" && g.op === "update") && gravou.length === 1, gravou.map((g) => `${g.tabela}:${g.op}`));
}

// ------------------------------------------------- 3b. O MESMO CLIQUE DUAS VEZES
console.log("== 3b. o mesmo clique duas vezes: grava uma vez so ==");
async function chamarJa(cobrancaId: string) {
  const requisicao = new Request("http://localhost/api/cobrancas/confirmar", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ idCobranca: cobrancaId, confirmadoPor: "Marielle Fonseca", acao: COMBINADA })
  });
  const resposta = await POST(requisicao as never);
  return { status: resposta.status, corpo: (await resposta.json()) as Record<string, any> };
}
const confirmadaDepois = { ...COBRANCA, status: "A_VENCER", confirmado: true, aprovado_por: "Marielle Fonseca", confirmado_por: "Marielle Fonseca" };
{
  // Dois cliques em sequencia: o primeiro grava; no segundo o banco ja mostra a cobranca confirmada.
  prepararBanco({ ...COBRANCA });
  const primeiro = await chamarJa(COBRANCA.id);
  const gravouNoPrimeiro = falso.chamadas.filter((c) => c.tabela === "pagamentos_v2" && c.op === "update").length;
  prepararBanco(confirmadaDepois);
  const segundo = await chamarJa(COBRANCA.id);
  const gravouNoSegundo = falso.chamadas.filter((c) => c.op !== "select").length;
  confere("1o clique: sucesso e UM UPDATE", primeiro.status === 200 && primeiro.corpo.jaConfirmada !== true && gravouNoPrimeiro === 1, { primeiro, gravouNoPrimeiro });
  confere("2o clique: sucesso, tratado como ja confirmado", segundo.status === 200 && segundo.corpo.jaConfirmada === true, segundo);
  confere("2o clique: NENHUMA gravacao (nem UPDATE, nem abatimento, nem status, nem chat)", gravouNoSegundo === 0, gravouNoSegundo);
  confere("somados, os dois cliques gravam UMA vez so", gravouNoPrimeiro + gravouNoSegundo === 1, gravouNoPrimeiro + gravouNoSegundo);
}
{
  // Corrida: o 2o clique leu a linha ANTES de o 1o gravar; o UPDATE condicional nao pega a linha
  // (confirmado ja e true) e a releitura mostra a cobranca confirmada.
  prepararBanco({ ...COBRANCA });
  const lista = Object.assign([{ ...COBRANCA }], { ...COBRANCA });
  falso.responderEmSequencia("pagamentos_v2:select", [
    { data: lista, error: null },                                  // leitura inicial (velha)
    { data: lista, error: null },                                  // trava de quitacao
    { data: { status: "A_VENCER", confirmado: true }, error: null } // releitura depois do UPDATE vazio
  ]);
  falso.responder("pagamentos_v2:update", { data: [], error: null });
  const r = await chamarJa(COBRANCA.id);
  const gravacoes = falso.chamadas.filter((c) => c.op !== "select");
  confere("corrida: responde ja confirmada", r.status === 200 && r.corpo.success === true && r.corpo.jaConfirmada === true, r);
  confere("corrida: a unica gravacao e a tentativa condicional que nao pegou a linha (sem efeitos depois)",
    gravacoes.length === 1 && gravacoes[0].tabela === "pagamentos_v2" && gravacoes[0].op === "update", gravacoes.map((g) => `${g.tabela}:${g.op}`));
}

// ------------------------------------------------------- 4. SERVIDOR DECIDE
console.log("== 4. o servidor decide a permissao ==");
{
  const r = await chamar(COMBINADA, { ...COBRANCA }, { perfil: "SO_CONFERIR" });
  confere("sem 'Liberar OS / Confirmar': 403 e nada gravado", r.status === 403 && r.corpo.success === false && r.gravacoes.length === 0, r);
}
{
  const r = await chamar(undefined, { ...COBRANCA, status: "A_VENCER", aprovado_por: "Alguem" }, { perfil: "SO_CONFERIR" });
  confere("o mesmo perfil ainda 'Confirmar Conferencia' (nao mudou)", r.status === 200 && r.updates.length === 1 && (r.updates[0].payload as any)?.confirmado === true, r);
}

// --------------------------------------------------- 5. QUANDO NÃO SE APLICA
console.log("== 5. quando nao se aplica ==");
{
  const r = await chamar(COMBINADA, { ...COBRANCA, aprovado_por: "Marielle Fonseca", confirmado_por: "Marielle Fonseca" });
  confere("ja autorizada (na fila): 409 NAO_PENDENTE, nada gravado, autoria preservada", r.status === 409 && r.corpo.code === "NAO_PENDENTE_DE_AUTORIZACAO" && r.gravacoes.length === 0, r);
}
{
  const r = await chamar(COMBINADA, { ...COBRANCA, tipo_cobranca: "PIX", status: "PAID" });
  confere("cobranca de PIX: 409, nada gravado", r.status === 409 && r.gravacoes.length === 0, r);
}
{
  const r = await chamar(COMBINADA, { ...COBRANCA }, {}, null);
  confere("sem nome de quem autoriza: 400, nada gravado", r.status === 400 && r.gravacoes.length === 0, r);
}
{
  // Duas cobrancas ativas e a soma nao cobre o total: a mesma trava da Conferencia.
  const outra = { ...COBRANCA, id: "c0000000-0000-0000-0000-000000000682", status: "A_RECEBER", valor: 100 };
  const r = await chamar(COMBINADA, { ...COBRANCA, valor: 100 }, { lista: [{ ...COBRANCA, valor: 100 }, outra], valorTotal: 500 });
  confere("quitacao bloqueada: 422 isConferenciaBloqueada, nada gravado", r.status === 422 && r.corpo.isConferenciaBloqueada === true && r.gravacoes.length === 0, r);
}
{
  const r = await chamar(COMBINADA, { ...COBRANCA, status: "CANCELADO", motivo_cancela: "duplicado" });
  confere("cancelada: 409 da trava de sempre, nada gravado", r.status === 409 && r.gravacoes.length === 0, r);
}

// -------------------------------- 6. AS DUAS ACOES DE SEMPRE SEGUEM IGUAIS
console.log("== 6. Confirmar Autorizacao e Confirmar Conferencia: iguais a antes ==");
{
  const r = await chamar("autorizar_faturamento", { ...COBRANCA, status: "A_RECEBER" });
  const p = (r.updates[0]?.payload ?? {}) as Record<string, unknown>;
  const filtros = (r.updates[0]?.filtros ?? []) as [string, unknown[]][];
  confere("Confirmar Autorizacao: 200 e UM UPDATE", r.status === 200 && r.corpo.success === true && r.updates.length === 1, r);
  confere("Confirmar Autorizacao: grava so status A_VENCER e aprovado_por (nao confirma)",
    JSON.stringify(Object.keys(p).sort()) === JSON.stringify(["aprovado_por", "status"]) && p.status === "A_VENCER" && p.aprovado_por === "Marielle Fonseca", p);
  confere("Confirmar Autorizacao: filtra so por id, sem filtro novo", JSON.stringify(filtros.map((f) => [f[0], f[1][0]])) === JSON.stringify([["eq", "id"]]), filtros);
}
{
  const r = await chamar(undefined, { ...COBRANCA, aprovado_por: "Marielle Fonseca", confirmado_por: "Marielle Fonseca" });
  const p = (r.updates[0]?.payload ?? {}) as Record<string, unknown>;
  const filtros = (r.updates[0]?.filtros ?? []) as [string, unknown[]][];
  confere("Confirmar Conferencia: 200 e UM UPDATE", r.status === 200 && r.corpo.success === true && r.updates.length === 1, r);
  confere("Confirmar Conferencia: grava so confirmado, confirmado_por e data_confirmacao (E-FATURADO fica A_VENCER)",
    JSON.stringify(Object.keys(p).sort()) === JSON.stringify(["confirmado", "confirmado_por", "data_confirmacao"]) && p.confirmado === true, p);
  confere("Confirmar Conferencia: filtra so por id, sem filtro novo", JSON.stringify(filtros.map((f) => [f[0], f[1][0]])) === JSON.stringify([["eq", "id"]]), filtros);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
