/**
 * Reenvio, fase 2A — a cobranca da diferenca de frete fica fora do pago e do
 * cobrado da proposta (src/features/cobrancas/lib/cobranca-reenvio.ts).
 *
 * O corte do banco (cc__valor_pago) mora na migration
 * 20261022_exp_reenvio_fase2a_fundacao.sql; aqui o espelho das contas em
 * TypeScript: editar-paga, abonar-diferenca e o saldo da aba Pagamentos.
 * Prova principal: pedido SEM reenvio da exatamente o mesmo resultado. NAO TOCA EM BANCO.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/cobranca-reenvio.test.mts
 */
import { ehCobrancaDeReenvio, semCobrancaDeReenvio } from "../../src/features/cobrancas/lib/cobranca-reenvio.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${nome}${ok ? "" : `\n        obtido:   ${JSON.stringify(obtido)}\n        esperado: ${JSON.stringify(esperado)}`}`);
}

type Linha = {
  id: string;
  status: string;
  confirmado?: boolean | null;
  valor: number;
  obs_v2?: string | null;
  chave_reenvio?: string | null;
};

// As contas, copiadas das rotas como estao (nao foram alteradas; so a lista de entrada mudou).
const ABAT = /\[ABATIMENTO_DEBITO:(\d+(?:\.\d{1,2})?)\]/;
function pagoEditarPaga(cs: Linha[]): number {
  const v = cs
    .filter((c) => c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado))
    .reduce((sum, c) => {
      const m = String(c.obs_v2 || "").match(ABAT);
      return sum + Math.max(0, (Number(c.valor) || 0) - (m ? Number(m[1]) || 0 : 0));
    }, 0);
  return Math.round(v * 100) / 100;
}
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
function totalCobradoAtivo(cs: Linha[]): number {
  return round2(cs.reduce((s, c) => s + (Number(c.valor) || 0), 0));
}
function saldoAbaPagamentos(total: number, ativas: Linha[]): number {
  const cobrado = Math.round(semCobrancaDeReenvio(ativas).reduce((t, c) => t + c.valor, 0) * 100) / 100;
  return Math.max(Math.round(total * 100) / 100 - cobrado, 0);
}

// ── o marcador ────────────────────────────────────────────────────────────────
checar("sem a coluna (leitura antiga ou banco antes da migration) = da proposta", ehCobrancaDeReenvio({}), false);
checar("chave_reenvio null = da proposta", ehCobrancaDeReenvio({ chave_reenvio: null }), false);
checar("chave_reenvio vazia = da proposta", ehCobrancaDeReenvio({ chave_reenvio: "  " }), false);
checar("chave_reenvio preenchida = reenvio", ehCobrancaDeReenvio({ chave_reenvio: "REENVIO:23820:1" }), true);
checar("linha nula nao quebra", ehCobrancaDeReenvio(null), false);

// ── pedido SEM reenvio: a lista sai identica (mesmos objetos, mesma ordem) ────
const semReenvio: Linha[] = [
  { id: "a", status: "PAID", confirmado: true, valor: 100 },
  { id: "b", status: "A_VENCER", confirmado: true, valor: 40.45, obs_v2: "[ABATIMENTO_DEBITO:10.45]" },
  { id: "c", status: "A_RECEBER", confirmado: false, valor: 48 },
  { id: "d", status: "A_VENCER", confirmado: false, valor: 15, chave_reenvio: null }
];
const filtrada = semCobrancaDeReenvio(semReenvio);
checar("sem reenvio: mesma lista", filtrada, semReenvio);
checar("sem reenvio: mesmos objetos", filtrada.every((c, i) => c === semReenvio[i]), true);
checar("sem reenvio: pago igual ao de antes (editar-paga/abonar)", pagoEditarPaga(filtrada), pagoEditarPaga(semReenvio));
checar("sem reenvio: pago = 130 (100 + 40,45 - 10,45 de abatimento)", pagoEditarPaga(filtrada), 130);
checar("sem reenvio: total cobrado ativo igual ao de antes", totalCobradoAtivo(filtrada), totalCobradoAtivo(semReenvio));
checar("sem reenvio: saldo da aba igual ao de antes", saldoAbaPagamentos(250, semReenvio), 250 - totalCobradoAtivo(semReenvio));

// ── pedido COM reenvio: a cobranca do frete novo nao vira pago nem cobrado ────
// Proposta de R$ 130, quitada; reenvio cobra R$ 37,90 de frete e o cliente paga.
const quitada: Linha[] = [
  { id: "a", status: "PAID", confirmado: true, valor: 100 },
  { id: "b", status: "A_VENCER", confirmado: true, valor: 30 }
];
const comReenvioPago: Linha[] = [...quitada, { id: "r", status: "PAID", confirmado: true, valor: 37.9, chave_reenvio: "REENVIO:23820:1" }];
const comReenvioAberto: Linha[] = [...quitada, { id: "r", status: "A_RECEBER", confirmado: false, valor: 37.9, chave_reenvio: "REENVIO:23820:1" }];

checar("com reenvio pago: pago da proposta continua 130", pagoEditarPaga(semCobrancaDeReenvio(comReenvioPago)), 130);
checar("sem o corte, o pago viraria 167,90 (o credito falso de 37,90)", pagoEditarPaga(comReenvioPago), 167.9);
checar("com reenvio pago: total cobrado ativo continua 130", totalCobradoAtivo(semCobrancaDeReenvio(comReenvioPago)), 130);
checar("com reenvio em aberto: nao entra como cobranca pendente da proposta",
  semCobrancaDeReenvio(comReenvioAberto).filter((c) => !(c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado))).length, 0);
checar("aba Pagamentos: proposta de 130 quitada segue com saldo 0", saldoAbaPagamentos(130, comReenvioPago), 0);
// Proposta que ficou com saldo devedor real (total subiu para 150): a cobranca do reenvio nao o esconde.
checar("aba Pagamentos: saldo real de 20 nao e escondido pelo frete do reenvio", saldoAbaPagamentos(150, comReenvioPago), 20);
checar("ordem preservada sem a do reenvio", semCobrancaDeReenvio(comReenvioPago).map((c) => c.id), ["a", "b"]);

if (falhas > 0) {
  console.error(`\n${falhas} falha(s).`);
  process.exit(1);
}
console.log("\nTudo certo.");
