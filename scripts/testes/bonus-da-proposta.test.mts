/**
 * O bônus de tabela especial de UMA proposta — a linha gravada manda.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/bonus-da-proposta.test.mts
 *
 * Decisão de 19/08/2026 (CONTA-CORRENTE-CREDITO.md §4.2, item 13), Fase 4 em
 * 30/09/2026:
 *   leitores     → a linha TABELA_ESPECIAL; sem linha, 0% (o cadastro não entra);
 *   formulário e salvar → proposta ABERTA segue o bônus vigente do cliente (que
 *                  o salvar grava); com pagamento confirmado a linha CONGELA.
 */
const { bonusDaProposta, bonusDaEdicao, percentualGravado, temPagamentoConfirmado } = await import(
  "../../src/features/orcamentos/lib/bonus-da-proposta.ts"
);
const { totaisDaProposta } = await import("../../src/features/orcamentos/lib/total-da-proposta.ts");

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok =
    typeof real === "number" && typeof esperado === "number"
      ? Math.abs(real - esperado) < 0.005
      : JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `  — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)}`}`);
}
const leitor = (linha: { valor_percentual: unknown } | null) => bonusDaProposta(percentualGravado(linha));

// ── Leitores: só a linha ────────────────────────────────────────────────────
checar("SEM LINHA: 0% (o bônus do cadastro não entra mais)", leitor(null), 0);
checar("COM LINHA: vale a linha", leitor({ valor_percentual: 5 }), 5);
checar("linha com 0 vale 0", leitor({ valor_percentual: 0 }), 0);
checar("ex-cliente com bônus: linha 8 (LISITON)", leitor({ valor_percentual: 8 }), 8);
checar("percentual como texto (numeric do PostgREST)", leitor({ valor_percentual: "8" }), 8);
checar("percentual com casas", leitor({ valor_percentual: "2.5" }), 2.5);
checar("linha 100 é válida", leitor({ valor_percentual: 100 }), 100);
checar("negativo: ignora a linha => 0", leitor({ valor_percentual: -1 }), 0);
checar("acima de 100: ignora a linha => 0", leitor({ valor_percentual: 101 }), 0);
checar("não numérico: ignora a linha => 0", leitor({ valor_percentual: "abc" }), 0);
checar("percentual nulo: ignora a linha => 0", leitor({ valor_percentual: null }), 0);

// ── Formulário e salvar: aberta segue o cliente, congelada fica ─────────────
checar("ABERTA: vale o bônus vigente do cliente", bonusDaEdicao({ congelada: false, percentualDaLinha: 5, bonusDoCliente: 10 }), 10);
checar("aberta sem linha: o vigente (proposta nova)", bonusDaEdicao({ congelada: false, percentualDaLinha: null, bonusDoCliente: 5 }), 5);
checar("aberta de cliente sem bônus: 0", bonusDaEdicao({ congelada: false, percentualDaLinha: null, bonusDoCliente: 0 }), 0);
checar("CONGELADA: vale a linha, mesmo com o cliente em 10%", bonusDaEdicao({ congelada: true, percentualDaLinha: 5, bonusDoCliente: 10 }), 5);
checar("congelada com linha 0: 0, mesmo com o cliente em 10%", bonusDaEdicao({ congelada: true, percentualDaLinha: 0, bonusDoCliente: 10 }), 0);
checar("congelada sem linha: 0, nunca o cadastro", bonusDaEdicao({ congelada: true, percentualDaLinha: null, bonusDoCliente: 10 }), 0);
checar("bônus do cliente inválido vira 0", bonusDaEdicao({ congelada: false, percentualDaLinha: null, bonusDoCliente: Number.NaN }), 0);

// ── Pagamento confirmado: a regra de cc__valor_pago ─────────────────────────
checar("sem cobrança: aberta", temPagamentoConfirmado([]), false);
checar("PIX pendente: aberta", temPagamentoConfirmado([{ status: "PENDING", valor: 100 }]), false);
checar("PAID: congelada", temPagamentoConfirmado([{ status: "PAID", valor: 100 }]), true);
checar("A_VENCER confirmado (faturado): congelada", temPagamentoConfirmado([{ status: "A_VENCER", confirmado: true, valor: 100 }]), true);
checar("A_VENCER sem confirmação: aberta", temPagamentoConfirmado([{ status: "A_VENCER", confirmado: false, valor: 100 }]), false);
checar("cancelada não conta", temPagamentoConfirmado([{ status: "CANCELADO", valor: 100 }]), false);
checar("pago todo abatido de débito: aberta (como cc__valor_pago)",
  temPagamentoConfirmado([{ status: "PAID", valor: 50, obs_v2: "x [ABATIMENTO_DEBITO:50] y" }]), false);
checar("pago em parte abatido: congelada",
  temPagamentoConfirmado([{ status: "PAID", valor: 50, obs_v2: "[ABATIMENTO_DEBITO:20.50]" }]), true);
checar("status em minúscula", temPagamentoConfirmado([{ status: "paid", valor: 1 }]), true);

// ── Com a regra única do total ──────────────────────────────────────────────
// 22930: 4.600 x R$ 0,16 + R$ 40 = R$ 776,00; frete R$ 55,69; 5% => R$ 792,89.
const p22930 = (bonusPercent: number) =>
  totaisDaProposta({
    isAvulso: false, valorTotalGravado: 792.89, valor: 737.2, valorFrete: 55.69, bonusPercent, descontoGeral: null,
    itens: [{ qtd: 4600, valor_unt: 0.16, fixo: 40, status_item: "PENDENTE" }]
  }).total;
checar("22930 lida pela linha 5%: R$ 792,89", p22930(leitor({ valor_percentual: 5 })), 792.89);
checar("22930 paga, cliente passou a 10%: segue R$ 792,89 (congelada)",
  p22930(bonusDaEdicao({ congelada: true, percentualDaLinha: 5, bonusDoCliente: 10 })), 792.89);
// 19521: bruto R$ 345,00; 10% => R$ 310,50; desconto geral nominal R$ 120,80 => R$ 189,70.
checar("19521: bônus ANTES do desconto geral => R$ 189,70",
  totaisDaProposta({
    isAvulso: false, valorTotalGravado: 189.7, valor: 345, valorFrete: 0,
    bonusPercent: leitor({ valor_percentual: 10 }),
    descontoGeral: { valor_percentual: 0, valor_nominal: 120.8 },
    itens: [{ qtd: 1, valor_unt: 345, fixo: 0 }]
  }).total, 189.7);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
