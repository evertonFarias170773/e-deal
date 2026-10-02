/**
 * Registro de boleto do C6 pelo SERVIDOR (02/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/registrar-boleto-c6.test.mts
 *
 * Até essa data o navegador montava o corpo e chamava o webhook `boletos-vibe`.
 * A rota `POST /api/cobrancas/registrar-boleto-faturado` passou a fazer isso. O
 * que este teste trava, SEM banco e SEM n8n (cliente falso e `fetch` falso):
 *   A. o corpo enviado ao webhook é o de sempre, campo a campo e na mesma ordem;
 *   B. a rota confere a permissão antes de qualquer coisa;
 *   C. o cabeçalho do segredo vai quando a variável existe, e só então;
 *   D. o retorno do banco é gravado no título; recusa do banco não grava nada;
 *   E. pendência de cadastro para antes do banco.
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
const { montarPayloadBoletoC6 } = await import("../../src/features/cobrancas/services/boleto-c6.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const TITULO = {
  id: "b0000000-0000-0000-0000-000000000001",
  id_int: 22999,
  id_cliente: 4321,
  id_empresa: 1,
  id_pagamento: "PG-1",
  id_boleto_c6: null,
  n_nf: 7600,
  nome_cliente: "CLIENTE DE TESTE LTDA",
  documento: "12.345.678/0001-90",
  valor: 1234.56,
  vencimento: "2026-10-20",
  parcela: 2,
  total_parcelas: 3,
  multa: 2,
  juros_dia: 0.033,
  descricao: "Parcela 2/3",
  ext_reference: "P2322999",
  status: "A_VENCER"
};

/** O corpo que o NAVEGADOR enviava, escrito à mão na ordem de sempre. */
const CORPO_DE_SEMPRE = JSON.stringify({
  boleto_id: "b0000000-0000-0000-0000-000000000001",
  ext_reference: "P2322999",
  id_empresa: 1,
  id_cliente: 4321,
  id_int: 22999,
  n_nf: "7600",
  parcela: 2,
  total_parcelas: 3,
  valor: 1234.56,
  vencimento: "2026-10-20",
  nome_cliente: "CLIENTE DE TESTE LTDA",
  documento: "12345678000190",
  email: "financeiro@cliente.com.br",
  endereco: {
    logradouro: "Rua das Flores",
    numero: "100",
    complemento: "Sala 2",
    bairro: "Centro",
    cidade: "Porto Alegre",
    uf: "RS",
    cep: "90000000"
  },
  multa_percentual: 2,
  juros_dia_percentual: 0.033,
  instrucoes: ["Parcela 2/3 - NF 7600 - Ref P2322999"]
});

function prepararBanco(opcoes: { permissoes?: string[]; titulo?: Record<string, unknown>; endereco?: Record<string, unknown> | null } = {}) {
  falso.zerar();
  falso.responder("usuarios:select", { data: { id_perfil: 2, is_super_adm: false, is_admin: false }, error: null });
  falso.responder("perfis:select", { data: { permissoes: opcoes.permissoes ?? ["contas_receber.admin"] }, error: null });
  falso.responder("boletos:select", { data: opcoes.titulo ?? TITULO, error: null });
  falso.responder("clientes:select", { data: { email: "", email_financeiro: "financeiro@cliente.com.br", email_contato: "" }, error: null });
  falso.responder("enderecos:select", {
    data: opcoes.endereco === undefined
      ? { endereco: "Rua das Flores", numero: "100", complemento: "Sala 2", bairro: "Centro", cidade: "Porto Alegre", uf: "RS", cep: "90000-000" }
      : opcoes.endereco,
    error: null
  });
  falso.responder("boletos:update", { data: null, error: null });
}

