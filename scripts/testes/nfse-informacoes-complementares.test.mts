/**
 * Janela "Gerar NFS-e", informações complementares — src/features/nfse/lib/composicao-nfse.ts
 *
 *   node --experimental-strip-types scripts/testes/nfse-informacoes-complementares.test.mts
 *
 * O QUE PROVA
 *   1. O texto que a janela propõe para cada tipo de pagamento do pedido
 *      (faturado, PIX, cartão, boleto, mais de uma cobrança, cancelada, sem
 *      cobrança), sem inventar data que não foi lida.
 *   2. A limpeza que a rota faz antes de gravar: bordas, caracteres de controle,
 *      quebra de linha preservada e corte em 2.000.
 *   3. O que a janela mostra do texto gravado: a reserva do banco ("NBS:" e o
 *      código) nunca aparece; texto real aparece inteiro.
 */
import {
  LIMITE_INFORMACOES_COMPLEMENTARES_NFSE,
  informacoesComplementaresDaNota,
  limparInformacoesComplementares,
  tamanhoDasInformacoesComplementares,
  textoDoPagamentoParaNota,
  type CobrancaDoPedido
} from "../../src/features/nfse/lib/composicao-nfse.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  if (!passou) falhas += 1;
  console.log(`${passou ? "ok  " : "FALHOU"} ${nome}${passou ? "" : `\n     esperado: ${JSON.stringify(esperado)}\n     real:     ${JSON.stringify(real)}`}`);
}

const cob = (c: Partial<CobrancaDoPedido>): CobrancaDoPedido => ({
  tipo: "PIX",
  forma: null,
  valor: 100,
  vencimento: "2026-10-15",
  status: "A_RECEBER",
  confirmado: false,
  parcelas: null,
  intervaloDias: null,
  valorEntrada: null,
  pagoEm: null,
  ...c
});

