/**
 * Registro de boleto faturado no INTER (Ideal Birô) sem duplicar (04/11/2026, 24402-A).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/registrar-boleto-inter.test.mts
 *
 * DUBLÊS: cliente Supabase falso e `fetch` falso no lugar do webhook do n8n.
 * Nenhuma chamada sai daqui — nem ao n8n, nem ao Inter.
 *
 *   A. Caminho normal inalterado: boleto pronto -> success, o título relido, uma
 *      chamada ao webhook e nenhuma escrita da rota.
 *   B. Criação aceita + 429 na consulta: o código que chega é gravado no título
 *      (só se ainda vazio) e a rota responde EM PROCESSAMENTO, não erro comum.
 *   C. Nova tentativa não duplica: título com código e sem boleto NÃO chama a
 *      criação; com a consulta configurada, só a consulta.
 *   D. Os limites: sem código em lugar nenhum, a rota não inventa estado e avisa
 *      que o banco pode ter criado o boleto.
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
const { POST } = await import("../../src/app/api/cobrancas/registrar-boleto-faturado/route.ts");
const { estadoDoRegistroBancario, codigoDaCobrancaNaResposta } = await import("../../src/features/cobrancas/lib/registro-bancario.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const CODIGO = "1a34cb6b-83b3-4c80-bbd3-1337fcad7367";
const URL_CRIACAO = "https://10074.hostoo.net.br/webhook/biro-faturado-inter";
const URL_CONSULTA = "https://n8n.exemplo/webhook/consulta-de-teste";

const TITULO = {
  id: "b0000000-0000-0000-0000-000000024402",
  id_int: 24402,
  id_cliente: 63115,
  id_empresa: 2,
  id_pagamento: "24402-A",
  id_boleto_c6: null as string | null,
  n_nf: "7728",
  nome_cliente: "CLIENTE DE TESTE LTDA",
  documento: "11012944000103",
  valor: 3270,
  vencimento: "2026-12-02",
  parcela: 1,
  total_parcelas: 1,
  multa: 0,
  juros_dia: 0,
  descricao: "Vencimento fiscal 1/1 - Ref: NFE-24402-001",
  ext_reference: "NFE-24402-001",
  status: "A_VENCER",
  nosso_numero: null as string | null,
  linha_digitavel: null as string | null
};
const PRONTO = { ...TITULO, id_boleto_c6: CODIGO, nosso_numero: "90904812743", linha_digitavel: "07790001161208217529509048127436816430000670000", url_pdf: "https://pdf" };
const SO_CODIGO = { ...TITULO, id_boleto_c6: CODIGO };

type Linha = Record<string, unknown>;
/** `lidas`: o título na 1ª leitura e nas releituras seguintes (a última se repete). */
function prepararBanco(lidas: Linha[], opcoes: { gravacaoAfeta?: boolean } = {}) {
  falso.zerar();
  falso.responder("usuarios:select", { data: { id_perfil: 2, is_super_adm: false, is_admin: false }, error: null });
  falso.responder("perfis:select", { data: { permissoes: ["contas_receber.admin"] }, error: null });
  falso.responderEmSequencia("boletos:select", lidas.map((data) => ({ data, error: null })));
  falso.responder("pagamentos_v2:select", { data: null, error: null });
  falso.responder("clientes:select", { data: { email: "", email_financeiro: "financeiro@cliente.com.br", email_contato: "", whatsapp_1: "" }, error: null });
  falso.responder("enderecos:select", { data: [{ endereco: "Rua A", numero: "1", complemento: "", cidade: "Vitória", uf: "ES", cep: "29046-020", tipo_endereco: "Principal" }], error: null });
  falso.responder("boletos:update", { data: opcoes.gravacaoAfeta === false ? [] : [{ id: TITULO.id }], error: null });
}

let chamadas: string[] = [];
function fetchFalso(responder: (url: string) => Response | Promise<Response>) {
  chamadas = [];
  globalThis.fetch = (async (url: string) => {
    chamadas.push(String(url));
    return responder(String(url));
  }) as typeof fetch;
}
const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

async function chamarRota() {
  const requisicao = new Request("http://localhost/api/cobrancas/registrar-boleto-faturado", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-de-teste" },
    body: JSON.stringify({ boletoId: TITULO.id })
  });
  const resposta = await POST(requisicao);
  return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}
const gravacoes = () => falso.chamadas.filter((c) => c.tabela === "boletos" && c.op === "update");
const criacoes = () => chamadas.filter((u) => u === URL_CRIACAO).length;

