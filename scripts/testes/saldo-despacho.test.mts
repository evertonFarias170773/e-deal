/**
 * Trava de saldo do despacho — o lado da tela (src/features/expedicao/lib/saldo-despacho.ts).
 *
 * Quem decide é o banco (exp_saldo_despacho + trg_exp_trava_despacho_saldo,
 * migration 20261021_exp_trava_saldo_despacho.sql); aqui só a leitura do veredito
 * e o texto que o expedidor vê. NÃO TOCA EM BANCO.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/saldo-despacho.test.mts
 */
import {
  MENSAGEM_PADRAO_SALDO,
  lerSaldoDoDespacho,
  mensagemDoSaldo,
  textoDaTravaDoDespacho,
} from "../../src/features/expedicao/lib/saldo-despacho.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${nome}${ok ? "" : `\n        obtido:   ${JSON.stringify(obtido)}\n        esperado: ${JSON.stringify(esperado)}`}`);
}

// O JSON real que o banco devolveu na prova de 21/10/2026 (pedido 23909 com R$ 0,01 a mais, desfeito).
const MENSAGEM =
  "Despacho bloqueado: falta receber R$ 0,01 deste pedido. O total do pedido é R$ 176,01 e o pago confirmado é R$ 176,00. " +
  "Gere a cobrança da diferença na aba Pagamentos da proposta (ou peça ao administrador para abonar a diferença) e despache depois que o pagamento for confirmado.";
const BLOQUEIA = { pago: 176.0, saldo: 0.01, total: 176.01, bloqueia: true, mensagem: MENSAGEM, situacao: "SALDO_A_RECEBER" };
const SEM_SALDO = { pago: 184.0, saldo: 0.0, total: 184.0, bloqueia: false, situacao: "SEM_SALDO" };

checar("saldo de R$ 0,01: bloqueia, com o texto do banco", [lerSaldoDoDespacho(BLOQUEIA)?.bloqueia, mensagemDoSaldo(lerSaldoDoDespacho(BLOQUEIA))], [true, MENSAGEM]);
checar("sem saldo: não bloqueia", lerSaldoDoDespacho(SEM_SALDO)?.bloqueia, false);
checar("valores lidos", (({ total, pago, saldo }) => [total, pago, saldo])(lerSaldoDoDespacho(BLOQUEIA)!), [176.01, 176, 0.01]);
checar("resposta fora do formato: sem veredito (a trigger segue valendo)", [lerSaldoDoDespacho(null), lerSaldoDoDespacho("x"), lerSaldoDoDespacho({ bloqueia: "sim" })], [null, null, null]);
checar("sem mensagem do banco: texto padrão", mensagemDoSaldo({ bloqueia: true, situacao: "SALDO_A_RECEBER" }), MENSAGEM_PADRAO_SALDO);
checar("erro cru da trigger de saldo vira só o texto", textoDaTravaDoDespacho(`EXP_DESPACHO_TRAVA_SALDO: ${MENSAGEM}`), MENSAGEM);
checar("erro cru da trigger de frete continua igual", textoDaTravaDoDespacho("EXP_DESPACHO_TRAVA_FRETE: recote o frete."), "recote o frete.");
checar("outro erro passa intacto", textoDaTravaDoDespacho("duplicate key value"), "duplicate key value");

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
