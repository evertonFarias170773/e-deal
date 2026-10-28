/**
 * Botao "Gerar cobranca" com E-Credito comparado em centavos (28/10/2026, caso 20361).
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs scripts/testes/e-credito-botao.test.mts
 *
 * Nada vai ao banco.
 */
import { readFileSync } from "node:fs";
import { centavos, eCreditoBloqueado } from "@/features/cobrancas/lib/e-credito-botao";
import { roundMoney } from "@/features/cobrancas/cobrancas-utils";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok" : "FALHOU"} - ${nome}${ok ? "" : `\n   esperado ${JSON.stringify(esperado)}\n   veio     ${JSON.stringify(real)}`}`);
}
const base = { tipoSecundario: "PIX", condicaoSecundaria: "" };

// 20361: total 2.151,37, cobrado 1.360,38, credito 791,99.
const restanteCru = Math.max(roundMoney(2151.37) - roundMoney(1360.38), 0);
checar("o saldo cru da 20361 nao e 790,99 em ponto flutuante (a causa)", restanteCru === 790.99, false);
checar("20361 com o saldo cru: credito 791,99 cobre 790,99 -> habilitado", eCreditoBloqueado({ ...base, valor: 790.99, saldoCredito: 791.99, saldoRestante: restanteCru }), false);
checar("20361 com o saldo arredondado: habilitado", eCreditoBloqueado({ ...base, valor: 790.99, saldoCredito: 791.99, saldoRestante: roundMoney(restanteCru) }), false);
checar("credito exatamente igual ao valor: habilitado", eCreditoBloqueado({ ...base, valor: 790.99, saldoCredito: 790.99, saldoRestante: 790.99 }), false);
checar("credito 1 centavo menor: desabilitado", eCreditoBloqueado({ ...base, valor: 790.99, saldoCredito: 790.98, saldoRestante: 790.99 }), true);
checar("valor acima do saldo restante: desabilitado", eCreditoBloqueado({ ...base, valor: 791.0, saldoCredito: 900, saldoRestante: restanteCru }), true);
checar("valor zero: desabilitado", eCreditoBloqueado({ ...base, valor: 0, saldoCredito: 900, saldoRestante: 100 }), true);
checar("combinado com E-Faturado sem condicao: desabilitado; com condicao: habilitado", [
  eCreditoBloqueado({ valor: 50, saldoCredito: 50, saldoRestante: 100, tipoSecundario: "E-FATURADO", condicaoSecundaria: "" }),
  eCreditoBloqueado({ valor: 50, saldoCredito: 50, saldoRestante: 100, tipoSecundario: "E-FATURADO", condicaoSecundaria: "m1" })
], [true, false]);
checar("centavos", [centavos(790.9899999999998), centavos(791.99), centavos(0.1 + 0.2)], [79099, 79199, 30]);

const painel = readFileSync(new URL("../../src/features/cobrancas/PropostaCobrancaPanel.tsx", import.meta.url), "utf8");
checar("os dois botoes usam a regra em centavos; a comparacao antiga saiu", [
  (painel.match(/eCreditoBloqueado\(\{ valor: form\.valor, saldoCredito, saldoRestante, tipoSecundario, condicaoSecundaria \}\)/g) || []).length,
  painel.includes("form.valor > saldoCredito"),
  painel.includes("const saldoRestante = roundMoney(Math.max(totalPropostaRounded - totalCobradoRealRounded, 0));")
], [2, false, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
