/**
 * Revisão do faturado com o pagamento inteiro do pedido (24/11/2026, caso 25427).
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/revisao-faturado-com-entrada.test.mts
 *
 * SEM banco. Regras puras de `lib/revisao-faturado-com-entrada.ts`:
 *   A. os prefixos batem com o que `montarLinhasFaturadoComEntrada` grava;
 *   B. 25427 de verdade (linhas copiadas do banco em 24/11): o restante 25427-I
 *      acha a entrada 25427-H (mesma criação), e não os pares cancelados;
 *   C. situação da entrada: não paga, paga, paga e conferida, cancelada;
 *   D. parcelas previstas com a conta do Preparar Boletos (centavo na última,
 *      entrada da condição antes);
 *   E. faturado comum (sem "Faturado com entrada"): nenhum quadro;
 *   F. soma diferente do total de hoje: avisa; sem a entrada: avisa.
 */
import assert from "node:assert/strict";
import {
  PREFIXO_ENTRADA_FATURADO_COM_ENTRADA,
  PREFIXO_RESTANTE_FATURADO_COM_ENTRADA,
  acharEntradaDoFaturado,
  montarQuadroPagamentoInteiro,
  parcelasPrevistasDoFaturado,
  situacaoDaEntrada,
  type LinhaDoPedido
} from "@/features/cobrancas/lib/revisao-faturado-com-entrada";
import { montarLinhasFaturadoComEntrada } from "@/features/cobrancas/lib/faturado-com-entrada";

let ok = 0;
function caso(nome: string, fn: () => void) {
  fn();
  ok++;
  console.log("ok -", nome);
}

caso("A. prefixos iguais aos do construtor do Faturado com entrada", () => {
  for (const forma of ["PIX", "BOLETO"] as const) {
    const [a, b] = montarLinhasFaturadoComEntrada({
      comuns: { idInt: 1, pagador: { idCliente: 1, nome: "X", documento: null }, empresa: "E", idEmpresa: 1, osIdeal: null, atendente: "A", observacao: null },
      divisao: { entradaCentavos: 100, restanteCentavos: 200 },
      formaEntrada: forma,
      vencimentoEntrada: "2026-11-27",
      vencimentoFaturado: "2026-12-04",
      condicao: { id: "c", resultado: "Prazo 10 dias", qtd_parcela: 1, inicio: 10, intervalo: 0, entrada_porcento: 0 },
      ids: { entrada: "e-1", faturado: "f-1" },
      urlEntrada: null
    });
    assert.ok(String(a.descricao).startsWith(PREFIXO_ENTRADA_FATURADO_COM_ENTRADA));
    assert.ok(String(b.descricao).startsWith(PREFIXO_RESTANTE_FATURADO_COM_ENTRADA));
  }
});

const ENT = "Entrada (PIX) do Faturado com entrada da proposta #25427";
const RES = "Restante (Faturado) do Faturado com entrada da proposta #25427";
const linha = (p: Partial<LinhaDoPedido> & { id: string }): LinhaDoPedido => ({
  id_pagamento: null, tipo_cobranca: null, status: null, valor: null, paid_at: null, confirmado: false,
  vencimento: null, descricao: null, created_at: null, ...p
});
const PEDIDO_25427: LinhaDoPedido[] = [
  linha({ id: "A", id_pagamento: "25427-A", tipo_cobranca: "PIX", status: "CANCELADO", valor: "10676.00", descricao: ENT, created_at: "2026-11-19 02:36:44.613765+00" }),
  linha({ id: "B", id_pagamento: "25427-B", tipo_cobranca: "E-FATURADO", status: "CANCELADO", valor: "10675.93", descricao: RES, created_at: "2026-11-19 02:36:44.613765+00" }),
  linha({ id: "C", id_pagamento: "25427-C", tipo_cobranca: "PIX", status: "CANCELADO", valor: "10677.00", descricao: ENT, created_at: "2026-11-23 12:35:17.390357+00" }),
  linha({ id: "E", id_pagamento: "25427-E", tipo_cobranca: "PIX", status: "CANCELADO", valor: "10677.00", descricao: ENT, created_at: "2026-11-23 12:52:30.356407+00" }),
  linha({ id: "G", id_pagamento: "25427-G", tipo_cobranca: "PIX", status: "CANCELADO", valor: "10675.97", descricao: "Cobrança PIX da proposta #25427", created_at: "2026-11-24 15:17:00.69222+00" }),
  linha({ id: "H", id_pagamento: "25427-H", tipo_cobranca: "PIX", status: "A_RECEBER", valor: "10675.97", vencimento: "2026-11-27", descricao: ENT, created_at: "2026-11-24 16:45:56.17435+00" }),
  linha({ id: "I", id_pagamento: "25427-I", tipo_cobranca: "E-FATURADO", status: "A_VENCER", valor: "10675.96", descricao: RES, created_at: "2026-11-24 16:45:56.17435+00",
          p_qtd_parcelas: 1, p_valor_entrada: "0.00", p_dias_pra_inicio: 10, p_intervalo: 0 })
];

