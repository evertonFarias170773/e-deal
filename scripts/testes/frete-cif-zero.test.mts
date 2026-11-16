/**
 * Frete CIF nunca é R$ 0,00 (regra do dono 11/11/2026; trava 16/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/frete-cif-zero.test.mts
 */
import { readFileSync } from "node:fs";
import { freteCifZeroRecusado, recusaFreteCifZeroNoErro, MENSAGEM_FRETE_CIF_ZERO } from "../../src/features/orcamentos/lib/frete-cif-zero.ts";
import { MENSAGEM_GATILHO_FRETE_CIF_ZERO, recusaDoGatilhoNoErro } from "../../src/features/cobrancas/lib/tipo-x-retrabalho.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else console.log(`ok      ${nome}`);
}

const base = { modalidade: "CIF", valorFrete: 0, isAvulso: false, ehComplemento: false, clientePodeEditarFrete: false };
checar("CIF a zero: recusa", freteCifZeroRecusado(base), true);
checar("modalidade nula cobra frete: recusa", freteCifZeroRecusado({ ...base, modalidade: null }), true);
checar("CIF com centavos abaixo de 1 centavo: recusa", freteCifZeroRecusado({ ...base, valorFrete: 0.004 }), true);
checar("CIF com valor: passa", freteCifZeroRecusado({ ...base, valorFrete: 0.01 }), false);
checar("FOB e RETIRA a zero: passam", [freteCifZeroRecusado({ ...base, modalidade: "FOB" }), freteCifZeroRecusado({ ...base, modalidade: "retira" })], [false, false]);
checar("avulsa (Frete Incluso): passa", freteCifZeroRecusado({ ...base, isAvulso: true }), false);
checar("complementar com diferença ≤ 0: passa", freteCifZeroRecusado({ ...base, ehComplemento: true }), false);
checar("cliente com Pode editar valor do frete: passa", freteCifZeroRecusado({ ...base, clientePodeEditarFrete: true }), false);
checar("mensagem combinada", MENSAGEM_FRETE_CIF_ZERO, "Frete CIF não pode ser R$ 0,00. Cote ou informe o valor do frete.");
checar("erro do gatilho vira a mensagem limpa", [recusaFreteCifZeroNoErro(`ERROR: ${MENSAGEM_FRETE_CIF_ZERO}`), recusaFreteCifZeroNoErro("outro")], [MENSAGEM_FRETE_CIF_ZERO, null]);
checar("portas que já limpam o gatilho reconhecem o frete", [MENSAGEM_GATILHO_FRETE_CIF_ZERO === MENSAGEM_FRETE_CIF_ZERO, recusaDoGatilhoNoErro(`P0001: ${MENSAGEM_FRETE_CIF_ZERO}`)], [true, MENSAGEM_FRETE_CIF_ZERO]);

const servico = readFileSync("src/features/orcamentos/services/orcamentos.service.ts", "utf8");
const migration = readFileSync("supabase/migrations/20261116_pagamentos_v2_frete_cif_zero.sql", "utf8");
const trecho = servico.slice(servico.indexOf("FRETE CIF NUNCA É R$ 0,00"), servico.indexOf("// Map internal freight name"));
checar("Salvar recusa sobre o valor final, só quando regrava o frete, com o cadastro relido",
  [trecho.includes("regravaFrete &&"), trecho.includes("!propostaSemItens"), trecho.includes("valorFrete: freteValor"), trecho.includes("cadastro?.podeEditarFrete === true"), trecho.includes("errorMessage: MENSAGEM_FRETE_CIF_ZERO")],
  [true, true, true, true, true]);
checar("Salvar não toca o Valor negociado do frete (admin)", /valor_frete_negociado|freteNegociado/.test(trecho), false);
checar("gatilho: mesma mensagem e as exceções",
  [migration.includes(`RAISE EXCEPTION '${MENSAGEM_FRETE_CIF_ZERO}'`), migration.includes("OR v_avulso"), migration.includes("OR v_principal IS NOT NULL"), migration.includes("v_modalidade IN ('FOB', 'RETIRA')"), migration.includes("coalesce(v_pode, false)"), migration.includes("NOT IN ('CANCELADO', 'CANCELADA')")],
  [true, true, true, true, true, true]);
checar("gatilho só no INSERT", migration.includes("BEFORE INSERT ON public.pagamentos_v2"), true);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else console.log("\nTudo certo.");