// ── 1. O texto proposto, por tipo de pagamento ─────────────────────────────
ok(
  "faturado, 1 parcela",
  textoDoPagamentoParaNota([cob({ tipo: "E-FATURADO", forma: "Prazo 7 dias", valor: 20, status: "A_VENCER", confirmado: true })]),
  "Forma de pagamento: Faturado. 1 parcela. Vencimento: 15/10/2026 (R$ 20,00)."
);
ok(
  "faturado gravado como E-Faturado (caixa diferente)",
  textoDoPagamentoParaNota([cob({ tipo: "E-Faturado", valor: 20, status: "A_VENCER" })]),
  "Forma de pagamento: Faturado. 1 parcela. Vencimento: 15/10/2026 (R$ 20,00)."
);
ok(
  "faturado, 2 parcelas com intervalo",
  textoDoPagamentoParaNota([cob({ tipo: "E-FATURADO", valor: 100, vencimento: "2026-10-28", parcelas: 2, intervaloDias: 14, status: "A_VENCER" })]),
  "Forma de pagamento: Faturado. 2 parcelas. Vencimentos: 28/10/2026 (R$ 50,00) e 11/11/2026 (R$ 50,00)."
);
ok(
  "faturado, 3 parcelas: a ultima leva o arredondamento",
  textoDoPagamentoParaNota([cob({ tipo: "E-FATURADO", valor: 100, vencimento: "2026-10-07", parcelas: 3, intervaloDias: 7, status: "A_VENCER" })]),
  "Forma de pagamento: Faturado. 3 parcelas. Vencimentos: 07/10/2026 (R$ 33,33), 14/10/2026 (R$ 33,33) e 21/10/2026 (R$ 33,34)."
);
ok(
  "faturado parcelado sem intervalo: nao inventa as datas",
  textoDoPagamentoParaNota([cob({ tipo: "E-FATURADO", valor: 100, parcelas: 2, intervaloDias: null, status: "A_VENCER" })]),
  "Forma de pagamento: Faturado. 2 parcelas (R$ 100,00)."
);
ok(
  "faturado sem vencimento gravado",
  textoDoPagamentoParaNota([cob({ tipo: "E-FATURADO", valor: 80, vencimento: null, status: "A_VENCER" })]),
  "Forma de pagamento: Faturado. 1 parcela (R$ 80,00)."
);
ok(
  "PIX pago, com a data em Brasilia (22h de 06/10 em Brasilia e 01h de 07/10 em UTC)",
  textoDoPagamentoParaNota([cob({ tipo: "PIX", valor: 270, status: "PAID", confirmado: true, pagoEm: "2026-10-07T01:00:00+00:00" })]),
  "Forma de pagamento: PIX. Pago em 06/10/2026 (R$ 270,00)."
);
ok(
  "PIX pago sem data de pagamento gravada",
  textoDoPagamentoParaNota([cob({ tipo: "PIX", valor: 270, status: "PAID", pagoEm: null })]),
  "Forma de pagamento: PIX (R$ 270,00)."
);
ok(
  "PIX em aberto",
  textoDoPagamentoParaNota([cob({ tipo: "PIX", valor: 115.41, vencimento: "2026-10-09" })]),
  "Forma de pagamento: PIX. Vencimento: 09/10/2026 (R$ 115,41)."
);
ok(
  "cartao parcelado pago",
  textoDoPagamentoParaNota([cob({ tipo: "CARD_PARCELADO", valor: 300, parcelas: 3, status: "PAID", pagoEm: "2026-10-06T13:11:06+00:00" })]),
  "Forma de pagamento: Cartão, 3 parcelas. Pago em 06/10/2026 (R$ 300,00)."
);
ok(
  "cartao em aberto: sem vencimento de parcela",
  textoDoPagamentoParaNota([cob({ tipo: "CARD_PARCELADO", valor: 300, parcelas: 3, intervaloDias: 30 })]),
  "Forma de pagamento: Cartão, 3 parcelas (R$ 300,00)."
);
ok(
  "cartao em 1 parcela",
  textoDoPagamentoParaNota([cob({ tipo: "CARD_PARCELADO", valor: 115.41, parcelas: 1, status: "PAID", pagoEm: "2026-10-06T13:11:06+00:00" })]),
  "Forma de pagamento: Cartão, 1 parcela. Pago em 06/10/2026 (R$ 115,41)."
);
ok(
  "boleto em aberto",
  textoDoPagamentoParaNota([cob({ tipo: "BOLETO", valor: 80, vencimento: "2026-10-20" })]),
  "Forma de pagamento: Boleto. Vencimento: 20/10/2026 (R$ 80,00)."
);
ok(
  "boleto pago",
  textoDoPagamentoParaNota([cob({ tipo: "BOLETO", valor: 80, status: "PAID", pagoEm: "2026-10-19T15:00:00+00:00" })]),
  "Forma de pagamento: Boleto. Pago em 19/10/2026 (R$ 80,00)."
);
ok(
  "credito do cliente",
  textoDoPagamentoParaNota([cob({ tipo: "E-CREDITO", valor: 50, status: "PAID", pagoEm: "2026-10-01T12:00:00+00:00" })]),
  "Forma de pagamento: Crédito do cliente. Pago em 01/10/2026 (R$ 50,00)."
);
ok(
  "mais de uma cobranca: uma por linha, na ordem lida",
  textoDoPagamentoParaNota([
    cob({ tipo: "PIX", valor: 100, status: "PAID", pagoEm: "2026-10-06T13:00:00+00:00" }),
    cob({ tipo: "E-FATURADO", valor: 200, vencimento: "2026-11-05", status: "A_VENCER" })
  ]),
  "Forma de pagamento: PIX. Pago em 06/10/2026 (R$ 100,00).\nForma de pagamento: Faturado. 1 parcela. Vencimento: 05/11/2026 (R$ 200,00)."
);
ok(
  "cobranca cancelada fica fora",
  textoDoPagamentoParaNota([cob({ tipo: "PIX", status: "CANCELADO" }), cob({ tipo: "BOLETO", valor: 80, vencimento: "2026-10-20" })]),
  "Forma de pagamento: Boleto. Vencimento: 20/10/2026 (R$ 80,00)."
);
ok("so cobranca cancelada: campo vazio", textoDoPagamentoParaNota([cob({ status: "CANCELADO" }), cob({ status: "CANCELADA" })]), "");
ok("pedido sem cobranca: campo vazio", textoDoPagamentoParaNota([]), "");
ok(
  "tipo desconhecido sai como esta gravado",
  textoDoPagamentoParaNota([cob({ tipo: "Transferencia", valor: 10, vencimento: null })]),
  "Forma de pagamento: Transferencia (R$ 10,00)."
);
ok(
  "valor com milhar",
  textoDoPagamentoParaNota([cob({ tipo: "BOLETO", valor: 1234.5, vencimento: "2026-12-01" })]),
  "Forma de pagamento: Boleto. Vencimento: 01/12/2026 (R$ 1.234,50)."
);

