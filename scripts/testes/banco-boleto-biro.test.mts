/**
 * Birô Inter -> C6, etapa 2: boleto à vista e faturado (19/11/2026), montado DESLIGADO.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/banco-boleto-biro.test.mts
 *
 * DUBLÊS: cliente Supabase falso e `fetch` falso. Nada sai daqui (nem n8n, nem banco).
 *   A. Chave BOLETO_BIRO: ausente/lixo = Inter; 1/true/sim/on/ligado/c6 = C6.
 *   B. Banco pelo formato do código: UUID = Inter; 26 sem hífen = C6.
 *   C. À vista (rota gerar-boleto): desligada = Birô no Inter, como hoje; ligada =
 *      fluxo novo com o segredo. Ideal e E3 nunca mudam.
 *   D. Faturado: desligada = Inter; ligada = C6 pelo fluxo novo; título com código do
 *      Inter segue no Inter mesmo ligada. Resposta de exemplo do C6 lida certo.
 *   E. Cancelar, consultar, refazer e recusa: o banco sai do CÓDIGO, nas duas posições da chave.
 *   F. Combinada: boleto da Birô só com a chave.
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
const b = await import("../../src/features/cobrancas/lib/banco-boleto-biro.ts");
const { POST: gerarBoleto } = await import("../../src/app/api/cobrancas/gerar-boleto/route.ts");
const { resolverWebhookCancelamentoBoleto } = await import("../../src/app/api/cobrancas/cancelar-externo/route.ts");
const { cancelarTituloNoC6, corpoDoCancelamentoC6 } = await import("../../src/features/cobrancas/services/cancelamento-c6.ts");
const { consultarDetalhesBoletoC6 } = await import("../../src/features/cobrancas/services/pagamentos-v2.service.ts");
const { provedorDaEmpresa } = await import("../../src/features/cobrancas/recusa-bancaria.ts");
const { motivoDeNaoRefazer } = await import("../../src/features/contas-a-receber/services/refazer-boleto.ts");
const { lerRespostaDoRegistroC6, camposDoTituloRegistradoC6 } = await import("../../src/features/cobrancas/services/boleto-c6.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.N8N_WEBHOOK_SECRET = "segredo-de-teste";

const UUID_INTER = "dc06f24c-9bcc-41d9-907f-43b6829e194e";
const COD_C6 = "01JD3ZK8Q5Y7W2N4M6P8R0T2V4"; // 26, sem hífen (formato dos boletos do C6)
const N8N = "https://10074.hostoo.net.br/webhook";

type Chamada = { url: string; cabecalhos: Record<string, string>; corpo: unknown };
let chamadas: Chamada[] = [];
function n8nResponde(corpo: unknown, status = 200) {
  chamadas = [];
  globalThis.fetch = (async (u: string, init?: RequestInit) => {
    chamadas.push({ url: String(u), cabecalhos: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), corpo: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

console.log("== A. chave BOLETO_BIRO");
for (const v of [undefined, "", "0", "INTER", "nao"]) confere(`desligada com ${JSON.stringify(v)}`, b.boletoBiroNoC6(v) === false);
for (const v of ["1", "true", "sim", " on ", "ligado", "C6", "c6"]) confere(`ligada com ${JSON.stringify(v)}`, b.boletoBiroNoC6(v) === true);
delete process.env.BOLETO_BIRO;
confere("sem a variável = desligada", b.boletoBiroNoC6() === false);

console.log("== B. banco pelo formato do código");
confere("UUID = Inter", b.bancoDoCodigoBoleto(UUID_INTER) === "INTER");
confere("26 sem hífen = C6", b.bancoDoCodigoBoleto(COD_C6) === "C6");
confere("vazio = desconhecido", b.bancoDoCodigoBoleto("") === null && b.bancoDoCodigoBoleto(null) === null);
confere("Ideal e E3 = C6 sempre", b.bancoDoBoletoEmitido(1, UUID_INTER) === "C6" && b.bancoDoBoletoEmitido(3, null) === "C6");
confere("Birô sem código = Inter (como antes)", b.bancoDoBoletoEmitido(2, null) === "INTER");
confere("Birô com código do C6 = C6", b.bancoDoBoletoEmitido(2, COD_C6) === "C6");

console.log("== C. à vista pela rota gerar-boleto");
async function avista(empresa: string) {
  falso.zerar();
  falso.responder("pagamentos_v2:select", { data: { id: "pg-1", id_pagamento: "999-A", id_cliente: 14, cliente: "CLIENTE", documento: "123.456.789-01" }, error: null });
  falso.responder("pagamentos_v2:update", { data: [{ id: "pg-1" }], error: null });
  n8nResponde({ id: COD_C6, digitable_line: "23790.00000 00000.000000 00000.000000 1 00000000000500" });
  const req = new Request("http://localhost/api/cobrancas/gerar-boleto", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify({ cobrancaId: "pg-1", id_pagamento: "999-A", empresa, valor_total: 5, external_reference_id: "999" }) });
  const res = await gerarBoleto(req);
  return { status: res.status, corpo: (await res.json()) as Record<string, unknown>, chamada: chamadas.find((c) => c.url.startsWith(N8N)) };
}
delete process.env.BOLETO_BIRO;
{
  const r = await avista("2");
  confere("desligada: Birô vai ao boleto-inter-biro, sem segredo, documento só dígitos (como hoje)", r.chamada?.url === `${N8N}/boleto-inter-biro` && !("x-vibe-webhook-secret" in (r.chamada?.cabecalhos ?? {})) && (r.chamada?.corpo as Record<string, unknown>)?.documento === "12345678901", r.chamada);
  const r1 = await avista("1");
  confere("desligada: Ideal no boleto-avista-vibe, sem segredo (como hoje)", r1.chamada?.url === `${N8N}/boleto-avista-vibe` && !("x-vibe-webhook-secret" in (r1.chamada?.cabecalhos ?? {})), r1.chamada);
}
process.env.BOLETO_BIRO = "C6";
{
  const r = await avista("2");
  confere("ligada: Birô vai ao boleto-avista-biro-c6, com o segredo", r.chamada?.url === b.WEBHOOK_BOLETO_AVISTA_BIRO_C6 && r.chamada?.cabecalhos["x-vibe-webhook-secret"] === "segredo-de-teste", r.chamada);
  confere("ligada: documento como gravado (formato do C6, como na Ideal)", (r.chamada?.corpo as Record<string, unknown>)?.documento === "123.456.789-01", r.chamada?.corpo);
  confere("ligada: resposta de exemplo do C6 lida (linha digitável gravada)", r.status === 200 && JSON.stringify(falso.chamadas.filter((c) => c.op === "update").map((c) => c.payload)).includes("23790.00000"), r);
  const r3 = await avista("3");
  confere("ligada: E3 continua no boleto-avista-vibe, sem segredo", r3.chamada?.url === `${N8N}/boleto-avista-vibe` && !("x-vibe-webhook-secret" in (r3.chamada?.cabecalhos ?? {})), r3.chamada);
}

console.log("== D. faturado: para onde vai o registro");
confere("desligada: Birô sem código = Inter", b.registroFaturadoNoC6(2, null, false) === false);
confere("ligada: Birô sem código = C6", b.registroFaturadoNoC6(2, null, true) === true);
confere("ligada: Birô com código do Inter = segue no Inter (nunca nos dois bancos)", b.registroFaturadoNoC6(2, UUID_INTER, true) === false);
confere("Ideal e E3: sempre C6", b.registroFaturadoNoC6(1, null, false) && b.registroFaturadoNoC6(3, null, true));
confere("webhook do faturado no C6: Birô = boletos-biro-c6; Ideal = boletos-vibe", b.webhookFaturadoC6(2) === b.WEBHOOK_FATURADO_BIRO_C6 && b.webhookFaturadoC6(1) === `${N8N}/boletos-vibe`);
{
  const exemplo = { id: COD_C6, our_number: "123456", digitable_line: "23790.00000 00000.000000 00000.000000 1 00000000000500", bar_code: "23791000000000005000000000000000000000000000", status: "A_VENCER" };
  const lido = await lerRespostaDoRegistroC6(new Response(JSON.stringify(exemplo), { status: 200 }));
  const campos = lido.ok ? camposDoTituloRegistradoC6(lido.data) : {};
  confere("resposta de exemplo do C6 (faturado) lida: id, nosso número e linha", lido.ok && campos.id_boleto_c6 === COD_C6 && campos.nosso_numero === "123456" && String(campos.linha_digitavel).startsWith("23790"), campos);
}
const rotaFat = readFileSync("src/app/api/cobrancas/registrar-boleto-faturado/route.ts", "utf8");
confere("rota do faturado: decide por registroFaturadoNoC6 e usa o webhook da empresa", /if \(vaiAoC6\(boleto\)\)/.test(rotaFat) && /fetch\(webhookFaturadoC6\(idEmpresa\)/.test(rotaFat));

console.log("== E. cancelar, consultar, refazer e recusa: pelo código");
for (const chave of ["", "C6"]) {
  process.env.BOLETO_BIRO = chave;
  const rot = chave ? "[ligada]" : "[desligada]";
  confere(`${rot} à vista: Birô UUID -> cancela-boleto-inter-biro`, resolverWebhookCancelamentoBoleto(2, UUID_INTER) === `${N8N}/cancela-boleto-inter-biro`);
  confere(`${rot} à vista: Birô C6 -> del-boleto-av-biro-c6`, resolverWebhookCancelamentoBoleto(2, COD_C6) === b.WEBHOOK_CANCELA_AVISTA_BIRO_C6);
  confere(`${rot} à vista: Ideal -> del-boleto-av-vibe (como hoje)`, resolverWebhookCancelamentoBoleto(1, COD_C6) === `${N8N}/del-boleto-av-vibe`);
  n8nResponde({ success: true, cancelado: true, cod_C6: COD_C6 });
  await cancelarTituloNoC6({ corpo: corpoDoCancelamentoC6({ id: "b1", id_boleto_c6: COD_C6, id_empresa: 2 }), cabecalhos: {} });
  confere(`${rot} faturado no C6: Birô -> del-boleto-biro-c6`, chamadas[0]?.url === b.WEBHOOK_CANCELA_FATURADO_BIRO_C6, chamadas);
  n8nResponde({ success: true, cancelado: true });
  await cancelarTituloNoC6({ corpo: corpoDoCancelamentoC6({ id: "b1", id_boleto_c6: COD_C6, id_empresa: 1 }), cabecalhos: {} });
  confere(`${rot} faturado no C6: Ideal -> del-boleto-vibe (como hoje)`, chamadas[0]?.url === `${N8N}/del-boleto-vibe`, chamadas);
  n8nResponde({ status: "CREATED" });
  await consultarDetalhesBoletoC6(COD_C6, 2);
  confere(`${rot} consulta: Birô C6 -> consulta-boleto-biro-c6`, chamadas[0]?.url === b.WEBHOOK_CONSULTA_BIRO_C6, chamadas);
  n8nResponde({ status: "CREATED" });
  await consultarDetalhesBoletoC6(COD_C6, 1);
  confere(`${rot} consulta: Ideal -> consulta-paid-c6 (como hoje)`, chamadas[0]?.url === `${N8N}/consulta-paid-c6`, chamadas);
  confere(`${rot} recusa: Birô UUID = INTER; Birô C6 = C6; Ideal = C6`, provedorDaEmpresa(2, UUID_INTER) === "INTER" && provedorDaEmpresa(2, COD_C6) === "C6" && provedorDaEmpresa(1) === "C6");
  const base = { status: "A_VENCER", vencimento: "2099-01-01", deposito_conta: false, paid_at: null };
  confere(`${rot} refazer: Birô no Inter continua de fora`, String(motivoDeNaoRefazer({ ...base, id_empresa: 2, id_boleto_c6: UUID_INTER }, "2026-11-19")).includes("Ideal Birô"));
  confere(`${rot} refazer: Birô no C6 passa pela regra da Ideal`, motivoDeNaoRefazer({ ...base, id_empresa: 2, id_boleto_c6: COD_C6 }, "2026-11-19") === null, motivoDeNaoRefazer({ ...base, id_empresa: 2, id_boleto_c6: COD_C6 }, "2026-11-19"));
}
delete process.env.BOLETO_BIRO;

console.log("== F. combinada");
const comb = readFileSync("src/app/api/cobrancas/pagamento-combinado/route.ts", "utf8");
confere("combinada: boleto da Birô só com a chave", /\(isBoletoSecundario && !boletoBiroNoC6\(\)\)/.test(comb));
confere("combinada: webhook do boleto pela empresa, segredo só no da Birô", /const webhookBoleto = webhookBoletoAVista\(idEmpresaReal\);/.test(comb) && /webhookDaBiroC6ComSegredo\(webhookBoleto\) \? cabecalhosWebhookN8n\(\)/.test(comb));
const cr = readFileSync("src/features/contas-a-receber/ContasReceberPage.tsx", "utf8");
confere("Contas a Receber: rótulo do banco pelo código do título", /const cancelNoInter = bancoDoBoletoEmitido\(/.test(cr) && /const cancelBanco = cancelNoInter \? "Banco Inter" : "C6 Bank";/.test(cr));

console.log("== G. cancelamento do à vista da Birô no C6 confere o banco (rota cancelar-externo, dublê do n8n)");
{
  const { POST: cancelarExterno } = await import("../../src/app/api/cobrancas/cancelar-externo/route.ts");
  const cobranca = (extra: Record<string, unknown>) => ({ id: "c0000000-0000-0000-0000-0000000000b1", id_int: 25282, id_cliente: 14, id_pagamento: "25282-X", descricao: "Boleto de teste",
    status: "A_RECEBER", confirmado: false, paid_at: null, data_confirmacao: null, tipo_cobranca: "BOLETO", cod_solicitacao_inter: COD_C6, id_empresa: 2,
    reserva_estado: null, id_pendencia: null, chave_reserva: null, valor: 10, ...extra });
  async function cancelar(c: Record<string, unknown>, resposta: { status: number; corpo: unknown }) {
    falso.zerar();
    falso.responder("usuarios:select", { data: { id_perfil: 1, id_empresa: 1, is_super_adm: true, is_admin: true, nome_usuario: "Teste" }, error: null });
    falso.responder("pagamentos_v2:select", { data: Object.assign([c], c), error: null });
    falso.responder("pagamentos_v2:update", { data: null, error: null });
    falso.responder("boletos:select", { data: [], error: null });
    falso.responder("boletos:update", { data: null, error: null });
    falso.responder("propostas:select", { data: { id_int: 25282, status_interno: "AGUARDANDO", is_prd_aprovado: false, is_avulso: true, valor_total: 100, empresa: "X", vendedor: "Y" }, error: null });
    falso.responder("propostas_chat:insert", { data: null, error: null });
    n8nResponde(resposta.corpo, resposta.status);
    const res = await cancelarExterno(new Request("http://localhost/api/cobrancas/cancelar-externo", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer t" },
      body: JSON.stringify({ id: c.id, id_int: c.id_int, tipo_cobranca: "BOLETO", acao_local: "CANCEL", cod_c6: c.cod_solicitacao_inter, id_empresa: c.id_empresa, motivo: "teste" }) }));
    const corpo = (await res.json()) as Record<string, unknown>;
    const cancelou = falso.chamadas.some((x) => x.tabela === "pagamentos_v2" && x.op === "update" && (x.payload as Record<string, unknown>)?.status === "CANCELADO");
    return { status: res.status, corpo, cancelou, url: chamadas[0]?.url, segredo: chamadas[0]?.cabecalhos["x-vibe-webhook-secret"] };
  }
  const recusa = { status: 409, corpo: { success: false, message: "O C6 recusou o cancelamento: [BoletoClient]: Título com pendência(s) ou em situação no qual não possibilita alterações." } };
  const r1 = await cancelar(cobranca({}), recusa);
  confere("recusa do C6: Vibe NÃO cancela, responde 409 com a mensagem do banco", !r1.cancelou && r1.status === 409 && r1.corpo.code === "BOLETO_NAO_CANCELADO_NO_BANCO" && /Título com pendência/.test(String(r1.corpo.message)) && /continua ativo/.test(String(r1.corpo.message)), r1);
  confere("recusa do C6: foi ao del-boleto-av-biro-c6 com o segredo", r1.url === b.WEBHOOK_CANCELA_AVISTA_BIRO_C6 && r1.segredo === "segredo-de-teste", r1);
  const r2 = await cancelar(cobranca({}), { status: 200, corpo: { success: true, cancelado: true, cod_C6: COD_C6 } });
  confere("sucesso do C6 (cancelado: true): Vibe cancela", r2.cancelou && r2.status === 200, r2);
  const r3 = await cancelar(cobranca({}), { status: 200, corpo: { success: true } });
  confere("200 sem 'cancelado: true': Vibe NÃO cancela (sem confirmação)", !r3.cancelou && r3.status === 409, r3);
  const r4 = await cancelar(cobranca({ id_empresa: 1 }), { status: 200, corpo: {} });
  confere("Ideal: igual a hoje (HTTP 200 cancela, no del-boleto-av-vibe)", r4.cancelou && r4.url === `${N8N}/del-boleto-av-vibe`, r4);
  const r5 = await cancelar(cobranca({ cod_solicitacao_inter: UUID_INTER }), { status: 200, corpo: {} });
  confere("Birô no Inter: igual a hoje (HTTP 200 cancela, no cancela-boleto-inter-biro)", r5.cancelou && r5.url === `${N8N}/cancela-boleto-inter-biro`, r5);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
