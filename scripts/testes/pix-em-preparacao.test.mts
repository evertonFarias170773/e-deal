/**
 * PIX da Birô EM PREPARAÇÃO (04/11/2026, proposta A aprovada pelo dono).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/pix-em-preparacao.test.mts
 *
 * DUBLÊS: cliente Supabase falso e `fetch` falso no lugar do n8n. Nada sai daqui.
 *   A. Código do Inter sem copia e cola: sucesso em preparação, grava só o código.
 *   B. Com copia e cola: igual a antes (grava código e copia e cola).
 *   C. Código não gravado: falha com cobrancaEmitida (nunca "tente de novo").
 *   D. Rota gerar-pix: 202 PIX_EM_PREPARACAO na criação e na segunda chamada, sem
 *      chamar o n8n de novo; C6 com código sem QR segue 409 como antes.
 *   E. Regra do selo e as telas que a usam.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const url = (arquivo: string) => pathToFileURL(path.join(AQUI, arquivo)).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: url("_supabase-js-falso-com-tipos.mts"), shortCircuit: true };
    if (especificador === "next/server") return { url: url("_next-server-falso.mts"), shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { falso } = await import("./_supabase-falso.mts");
const { gerarPixBancoInter } = await import("../../src/features/cobrancas/services/banco-inter.service.ts");
const { POST } = await import("../../src/app/api/cobrancas/gerar-pix/route.ts");
const { pixEmPreparacao, CODIGO_PIX_EM_PREPARACAO } = await import("../../src/features/cobrancas/lib/pix-em-preparacao.ts");
const { getSupabaseClient } = await import("./_supabase-falso.mts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const CODIGO = "dc06f24c-9bcc-41d9-907f-43b6829e194e";
const PARAMS = {
  cobrancaId: "pg-24767", idEmpresa: 2, seuNumero: "24767-A", valorNominal: 81, dataVencimento: "2026-11-07",
  telefone: "", cpfCnpj: "12345678000190", nome: "CLIENTE", endereco: "Rua A", cidade: "Porto Alegre", uf: "RS", cep: "90000000"
};
let chamadasN8n: string[] = [];
function n8nResponde(corpo: unknown) {
  chamadasN8n = [];
  globalThis.fetch = (async (u: string) => {
    chamadasN8n.push(String(u));
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
const gravacoes = () => falso.chamadas.filter((c) => c.tabela === "pagamentos_v2" && c.op === "update");

// ── A/B/C. Serviço ───────────────────────────────────────────────────────
console.log("== A. código sem copia e cola (Inter em processamento)");
{
  falso.zerar();
  falso.responder("pagamentos_v2:update", { data: null, error: null });
  n8nResponde({ cobranca: { codigoSolicitacao: CODIGO, situacao: "EM_PROCESSAMENTO" } });
  const r = await gerarPixBancoInter(getSupabaseClient() as never, PARAMS);
  const g = gravacoes();
  confere("sucesso em preparação", r.success === true && r.emPreparacao === true, r);
  confere("grava só o código", g.length === 1 && JSON.stringify(g[0].payload) === JSON.stringify({ cod_solicitacao_inter: CODIGO }), g);
  confere("devolve o código e o copia e cola vazio", JSON.stringify(r.data) === JSON.stringify({ id: "pg-24767", cod_solicitacao_inter: CODIGO, pix_copia_cola: null }), r.data);
}
console.log("== B. com copia e cola (caminho normal)");
{
  falso.zerar();
  falso.responder("pagamentos_v2:update", { data: { id: "pg-24767", pix_copia_cola: "000201PIX" }, error: null });
  n8nResponde({ cobranca: { codigoSolicitacao: CODIGO, situacao: "A_RECEBER" }, pix: { pixCopiaECola: "000201PIX" } });
  const r = await gerarPixBancoInter(getSupabaseClient() as never, PARAMS);
  const g = gravacoes();
  confere("sucesso, sem 'em preparação'", r.success === true && !r.emPreparacao, r);
  confere("grava código e copia e cola, como antes", g.length === 1 && JSON.stringify(g[0].payload) === JSON.stringify({ cod_solicitacao_inter: CODIGO, pix_copia_cola: "000201PIX" }), g);
}
console.log("== C. código não gravado");
{
  falso.zerar();
  falso.responder("pagamentos_v2:update", { data: null, error: { message: "falhou" } });
  n8nResponde({ cobranca: { codigoSolicitacao: CODIGO, situacao: "EM_PROCESSAMENTO" } });
  const r = await gerarPixBancoInter(getSupabaseClient() as never, PARAMS);
  confere("falha com cobrancaEmitida (não oferece nova tentativa)", r.success === false && r.cobrancaEmitida === true && !r.emPreparacao, r);
}

// ── D. Rota ──────────────────────────────────────────────────────────────
async function chamarRota() {
  const req = new Request("http://localhost/api/cobrancas/gerar-pix", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify({ cobrancaId: "pg-24767", seuNumero: "24767-A", valorNominal: 81, dataVencimento: "2026-11-07", endereco: "Rua A", cidade: "POA", uf: "RS", cep: "90000000" })
  });
  const res = await POST(req);
  return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
}
const linhaPix = (o: Record<string, unknown>) => ({ id: "pg-24767", id_empresa: 2, tipo_cobranca: "PIX", valor: 81, status: "A_RECEBER", pix_copia_cola: null, linha_digitavel: null, cod_solicitacao_inter: null, cliente: "CLIENTE LTDA", documento: "12345678000190", ...o });
console.log("== D. rota gerar-pix");
{
  falso.zerar();
  falso.responder("pagamentos_v2:select", { data: linhaPix({}), error: null });
  falso.responder("pagamentos_v2:update", { data: null, error: null });
  n8nResponde({ cobranca: { codigoSolicitacao: CODIGO, situacao: "EM_PROCESSAMENTO" } });
  const r = await chamarRota();
  confere("criação em processamento: 202 PIX_EM_PREPARACAO", r.status === 202 && r.corpo.success === true && r.corpo.code === CODIGO_PIX_EM_PREPARACAO, r);
  confere("uma chamada ao n8n", chamadasN8n.length === 1 && /vibe-biro$/.test(chamadasN8n[0]), chamadasN8n);
}
{
  falso.zerar();
  falso.responder("pagamentos_v2:select", { data: linhaPix({ cod_solicitacao_inter: CODIGO }), error: null });
  n8nResponde({});
  const r = await chamarRota();
  confere("segunda chamada: 202 em preparação", r.status === 202 && r.corpo.code === CODIGO_PIX_EM_PREPARACAO && (r.corpo.data as Record<string, unknown>)?.cod_solicitacao_inter === CODIGO, r);
  confere("segunda chamada: NÃO chama o n8n (nunca outra cobrança)", chamadasN8n.length === 0, chamadasN8n);
}
{
  falso.zerar();
  falso.responder("pagamentos_v2:select", { data: linhaPix({ cod_solicitacao_inter: "txid-c6", id_empresa: 1 }), error: null });
  n8nResponde({});
  const r = await chamarRota();
  confere("C6 com código sem QR: 409 como antes", r.status === 409 && r.corpo.code === "PIX_EMITIDO_SEM_QR" && chamadasN8n.length === 0, r);
}
{
  falso.zerar();
  falso.responder("pagamentos_v2:select", { data: linhaPix({ cod_solicitacao_inter: CODIGO, pix_copia_cola: "000201PIX" }), error: null });
  n8nResponde({});
  const r = await chamarRota();
  confere("com copia e cola: idempotente como antes", r.status === 200 && r.corpo.idempotente === true && chamadasN8n.length === 0, r);
}

// ── E. Regra e telas ─────────────────────────────────────────────────────
console.log("== E. regra do selo e telas");
const base = { tipo_cobranca: "PIX", id_empresa: 2, cod_solicitacao_inter: CODIGO, pix_copia_cola: null, status: "A_RECEBER" };
confere("Birô, código, sem copia e cola: em preparação", pixEmPreparacao(base));
confere("com copia e cola: não", !pixEmPreparacao({ ...base, pix_copia_cola: "000201" }));
confere("sem código: não (segue 'Gerar PIX')", !pixEmPreparacao({ ...base, cod_solicitacao_inter: null }));
confere("C6: não", !pixEmPreparacao({ ...base, id_empresa: 1 }));
confere("pago ou cancelado: não", !pixEmPreparacao({ ...base, status: "PAID" }) && !pixEmPreparacao({ ...base, status: "CANCELADO" }));
const painel = readFileSync("src/features/cobrancas/PropostaCobrancaPanel.tsx", "utf8");
const area = readFileSync("src/app/p/[token]/area-cliente-view.tsx", "utf8");
const areaServ = readFileSync("src/features/area-cliente/services/area-cliente.server.ts", "utf8");
const publica = readFileSync("supabase/functions/pagamento-publico/index.ts", "utf8");
confere("painel: selo nas duas listas e recarga de 15 s", (painel.match(/\{SELO_PIX_EM_PREPARACAO\}/g) ?? []).length === 2 && /setInterval\(\(\) => void refreshCobrancas\(\), 15_000\)/.test(painel));
confere("área do cliente: devolve a cobrança em preparação e mostra a mensagem", /if \(idEmpresa === 2\) return \{ ok: true, cobranca: paraPublica\(linha\), reaproveitada \}/.test(areaServ) && /MENSAGEM_PIX_EM_PREPARACAO/.test(area));
confere("pagamento-publico: mensagem sem QR, nunca QR com 'null'", /Seu PIX está sendo preparado pelo banco\. Esta página atualiza sozinha\./.test(publica) && /: !pagamento\.pix_copia_cola\s*\?/.test(publica));
confere("pagamento-publico: recarrega quando o copia e cola aparecer", /tem_pix: Boolean\(pagamento\.pix_copia_cola\)/.test(publica) && /PIX_EM_PREPARACAO && data\.tem_pix/.test(publica));

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