// ── 2. A limpeza antes de gravar ────────────────────────────────────────────
ok("limpeza: vazio vira nulo", limparInformacoesComplementares(""), null);
ok("limpeza: so espacos e quebras vira nulo", limparInformacoesComplementares("  \n\t \r\n "), null);
ok("limpeza: o que nao e texto vira nulo", [limparInformacoesComplementares(null), limparInformacoesComplementares(undefined), limparInformacoesComplementares(12)], [null, null, null]);
ok("limpeza: tira as bordas", limparInformacoesComplementares("  \n Pagamento: PIX \n "), "Pagamento: PIX");
ok("limpeza: a quebra de linha fica, e \\r\\n vira \\n", limparInformacoesComplementares("linha 1\r\nlinha 2\rlinha 3\nlinha 4"), "linha 1\nlinha 2\nlinha 3\nlinha 4");
ok("limpeza: caractere de controle sai e a tabulacao vira espaco", limparInformacoesComplementares("a\u0000b\u0007c\td\u001Fe\u007Ff"), "abc def");
ok("limpeza: acento e simbolo ficam", limparInformacoesComplementares("Condição: 2ª parcela – R$ 10,00 (à vista)"), "Condição: 2ª parcela – R$ 10,00 (à vista)");
ok("limpeza: 2.000 caracteres passam inteiros", limparInformacoesComplementares("x".repeat(2000))?.length, 2000);
ok("limpeza: 2.300 caracteres sao cortados em 2.000", limparInformacoesComplementares("x".repeat(2300))?.length, LIMITE_INFORMACOES_COMPLEMENTARES_NFSE);
ok("limpeza: texto que comeca com NBS e continua e texto real", limparInformacoesComplementares("NBS:121011000 - Pagamento: PIX"), "NBS:121011000 - Pagamento: PIX");
ok("contador: conta como a rota, sem bordas e sem \\r", tamanhoDasInformacoesComplementares("  ab\r\ncd  "), 5);
ok("contador: 2.001 estoura o limite", tamanhoDasInformacoesComplementares("x".repeat(2001)) > LIMITE_INFORMACOES_COMPLEMENTARES_NFSE, true);
ok("contador: 2.000 nao estoura", tamanhoDasInformacoesComplementares("x".repeat(2000)) > LIMITE_INFORMACOES_COMPLEMENTARES_NFSE, false);
ok("contador: campo vazio tem zero", tamanhoDasInformacoesComplementares("   "), 0);

// ── 3. O texto gravado, do jeito que a janela mostra ───────────────────────
ok("rascunho so com a reserva nova: nada a mostrar", informacoesComplementaresDaNota("NBS:121011000"), null);
ok("nota antiga com a reserva antiga: nada a mostrar", informacoesComplementaresDaNota("NBS:121012200"), null);
ok("reserva com espaco e caixa diferente: nada a mostrar", informacoesComplementaresDaNota("  nbs: 121011000 "), null);
ok("coluna vazia ou nula: nada a mostrar", [informacoesComplementaresDaNota(""), informacoesComplementaresDaNota(null), informacoesComplementaresDaNota(undefined)], [null, null, null]);
ok(
  "nota autorizada com texto real: mostra inteiro, com as linhas",
  informacoesComplementaresDaNota("Forma de pagamento: PIX. Pago em 06/10/2026 (R$ 100,00).\nForma de pagamento: Faturado. 1 parcela. Vencimento: 05/11/2026 (R$ 200,00)."),
  "Forma de pagamento: PIX. Pago em 06/10/2026 (R$ 100,00).\nForma de pagamento: Faturado. 1 parcela. Vencimento: 05/11/2026 (R$ 200,00)."
);
ok("texto que comeca com NBS e continua aparece", informacoesComplementaresDaNota("NBS:121011000 - Pagamento: PIX"), "NBS:121011000 - Pagamento: PIX");

// O texto proposto passa pela limpeza sem mudar (é o que vai para o banco).
const proposto = textoDoPagamentoParaNota([cob({ tipo: "E-FATURADO", valor: 100, vencimento: "2026-10-28", parcelas: 2, intervaloDias: 14, status: "A_VENCER" }), cob({ tipo: "PIX", valor: 10 })]);
ok("o texto proposto nao muda na limpeza", limparInformacoesComplementares(proposto), proposto);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