// ── 0. A regra pura ───────────────────────────────────────────────────────
console.log("== 0. estado do registro e código na resposta");
confere("sem nada: NAO_REGISTRADO", estadoDoRegistroBancario(TITULO) === "NAO_REGISTRADO");
confere("só o código: EM_PROCESSAMENTO", estadoDoRegistroBancario(SO_CODIGO) === "EM_PROCESSAMENTO");
confere("com linha digitável: REGISTRADO", estadoDoRegistroBancario(PRONTO) === "REGISTRADO");
confere("código no topo da resposta", codigoDaCobrancaNaResposta({ codigoSolicitacao: CODIGO }) === CODIGO);
confere("código dentro de data", codigoDaCobrancaNaResposta({ success: false, data: { cod_solicitacao_inter: CODIGO } }) === CODIGO);
confere("resposta sem código: null", codigoDaCobrancaNaResposta({ message: "Error in workflow" }) === null);
confere("texto estranho não vira código", codigoDaCobrancaNaResposta({ codigoSolicitacao: "a b" }) === null);

// ── A. caminho normal ─────────────────────────────────────────────────────
console.log("== A. caminho normal inalterado");
{
  delete process.env.N8N_WEBHOOK_BIRO_CONSULTA_INTER;
  prepararBanco([TITULO, PRONTO]);
  fetchFalso(() => json(200, { success: true, url: "https://pdf" }));
  const r = await chamarRota();
  confere("200 e success:true", r.status === 200 && r.corpo.success === true, r);
  confere("idempotente:false (registro novo)", r.corpo.idempotente === false, r.corpo);
  confere("devolve o título relido, com a linha digitável", (r.corpo.data as Linha)?.linha_digitavel === PRONTO.linha_digitavel, r.corpo.data);
  confere("uma chamada à criação", criacoes() === 1 && chamadas.length === 1, chamadas);
  confere("a rota não grava nada (o fluxo grava)", gravacoes().length === 0, gravacoes());
}
{
  prepararBanco([PRONTO]);
  fetchFalso(() => json(200, { success: true }));
  const r = await chamarRota();
  confere("título já registrado: 200 idempotente e nenhuma chamada", r.status === 200 && r.corpo.idempotente === true && chamadas.length === 0, { r, chamadas });
}