type Chamada = { url: string; headers: Record<string, string>; body: string };
let chamadasAoWebhook: Chamada[] = [];
function fetchFalso(resposta: { status?: number; json?: unknown; texto?: string }) {
  chamadasAoWebhook = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    chamadasAoWebhook.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") });
    const corpo = resposta.texto ?? JSON.stringify(resposta.json ?? {});
    return new Response(corpo, { status: resposta.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

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

const RETORNO_C6 = { id: "C6-ABC123", our_number: "0001234567", digitable_line: "34191.79001 01043.510047 91020.150008 1 99990000123456", bar_code: "34191999900001234561790001043510049102015000", status: "A_VENCER" };

// ── A. corpo de sempre ──────────────────────────────────────────────────────
console.log("== A. corpo enviado ao webhook");
{
  const pagador = {
    email: "financeiro@cliente.com.br",
    address: { logradouro: "Rua das Flores", numero: "100", complemento: "Sala 2", bairro: "Centro", cidade: "Porto Alegre", uf: "RS", cep: "90000000" },
    documentoDigits: "12345678000190"
  };
  confere("montarPayloadBoletoC6 == corpo de sempre (texto idêntico)", JSON.stringify(montarPayloadBoletoC6(TITULO, pagador)) === CORPO_DE_SEMPRE);
  const semNf = { ...TITULO, n_nf: null, parcela: null, total_parcelas: null, multa: null, juros_dia: null, ext_reference: null };
  const corpo = montarPayloadBoletoC6(semNf, pagador);
  confere("sem NF, parcela e referência: os padrões de sempre",
    corpo.n_nf === "" && corpo.parcela === 1 && corpo.total_parcelas === 1 && corpo.multa_percentual === 0 &&
    corpo.juros_dia_percentual === 0 && corpo.ext_reference === "" && corpo.instrucoes[0] === "Parcela 1/1 - NF S/N - Ref ", corpo);
}

// ── B. permissão ────────────────────────────────────────────────────────────
console.log("== B. permissão");
{
  prepararBanco({ permissoes: ["cobrancas.emitir_boleto"] });
  fetchFalso({ json: RETORNO_C6 });
  const r = await chamarRota();
  confere("sem contas_receber.admin: 403", r.status === 403 && r.corpo.code === "SEM_PERMISSAO", r);
  confere("sem permissão: o webhook NÃO é chamado", chamadasAoWebhook.length === 0);
  confere("sem permissão: nada é gravado", gravacoes().length === 0);
}

// ── C e D. registro com sucesso ─────────────────────────────────────────────
console.log("== C/D. registro com sucesso");
{
  process.env.N8N_WEBHOOK_SECRET = "segredo-de-teste";
  prepararBanco();
  fetchFalso({ json: RETORNO_C6 });
  const r = await chamarRota();
  confere("com a chave: 200 success", r.status === 200 && r.corpo.success === true, r);
  confere("não devolve mais delegarLegado", r.corpo.delegarLegado === undefined);
  confere("devolve os dados do banco para a tela", (r.corpo.data as Record<string, unknown>)?.id === "C6-ABC123");
  confere("uma chamada, ao webhook boletos-vibe", chamadasAoWebhook.length === 1 && chamadasAoWebhook[0].url === "https://10074.hostoo.net.br/webhook/boletos-vibe", chamadasAoWebhook.map((c) => c.url));
  confere("corpo da rota == corpo de sempre (texto idêntico)", chamadasAoWebhook[0]?.body === CORPO_DE_SEMPRE, chamadasAoWebhook[0]?.body);
  confere("cabeçalho do segredo enviado", chamadasAoWebhook[0]?.headers["x-vibe-webhook-secret"] === "segredo-de-teste");
  const g = gravacoes();
  const gravado = (g[0]?.payload ?? {}) as Record<string, unknown>;
  confere("grava o retorno do banco no título, uma vez", g.length === 1 &&
    gravado.id_boleto_c6 === "C6-ABC123" && gravado.nosso_numero === "0001234567" &&
    gravado.linha_digitavel === RETORNO_C6.digitable_line && gravado.codigo_barras === RETORNO_C6.bar_code && gravado.status === "A_VENCER", gravado);
  confere("grava no título certo", JSON.stringify(g[0]?.filtros) === JSON.stringify([["eq", ["id", TITULO.id]]]), g[0]?.filtros);
}
{
  delete process.env.N8N_WEBHOOK_SECRET;
  prepararBanco();
  fetchFalso({ json: RETORNO_C6 });
  const r = await chamarRota();
  confere("sem a variável: registra do mesmo jeito", r.status === 200 && chamadasAoWebhook.length === 1);
  confere("sem a variável: o cabeçalho do segredo não vai", !("x-vibe-webhook-secret" in (chamadasAoWebhook[0]?.headers ?? {})));
}

// ── D. recusas do banco ─────────────────────────────────────────────────────
console.log("== D. recusas");
{
  prepararBanco();
  fetchFalso({ json: { error: { message: '400 - "{\\"title\\":\\"Bad Request\\",\\"detail\\":\\"CEP invalido\\"}"' } } });
  const r = await chamarRota();
  confere("banco recusa: 422 com o motivo legível", r.status === 422 && r.corpo.message === "CEP invalido", r);
  confere("banco recusa: nada é gravado", gravacoes().length === 0);
}
{
  prepararBanco();
  fetchFalso({ status: 403, texto: "Authorization data is wrong!" });
  const r = await chamarRota();
  confere("webhook recusa o segredo (403): a rota repassa o erro", r.status === 422 && r.corpo.message === "Authorization data is wrong!", r);
  confere("webhook recusa o segredo: nada é gravado", gravacoes().length === 0);
}

// ── E. cadastro pendente ────────────────────────────────────────────────────
console.log("== E. cadastro pendente");
{
  prepararBanco({ endereco: null });
  fetchFalso({ json: RETORNO_C6 });
  const r = await chamarRota();
  confere("sem endereço: 400 com a pendência em palavras", r.status === 400 && r.corpo.message === "Logradouro do cliente está pendente.", r);
  confere("sem endereço: o webhook NÃO é chamado", chamadasAoWebhook.length === 0);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
