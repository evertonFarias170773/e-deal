/**
 * NF-e com entrada + boleto: regras da aba Pagamentos (24/11/2026, caso 25427).
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/pagamento-entrada-boleto.test.mts
 *
 * SEM banco. Regras puras de `features/nfe/lib/pagamento-entrada-boleto.ts`:
 *   A. 25427 de verdade (cobranças copiadas do banco em 24/11): o gerador vem
 *      com entrada PIX 10.675,97 (25427-H, vence 27/11) + boleto 10.675,96
 *      vencendo 04/12 (25427-I), ignorando os pares cancelados;
 *   B. sem par ativo: nada a preencher;
 *   C. entrada paga: a data é a do pagamento (em São Paulo);
 *   D. vencimento antes da emissão só barra boleto;
 *   E. parcelas já geradas com entrada de forma própria: não repreenche;
 *   F. a tela usa as regras (tabela, gerador, conclusão) e o serviço ajusta a
 *      parcela ENTRADA depois de gerar.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formaFiscalDaCobranca,
  parcelasJaTemEntradaComFormaPropria,
  rotuloDaFormaFiscal,
  sugestaoPeloFaturadoComEntrada,
  vencimentoBarraConclusao
} from "@/features/nfe/lib/pagamento-entrada-boleto";
import type { LinhaDoPedido } from "@/features/cobrancas/lib/revisao-faturado-com-entrada";

let ok = 0;
function caso(nome: string, fn: () => void) {
  fn();
  ok += 1;
  console.log(`ok - ${nome}`);
}

const ENTRADA = "Entrada (PIX) do Faturado com entrada da proposta #25427";
const RESTANTE = "Restante (Faturado) do Faturado com entrada da proposta #25427";
function linha(p: Partial<LinhaDoPedido> & { id: string }): LinhaDoPedido {
  return {
    id_pagamento: null, tipo_cobranca: null, status: null, valor: null, paid_at: null,
    confirmado: false, vencimento: null, descricao: null, created_at: null, ...p
  };
}
// As linhas de pagamentos_v2 do 25427 em 24/11/2026 (H e I ativas; o resto cancelado).
const LINHAS_25427: LinhaDoPedido[] = [
  linha({ id: "a", id_pagamento: "25427-A", tipo_cobranca: "PIX", status: "CANCELADO", valor: "10676.00", vencimento: "2026-11-21", descricao: ENTRADA, created_at: "2026-11-19 02:36:44.613765+00" }),
  linha({ id: "b", id_pagamento: "25427-B", tipo_cobranca: "E-FATURADO", status: "CANCELADO", valor: "10675.93", vencimento: "2026-12-16", descricao: RESTANTE, created_at: "2026-11-19 02:36:44.613765+00", p_qtd_parcelas: 1, p_dias_pra_inicio: 28, p_intervalo: 0 }),
  linha({ id: "g", id_pagamento: "25427-G", tipo_cobranca: "PIX", status: "CANCELADO", valor: "10675.97", vencimento: "2026-11-27", descricao: "Cobrança PIX da proposta #25427", created_at: "2026-11-24 15:17:00.69222+00" }),
  linha({ id: "h", id_pagamento: "25427-H", tipo_cobranca: "PIX", status: "A_RECEBER", valor: "10675.97", vencimento: "2026-11-27", descricao: ENTRADA, created_at: "2026-11-24 16:45:56.17435+00" }),
  linha({ id: "i", id_pagamento: "25427-I", tipo_cobranca: "E-FATURADO", status: "A_VENCER", valor: "10675.96", vencimento: "2026-12-04", descricao: RESTANTE, created_at: "2026-11-24 16:45:56.17435+00", p_qtd_parcelas: 1, p_dias_pra_inicio: 10, p_intervalo: 0 })
];

caso("A. 25427: entrada PIX (H) + boleto (I), pares cancelados ignorados", () => {
  const s = sugestaoPeloFaturadoComEntrada(LINHAS_25427, "2026-11-24");
  assert.ok(s);
  assert.equal(s.idPagamentoEntrada, "25427-H");
  assert.equal(s.idPagamentoRestante, "25427-I");
  assert.equal(s.formaEntrada, "17");
  assert.equal(s.valorEntrada, 10675.97);
  assert.equal(s.dataEntrada, "2026-11-27");
  assert.equal(s.entradaPaga, false);
  assert.equal(s.valorRestante, 10675.96);
  assert.equal(s.qtdParcelas, 1);
  assert.equal(s.vencimentoRestante, "2026-12-04");
  assert.equal(s.diasPraInicio, 10); // 24/11 + 10 = 04/12, a conta do gerador
  assert.ok(s.intervalo >= 1);
  assert.equal(Math.round((s.valorEntrada + s.valorRestante) * 100), 2135193); // total da nota
});

caso("B. sem par ativo: nada", () => {
  assert.equal(sugestaoPeloFaturadoComEntrada(LINHAS_25427.filter((l) => l.id !== "h"), "2026-11-24"), null);
  assert.equal(sugestaoPeloFaturadoComEntrada(LINHAS_25427.filter((l) => l.id !== "i"), "2026-11-24"), null);
  assert.equal(sugestaoPeloFaturadoComEntrada([], "2026-11-24"), null);
});

caso("C. entrada paga: data do pagamento em São Paulo; boleto de entrada vira 15", () => {
  const paga = LINHAS_25427.map((l) => (l.id === "h" ? { ...l, paid_at: "2026-11-25T01:30:00+00:00" } : l));
  const s = sugestaoPeloFaturadoComEntrada(paga, "2026-11-24");
  assert.equal(s?.dataEntrada, "2026-11-24"); // 22h30 de 24/11 em Brasília
  assert.equal(s?.entradaPaga, true);
  assert.equal(formaFiscalDaCobranca("BOLETO"), "15");
  assert.equal(formaFiscalDaCobranca("E-FATURADO"), null);
  assert.equal(rotuloDaFormaFiscal("17"), "PIX");
});

caso("D. vencimento antes da emissão só barra boleto", () => {
  assert.equal(vencimentoBarraConclusao({ forma_pagamento: "15", data_vencimento: "2026-11-20" }, "2026-11-24"), true);
  assert.equal(vencimentoBarraConclusao({ forma_pagamento: "17", data_vencimento: "2026-11-20" }, "2026-11-24"), false);
  assert.equal(vencimentoBarraConclusao({ forma_pagamento: "15", data_vencimento: "2026-12-04T00:00:00" }, "2026-11-24"), false);
  assert.equal(vencimentoBarraConclusao({ forma_pagamento: "15", data_vencimento: null }, "2026-11-24"), false);
});

caso("E. entrada já gerada com forma própria: não repreenche", () => {
  assert.equal(parcelasJaTemEntradaComFormaPropria([{ tipo_registro: "ENTRADA", forma_pagamento: "17" }, { tipo_registro: "PARCELA", forma_pagamento: "15" }]), true);
  assert.equal(parcelasJaTemEntradaComFormaPropria([{ tipo_registro: "ENTRADA", forma_pagamento: "15" }]), false);
  assert.equal(parcelasJaTemEntradaComFormaPropria([{ tipo_registro: "ENTRADA", forma_pagamento: "17", ativo: false }]), false);
  assert.equal(parcelasJaTemEntradaComFormaPropria([{ tipo_registro: "PARCELA", forma_pagamento: "15" }]), false);
});

caso("F. tela e serviço usam as regras", () => {
  const tela = readFileSync("src/features/nfe/components/NfeDetailPage.tsx", "utf8");
  assert.match(tela, /const canEditForma = pagamentos\.length > 1 \|\| pag\.numero_parcela === 1;/);
  assert.match(tela, /vencimentoBarraConclusao\(pg, emissionDateOnly\)/);
  assert.match(tela, /ajustarEntradaDasParcelas\(note\.ref, pgtoFormaEntrada/);
  assert.match(tela, /data-entrada-mais-boleto/);
  assert.match(tela, /lerSugestaoEntradaBoletoDoPedido\(/);
  const servico = readFileSync("src/features/nfe/services/nfe.service.ts", "utf8");
  const trecho = servico.slice(servico.indexOf("export async function ajustarEntradaDasParcelas"));
  assert.match(trecho.slice(0, 1500), /\.eq\("tipo_registro", "ENTRADA"\)/);
  assert.match(trecho.slice(0, 1500), /data\.length !== 1/);
});

console.log(`\n${ok} casos passaram.`);