caso("B. 25427-I acha a 25427-H e monta o quadro inteiro", () => {
  const faturado = PEDIDO_25427.find((l) => l.id === "I")!;
  assert.equal(acharEntradaDoFaturado(faturado, PEDIDO_25427)?.id_pagamento, "25427-H");
  assert.equal(acharEntradaDoFaturado(PEDIDO_25427.find((l) => l.id === "B")!, PEDIDO_25427)?.id_pagamento, "25427-A");
  const q = montarQuadroPagamentoInteiro({ faturado, linhasDoPedido: PEDIDO_25427, totalDoPedido: 21351.93 })!;
  assert.equal(q.totalDoPedido, 21351.93);
  assert.deepEqual(q.entrada, { id_pagamento: "25427-H", forma: "PIX", valor: 10675.97, situacao: { codigo: "NAO_PAGA", texto: "Ainda não paga (vence em 27/11/2026)" } });
  assert.equal(q.restante.id_pagamento, "25427-I");
  assert.equal(q.restante.valor, 10675.96);
  assert.deepEqual(q.restante.parcelas, [{ numero: 1, total: 1, valor: 10675.96, dias: 10, ehEntrada: false }]);
  assert.equal(q.somaDivergente, null);
});

caso("C. situação da entrada", () => {
  assert.equal(situacaoDaEntrada({ status: "PAID", paid_at: "2026-11-24T23:30:00Z", confirmado: false, vencimento: null }).texto, "Paga em 24/11/2026, aguardando conferência");
  assert.equal(situacaoDaEntrada({ status: "PAID", paid_at: "2026-11-25T02:30:00Z", confirmado: true, vencimento: null }).texto, "Paga em 24/11/2026 e conferida");
  assert.equal(situacaoDaEntrada({ status: "CANCELADO", paid_at: null, confirmado: false, vencimento: null }).codigo, "CANCELADA");
  assert.equal(situacaoDaEntrada({ status: "A_RECEBER", paid_at: null, confirmado: false, vencimento: null }).texto, "Ainda não paga");
});

caso("D. parcelas previstas: centavo na última; entrada da condição antes", () => {
  assert.deepEqual(
    parcelasPrevistasDoFaturado({ valor: 100, p_qtd_parcelas: 3, p_dias_pra_inicio: 28, p_intervalo: 30, p_valor_entrada: 0 }).map((p) => [p.numero, p.total, p.valor, p.dias]),
    [[1, 3, 33.33, 28], [2, 3, 33.33, 58], [3, 3, 33.34, 88]]
  );
  assert.deepEqual(
    parcelasPrevistasDoFaturado({ valor: 1000, p_qtd_parcelas: 2, p_dias_pra_inicio: 30, p_intervalo: 30, p_valor_entrada: 300 }).map((p) => [p.numero, p.total, p.valor, p.dias, p.ehEntrada]),
    [[1, 3, 300, 0, true], [2, 3, 350, 30, false], [3, 3, 350, 60, false]]
  );
  assert.deepEqual(parcelasPrevistasDoFaturado({ valor: 0, p_qtd_parcelas: 1 }), []);
});

caso("E. faturado comum: sem quadro (a janela fica como era)", () => {
  const comum = linha({ id: "X", tipo_cobranca: "E-FATURADO", valor: 500, descricao: "Cobrança E-FATURADO da proposta #1", created_at: "2026-11-24 10:00:00+00" });
  assert.equal(montarQuadroPagamentoInteiro({ faturado: comum, linhasDoPedido: [comum], totalDoPedido: 500 }), null);
});

caso("F. soma diferente do total de hoje e entrada não achada", () => {
  const faturado = PEDIDO_25427.find((l) => l.id === "I")!;
  const q = montarQuadroPagamentoInteiro({ faturado, linhasDoPedido: PEDIDO_25427, totalDoPedido: 22000 })!;
  assert.equal(q.somaDivergente, 21351.93);
  const sem = montarQuadroPagamentoInteiro({ faturado, linhasDoPedido: [faturado], totalDoPedido: 21351.93 })!;
  assert.equal(sem.entrada, null);
  assert.equal(sem.somaDivergente, null);
});

console.log(`\n${ok} casos ok`);
