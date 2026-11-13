/**
 * "Registrar devolução e cancelar pedido" (13/11/2026, caso 25098).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/registrar-devolucao.test.mts
 *
 * SEM banco: a regra pura (lib/devolucao-pagamento) e a rota
 * /api/cobrancas/registrar-devolucao com cliente Supabase falso. A função do
 * banco `fin_registrar_devolucao_e_cancelar` é simulada: o teste confere o que
 * a rota manda para ela e como traduz cada recusa DEV_* dela. A função em si
 * só é provada no banco (rodada da aplicação, com autorização).
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
    return proximo(especificador, contexto);
  }
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const { falso } = await import("./_supabase-falso.mts");
const rota = await import("../../src/app/api/cobrancas/registrar-devolucao/route.ts");
const regra = await import("../../src/features/cobrancas/lib/devolucao-pagamento.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

const FUNCAO = "rpc:fin_registrar_devolucao_e_cancelar";
const ID_25098_A = "a7bb051f-e5de-4201-ac84-65dc71c5e009";
const E2E = "D18236120202611131600aBcDeFgHiJk".toUpperCase();
const HOJE = regra.dataCivilSaoPaulo(new Date())!;

// ── Regra pura ──────────────────────────────────────────────────────────────
console.log("== quem vê e em qual cobrança");
confere("super admin vê", regra.podeRegistrarDevolucao({ isSuperAdmin: true }));
confere("admin comum não vê", !regra.podeRegistrarDevolucao({ isSuperAdmin: false }));
confere("sem usuário não vê", !regra.podeRegistrarDevolucao(null));
confere("PIX pago (25098-A, R$ 697) aceita", regra.cobrancaAceitaDevolucao({ status: "PAID", tipo_cobranca: "PIX", valor: 697 }));
confere("Boleto pago aceita", regra.cobrancaAceitaDevolucao({ status: "PAID", tipo_cobranca: "BOLETO", valor: 100 }));
confere("Cartão pago aceita", regra.cobrancaAceitaDevolucao({ status: "PAID", tipo_cobranca: "CARD_PARCELADO", valor: 100 }));
confere("PIX não pago recusa", !regra.cobrancaAceitaDevolucao({ status: "A_RECEBER", tipo_cobranca: "PIX", valor: 697 }));
for (const tipo of ["E-FATURADO", "E-CREDITO", "E-AMOSTRA", "E-RETRABALHO", "E-PERMUTA", "E_CREDITO"]) {
  confere(`${tipo} pago recusa (sem dinheiro recebido)`, !regra.cobrancaAceitaDevolucao({ status: "PAID", tipo_cobranca: tipo, valor: 100 }));
}

console.log("== campos");
const ok = { dataDevolucao: HOJE, e2eId: E2E, comprovante: "", motivo: "Cliente desistiu" };
confere("campos completos passam", regra.problemaNosCampos(ok, HOJE, "2026-11-13") === null);
confere("e2eId com espaços e minúsculas é normalizado", regra.normalizarE2e(" d1823 6120202611131600abcdefghijk ") === "D18236120202611131600ABCDEFGHIJK");
confere("e2eId curto recusa", /32 letras/.test(regra.problemaNosCampos({ ...ok, e2eId: "E123" }, HOJE, null) ?? ""));
confere("só o comprovante passa", regra.problemaNosCampos({ ...ok, e2eId: "", comprovante: "Autenticação 9F2A" }, HOJE, null) === null);
confere("sem e2eId e sem comprovante recusa", /e2eId da devolução ou/.test(regra.problemaNosCampos({ ...ok, e2eId: "" }, HOJE, null) ?? ""));
confere("sem motivo recusa", /motivo/.test(regra.problemaNosCampos({ ...ok, motivo: "  " }, HOJE, null) ?? ""));
confere("data futura recusa", /futura/.test(regra.problemaNosCampos({ ...ok, dataDevolucao: "2999-01-01" }, HOJE, null) ?? ""));
confere("data antes do pagamento recusa", /anterior ao pagamento/.test(regra.problemaNosCampos({ ...ok, dataDevolucao: "2026-11-12" }, HOJE, "2026-11-13") ?? ""));

console.log("== mês fechado e erros da função");
confere("confirmado em outubro, hoje novembro: mês fechado", regra.confirmadoEmMesFechado("2026-10-31T23:00:00Z", new Date("2026-11-13T15:00:00Z")));
confere("confirmado 31/10 21:30 em SP (01/11 UTC): ainda outubro", regra.confirmadoEmMesFechado("2026-11-01T00:30:00Z", new Date("2026-11-13T15:00:00Z")));
confere("confirmado no mês atual: não", !regra.confirmadoEmMesFechado("2026-11-13T19:30:21Z", new Date("2026-11-13T20:00:00Z")));
confere("código lido da mensagem", regra.codigoDoErro("DEV_NOTA_AUTORIZADA: cancele antes a nota fiscal (NF-e 7800)") === "DEV_NOTA_AUTORIZADA");
confere("texto sem o código", regra.textoDoErro("DEV_NOTA_AUTORIZADA: cancele antes a nota fiscal (NF-e 7800)") === "Cancele antes a nota fiscal (NF-e 7800).");
confere("trava de negócio é 409", regra.statusHttpDoErro("DEV_PRODUCAO") === 409);
confere("permissão é 403", regra.statusHttpDoErro("DEV_PERMISSAO") === 403);

// ── Rota ────────────────────────────────────────────────────────────────────
async function chamar(corpo: Record<string, unknown>, comToken = true) {
  const resposta = await rota.POST(
    new Request("http://localhost/api/cobrancas/registrar-devolucao", {
      method: "POST",
      headers: { ...(comToken ? { authorization: "Bearer token-de-teste" } : {}), "content-type": "application/json" },
      body: JSON.stringify(corpo)
    })
  );
  const json = (await resposta.json()) as Record<string, unknown>;
  const chamadaDaFuncao = falso.chamadas.find((c) => c.tabela === FUNCAO);
  return { status: resposta.status, json, args: chamadaDaFuncao?.payload as Record<string, unknown> | undefined, chamadas: falso.chamadas.length };
}

const corpo25098 = {
  idPagamento: ID_25098_A, valor: 697, dataDevolucao: HOJE, e2eId: E2E.toLowerCase(), comprovante: "", motivo: "Cliente desistiu do pedido"
};

console.log("== rota: 25098, PIX R$ 697");
falso.zerar();
falso.responder(FUNCAO, { data: { ja_registrada: false, id_devolucao: 1, id_int: 25098, valor: 697, ref_cobranca: "25098-A" }, error: null });
{
  const r = await chamar(corpo25098);
  confere("200 com a devolução", r.status === 200 && r.json.success === true && r.json.idInt === 25098 && r.json.jaRegistrada === false, r.json);
  confere("chama a função com o valor total e o e2eId normalizado", r.args?.p_id_pagamento === ID_25098_A && r.args?.p_valor === 697 && r.args?.p_e2e_id === E2E, r.args);
  confere("comprovante vazio vai nulo; motivo e data passam", r.args?.p_comprovante === null && r.args?.p_motivo === "Cliente desistiu do pedido" && r.args?.p_data_devolucao === HOJE, r.args);
  confere("mês fechado vai false sem a confirmação", r.args?.p_confirma_mes_fechado === false, r.args);
  confere("rota não grava direto em tabela nenhuma", !falso.chamadas.some((c) => c.op !== "select"), falso.chamadas);
}

console.log("== rota: segunda chamada (sem gravar em dobro)");
falso.zerar();
falso.responder(FUNCAO, { data: { ja_registrada: true, id_devolucao: 1, id_int: 25098, valor: 697, ref_cobranca: "25098-A" }, error: null });
{
  const r = await chamar(corpo25098);
  confere("200 com jaRegistrada", r.status === 200 && r.json.jaRegistrada === true, r.json);
}

console.log("== rota: recusas da função");
const recusas: [string, number, RegExp][] = [
  ["DEV_PERMISSAO: somente um super administrador pode registrar devolução e cancelar o pedido", 403, /super administrador/],
  ["DEV_NOTA_AUTORIZADA: cancele antes a nota fiscal (NF-e 7800)", 409, /NF-e 7800/],
  ["DEV_PRODUCAO: o pedido 25098 já foi para a produção; retire-o da produção antes", 409, /produção/],
  ["DEV_OUTRAS_COBRANCAS: o pedido tem outra cobrança ativa (25098-B (A_RECEBER)); resolva-a antes", 409, /25098-B/],
  ["DEV_VALOR: a devolução é do valor total da cobrança (R$ 697.00)", 400, /valor total/],
  ["DEV_MES_FECHADO: o pagamento foi confirmado em mês anterior; confirme que o faturamento fechado será alterado", 409, /mês anterior/]
];
for (const [mensagem, status, texto] of recusas) {
  falso.zerar();
  falso.responder(FUNCAO, { data: null, error: { message: mensagem } });
  const r = await chamar(corpo25098);
  const codigo = mensagem.split(":")[0];
  confere(`${codigo}: ${status} com a mensagem da função`, r.status === status && r.json.code === codigo && texto.test(String(r.json.message)), r);
}
falso.zerar();
falso.responder(FUNCAO, { data: null, error: { message: "connection reset" } });
{
  const r = await chamar(corpo25098);
  confere("erro sem código DEV_: 500, 'Nada foi alterado'", r.status === 500 && /Nada foi alterado/.test(String(r.json.message)), r.json);
}

console.log("== rota: forma recusada antes da função");
const formas: [string, Record<string, unknown>, boolean][] = [
  ["sem sessão", corpo25098, false],
  ["cobrança inválida", { ...corpo25098, idPagamento: "25098-A" }, true],
  ["valor zero", { ...corpo25098, valor: 0 }, true],
  ["sem e2eId e sem comprovante", { ...corpo25098, e2eId: "" }, true],
  ["e2eId curto", { ...corpo25098, e2eId: "E123" }, true],
  ["sem motivo", { ...corpo25098, motivo: "" }, true],
  ["data futura", { ...corpo25098, dataDevolucao: "2999-01-01" }, true]
];
for (const [nome, c, comToken] of formas) {
  falso.zerar();
  const r = await chamar(c, comToken);
  confere(`${nome}: recusa (${r.status}) sem chamar a função`, r.status >= 400 && r.status < 500 && !r.args, r);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
