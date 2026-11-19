/**
 * Cartão C6 da Birô, etapa 3 (19/11/2026), montado DESLIGADO.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/cartao-biro.test.mts
 *
 * DUBLÊS: cliente Supabase falso e `fetch` falso. Nada sai daqui (nem n8n, nem C6).
 *   A. Chave CARTAO_BIRO: ausente/0/lixo = desligada; 1/true/sim/on/ligado/c6 = ligada.
 *   B. Desligada: cartão C6 só para 1 e 3 (como hoje). Ligada: 2 também.
 *   C. Edge: desligada, a Birô fica sem webhook (página responde 400, como hoje);
 *      ligada, vai para card-biro-c6. Ideal e E3 nunca mudam. Vibe e Edge leem a chave igual.
 *   D. Cancelar cartão: 2 vai para cancela-cartao-c6-biro; 1 e 3 seguem no cancela-cartao-c6-vibe.
 *   E. Asaas: o núcleo recusa empresa 2 e 3 sem chamar o n8n; a 1 segue.
 *   F. Telas e rotas usam a regra (painel, combinada, área do cliente, cancelamento).
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

const { falso, getSupabaseClient } = await import("./_supabase-falso.mts");
const vibe = await import("../../src/features/cobrancas/lib/cartao-biro.ts");
const edge = await import("../../supabase/functions/pagamento-publico/webhook-cartao.ts");
const { gerarCartaoAsasParaCobranca } = await import("../../src/features/cobrancas/services/cartao-asas.server.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

console.log("== A. chave CARTAO_BIRO");
for (const v of [undefined, "", "0", "false", "nao", "INTER", " "]) confere(`desligada com ${JSON.stringify(v)}`, vibe.cartaoBiroLigado(v) === false && edge.cartaoBiroLigado(v) === false);
for (const v of ["1", "true", "TRUE", " sim ", "on", "ligado", "c6"]) confere(`ligada com ${JSON.stringify(v)}`, vibe.cartaoBiroLigado(v) === true && edge.cartaoBiroLigado(v) === true);
delete process.env.CARTAO_BIRO;
confere("sem a variável no ambiente = desligada", vibe.cartaoBiroLigado() === false);

console.log("== B. empresas com cartão C6");
confere("desligada: 1 e 3 sim, 2 não (como hoje)", vibe.empresaTemCartaoC6(1, false) && vibe.empresaTemCartaoC6(3, false) && !vibe.empresaTemCartaoC6(2, false));
confere("ligada: 1, 2 e 3", vibe.empresaTemCartaoC6(1, true) && vibe.empresaTemCartaoC6(2, true) && vibe.empresaTemCartaoC6(3, true));
confere("outras empresas nunca", !vibe.empresaTemCartaoC6(4, true) && !vibe.empresaTemCartaoC6(null, true));
process.env.CARTAO_BIRO = "1";
confere("pelo ambiente ligado: 2 sim", vibe.empresaTemCartaoC6(2) === true);
delete process.env.CARTAO_BIRO;
confere("pelo ambiente desligado: 2 não", vibe.empresaTemCartaoC6(2) === false);

console.log("== C. Edge pagamento-publico: webhook do checkout");
confere("desligada: Birô sem webhook (página dá 400, como hoje)", edge.webhookCartaoPorEmpresa(2, undefined) === "");
confere("desligada: Ideal e E3 iguais a hoje",
  edge.webhookCartaoPorEmpresa(1, undefined) === "https://10074.hostoo.net.br/webhook/card-ideal-c6" &&
  edge.webhookCartaoPorEmpresa(3, undefined) === "https://10074.hostoo.net.br/webhook/card-e3-c6");
confere("ligada: Birô vai para card-biro-c6", edge.webhookCartaoPorEmpresa(2, "1") === "https://10074.hostoo.net.br/webhook/card-biro-c6");
confere("ligada: Ideal e E3 não mudam",
  edge.webhookCartaoPorEmpresa(1, "1").endsWith("/card-ideal-c6") && edge.webhookCartaoPorEmpresa(3, "1").endsWith("/card-e3-c6"));
confere("empresa desconhecida: sem webhook", edge.webhookCartaoPorEmpresa(9, "1") === "");
const idx = readFileSync("supabase/functions/pagamento-publico/index.ts", "utf8");
confere("a Edge usa a função, com o segredo CARTAO_BIRO", /webhookCartaoPorEmpresa\(idEmpresa, Deno\.env\.get\("CARTAO_BIRO"\)\)/.test(idx) && !/webhookPorEmpresa: Record/.test(idx));
confere("a Edge segue recusando empresa sem webhook", /if \(isCardParcelado && !n8nWebhookUrl\)/.test(idx));

console.log("== D. cancelamento do cartão C6");
confere("Ideal e E3: cancela-cartao-c6-vibe (como hoje)", vibe.webhookCancelaCartaoC6(1) === vibe.WEBHOOK_CANCELA_CARTAO_C6 && vibe.webhookCancelaCartaoC6("3") === vibe.WEBHOOK_CANCELA_CARTAO_C6 && vibe.WEBHOOK_CANCELA_CARTAO_C6.endsWith("/cancela-cartao-c6-vibe"));
confere("Birô: cancela-cartao-c6-biro", vibe.webhookCancelaCartaoC6(2) === vibe.WEBHOOK_CANCELA_CARTAO_BIRO_C6 && vibe.WEBHOOK_CANCELA_CARTAO_BIRO_C6.endsWith("/cancela-cartao-c6-biro"));

console.log("== E. Asaas só da Ideal");
let chamadasN8n = 0;
globalThis.fetch = (async () => { chamadasN8n++; return new Response("{}", { status: 200 }); }) as typeof fetch;
const linha = (id_empresa: number) => ({ id: "c1", id_pagamento: "999-A", id_cliente: 14, cliente: "TESTE", documento: "12345678000190", valor: 10, vencimento: "2026-11-25", descricao: "x", status: "A_RECEBER", tipo_cobranca: "CARD_PARCELADO", url_cobranca: "https://pay.ai-ideal.com.br/x", whats_contato: null, id_empresa });
for (const emp of [2, 3]) {
  falso.zerar(); chamadasN8n = 0;
  falso.responder("pagamentos_v2:select", { data: linha(emp), error: null });
  const r = await gerarCartaoAsasParaCobranca(getSupabaseClient() as never, "c1");
  confere(`empresa ${emp}: recusa (400 ASAAS_SO_IDEAL) sem chamar o n8n`, r.status === 400 && r.body.code === "ASAAS_SO_IDEAL" && chamadasN8n === 0, { r, chamadasN8n });
}
{
  falso.zerar(); chamadasN8n = 0;
  falso.responder("pagamentos_v2:select", { data: linha(1), error: null });
  const r = await gerarCartaoAsasParaCobranca(getSupabaseClient() as never, "c1");
  confere("empresa 1: passa da trava (segue para o fluxo de sempre)", r.body.code !== "ASAAS_SO_IDEAL", r);
}

console.log("== F. telas e rotas usam a regra");
const painel = readFileSync("src/features/cobrancas/PropostaCobrancaPanel.tsx", "utf8");
confere("painel: opção cartão pela regra", /if \(opcaoId === "CARD_PARCELADO"\) return empresaTemCartaoC6\(idEmpresa\);/.test(painel));
confere("painel: disponibilidade e mensagem pela regra", (painel.match(/empresaTemCartaoC6\(idEmpresaReal\)/g) ?? []).length === 2);
confere("painel: Birô sem a chave segue recusada no envio", /form\.tipoCobranca === "CARD_PARCELADO" && idEmpresaReal === 2 && !empresaTemCartaoC6\(2\)/.test(painel));
confere("painel: Asaas segue só da empresa 1", /if \(opcaoId === "CARD_ASAS"\) return idEmpresa === EMPRESA_CARTAO_ASAAS;/.test(painel) && vibe.EMPRESA_CARTAO_ASAAS === 1);
const comb = readFileSync("src/app/api/cobrancas/pagamento-combinado/route.ts", "utf8");
confere("combinada: cartão da Birô pela regra (o boleto da Birô segue a chave BOLETO_BIRO)", /\(\(isBoletoSecundario && !boletoBiroNoC6\(\)\) \|\| \(isCartaoSecundario && !empresaTemCartaoC6\(2\)\)\) && idEmpresaReal === 2/.test(comb));
const area = readFileSync("src/features/area-cliente/services/area-cliente.server.ts", "utf8");
confere("área do cliente: cartão pela regra", /cartao: idEmpresa != null && empresaTemCartaoC6\(idEmpresa\)/.test(area) && !/EMPRESAS_COM_CARTAO\.has/.test(area));
const canc = readFileSync("src/app/api/cobrancas/cancelar-externo/route.ts", "utf8");
confere("cancelar-externo: webhook do cartão pela empresa; segredo só no da Birô", /const webhookUrl = webhookCancelaCartaoC6\(idEmpresaCobranca\);/.test(canc) && /webhookUrl === WEBHOOK_CANCELA_CARTAO_BIRO_C6 \? cabecalhosWebhookN8n\(\)/.test(canc));
const cfg = readFileSync("next.config.ts", "utf8");
confere("next.config: CARTAO_BIRO chega à tela (sem NEXT_PUBLIC_)", /CARTAO_BIRO: process\.env\.CARTAO_BIRO \?\? ""/.test(cfg));

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