// ── B. criação aceita + 429 na consulta ───────────────────────────────────
console.log("== B. criação aceita + 429 na consulta");
{
  // O fluxo caiu depois do POST aceito e devolveu o código na resposta de erro.
  prepararBanco([TITULO, TITULO, SO_CODIGO]);
  fetchFalso(() => json(500, { success: false, message: "429 no token de leitura", codigoSolicitacao: CODIGO }));
  const r = await chamarRota();
  const g = gravacoes();
  confere("responde EM PROCESSAMENTO (202), não erro comum", r.status === 202 && r.corpo.code === "INTER_EM_PROCESSAMENTO" && r.corpo.emProcessamento === true, r);
  confere("grava SÓ o código no título", g.length === 1 && JSON.stringify(g[0].payload) === JSON.stringify({ id_boleto_c6: CODIGO }), g);
  confere("grava só se o título ainda estiver sem código (nulo ou vazio)", g.length === 1 && g[0].filtros.some(([f, a]) => f === "or" && JSON.stringify(a) === JSON.stringify(["id_boleto_c6.is.null,id_boleto_c6.eq."])), g[0]?.filtros);
  confere("devolve o código", (r.corpo.data as Linha)?.id_boleto_c6 === CODIGO, r.corpo);
  confere("uma criação só", criacoes() === 1, chamadas);
}
{
  // O fluxo gravou o código sozinho (Vincula parcial) e respondeu 502 sem código.
  prepararBanco([TITULO, SO_CODIGO]);
  fetchFalso(() => json(502, { success: false, code: "INTER_EM_PROCESSAMENTO", message: "boleto ainda não emitido" }));
  const r = await chamarRota();
  confere("código gravado pelo fluxo: EM PROCESSAMENTO e nenhuma escrita a mais", r.status === 202 && r.corpo.code === "INTER_EM_PROCESSAMENTO" && gravacoes().length === 0, { r, g: gravacoes() });
}
{
  // Tempo esgotado na chamada; o fluxo já tinha gravado o código.
  prepararBanco([TITULO, SO_CODIGO]);
  fetchFalso(() => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  const r = await chamarRota();
  confere("timeout com código gravado: EM PROCESSAMENTO", r.status === 202 && r.corpo.code === "INTER_EM_PROCESSAMENTO", r);
}
{
  // Corrida: outra tentativa gravou primeiro; a gravação desta não afeta linha.
  prepararBanco([TITULO, TITULO, { ...TITULO, id_boleto_c6: "outro-codigo-0000" }], { gravacaoAfeta: false });
  fetchFalso(() => json(500, { codigoSolicitacao: CODIGO }));
  const r = await chamarRota();
  confere("corrida: vale o código que já estava no título", r.status === 202 && (r.corpo.data as Linha)?.id_boleto_c6 === "outro-codigo-0000", r);
}

{
  // Código em texto vazio conta como "sem código": cria, e grava sobre o vazio.
  const VAZIO = { ...TITULO, id_boleto_c6: "" };
  confere("texto vazio ou só espaços: NAO_REGISTRADO", estadoDoRegistroBancario(VAZIO) === "NAO_REGISTRADO" && estadoDoRegistroBancario({ id_boleto_c6: "   " }) === "NAO_REGISTRADO");
  prepararBanco([VAZIO, VAZIO, SO_CODIGO]);
  fetchFalso(() => json(500, { codigoSolicitacao: CODIGO }));
  const r = await chamarRota();
  const g = gravacoes();
  confere("título com código vazio: uma criação e o código gravado", criacoes() === 1 && g.length === 1 && JSON.stringify(g[0].payload) === JSON.stringify({ id_boleto_c6: CODIGO }), { chamadas, g });
  confere("título com código vazio: EM PROCESSAMENTO com o código", r.status === 202 && (r.corpo.data as Linha)?.id_boleto_c6 === CODIGO, r);
}

// ── C. nova tentativa não duplica ─────────────────────────────────────────
console.log("== C. nova tentativa não duplica");
{
  delete process.env.N8N_WEBHOOK_BIRO_CONSULTA_INTER;
  prepararBanco([SO_CODIGO]);
  fetchFalso(() => json(200, { success: true }));
  const r = await chamarRota();
  confere("título com código: NÃO chama a criação", criacoes() === 0 && chamadas.length === 0, chamadas);
  confere("responde EM PROCESSAMENTO com o código", r.status === 202 && (r.corpo.data as Linha)?.id_boleto_c6 === CODIGO, r);
  confere("nada gravado", gravacoes().length === 0);
}
{
  process.env.N8N_WEBHOOK_BIRO_CONSULTA_INTER = URL_CONSULTA;
  prepararBanco([SO_CODIGO, PRONTO]);
  fetchFalso(() => json(200, { success: true }));
  const r = await chamarRota();
  confere("com consulta configurada: só a consulta, nunca a criação", chamadas.length === 1 && chamadas[0] === URL_CONSULTA, chamadas);
  confere("boleto saiu na consulta: 200 idempotente com a linha", r.status === 200 && r.corpo.idempotente === true && (r.corpo.data as Linha)?.linha_digitavel === PRONTO.linha_digitavel, r);
}
{
  process.env.N8N_WEBHOOK_BIRO_CONSULTA_INTER = URL_CONSULTA;
  prepararBanco([SO_CODIGO, SO_CODIGO]);
  fetchFalso(() => json(500, { message: "Error in workflow" }));
  const r = await chamarRota();
  confere("consulta falhou: segue EM PROCESSAMENTO, sem criar", r.status === 202 && criacoes() === 0, { r, chamadas });
  delete process.env.N8N_WEBHOOK_BIRO_CONSULTA_INTER;
}
{
  // Sequência real do 24402-A, agora: 1ª tentativa grava o código; a 2ª não cria.
  prepararBanco([TITULO, TITULO, SO_CODIGO]);
  fetchFalso(() => json(500, { codigoSolicitacao: CODIGO }));
  await chamarRota();
  const depoisDaPrimeira = criacoes();
  prepararBanco([SO_CODIGO]);
  fetchFalso(() => json(200, { success: true }));
  await chamarRota();
  confere("duas tentativas seguidas: uma criação no total", depoisDaPrimeira === 1 && criacoes() === 0, { depoisDaPrimeira, segunda: chamadas });
}

// ── D. limites ────────────────────────────────────────────────────────────
console.log("== D. sem código em lugar nenhum");
{
  prepararBanco([TITULO, TITULO]);
  fetchFalso(() => json(500, { message: "Error in workflow" }));
  const r = await chamarRota();
  confere("502 REGISTRO_NAO_CONFIRMADO, sem gravar", r.status === 502 && r.corpo.code === "REGISTRO_NAO_CONFIRMADO" && gravacoes().length === 0, r);
  confere("avisa que o banco pode ter criado o boleto", /pode ter criado/.test(String(r.corpo.message)), r.corpo.message);
}
{
  prepararBanco([TITULO, TITULO]);
  fetchFalso(() => json(200, { success: true }));
  const r = await chamarRota();
  confere("sucesso sem título gravado: a mensagem de antes", r.status === 502 && /retorno não foi gravado/.test(String(r.corpo.message)), r);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
