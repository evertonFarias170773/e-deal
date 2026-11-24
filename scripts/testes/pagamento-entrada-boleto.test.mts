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
  descreverParcelas,
  diferencasDoFaturadoComEntrada,
  formaDaNotaPelasParcelas,
  formaDoGeradorPelasParcelas,
  formaFiscalDaCobranca,
  parcelasJaTemEntradaComFormaPropria,
  resumoPagamentoDoPayload,
  rotuloDaFormaFiscal,
  salvarMudouAsParcelas,
  salvarRecriaParcelaAVista,
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

// ---------------------------------------------------------------------------
// Proteção das parcelas (NF 41686 / NFE-25427-001, 24/11/2026)
// ---------------------------------------------------------------------------
// As parcelas reais da 001 depois do Gerar (18:52) e o que o Salvar deixou (19:25).
const MISTA = [
  { numero_parcela: 1, tipo_registro: "ENTRADA", forma_pagamento: "17", valor: "10675.97", ativo: true },
  { numero_parcela: 2, tipo_registro: "PARCELA", forma_pagamento: "15", valor: "10675.96", ativo: true }
];
const UM_PIX = [{ numero_parcela: 1, tipo_registro: "PARCELA", forma_pagamento: "17", valor: "21351.93", ativo: true }];
const FATURADO_25427 = { formaEntrada: "17", valorEntrada: 10675.97, valorRestante: 10675.96 };

caso("G. (a) select do gerador nunca herda a forma da entrada", () => {
  assert.equal(formaDoGeradorPelasParcelas(MISTA, "15"), "15"); // era "17" (dbPayments[0])
  assert.equal(formaDoGeradorPelasParcelas([MISTA[1], MISTA[0]], null), "15");
  assert.equal(formaDoGeradorPelasParcelas(UM_PIX, "15"), "17"); // à vista comum: igual a antes
  assert.equal(formaDoGeradorPelasParcelas([MISTA[0]], "15"), "15"); // só entrada: forma da nota
  assert.equal(formaDoGeradorPelasParcelas([], "03"), "03");
  assert.equal(formaDoGeradorPelasParcelas([{ ...MISTA[1], ativo: false }, MISTA[0]], "15"), "15");
});

caso("H. (b) Salvar só recria à vista com uma parcela (ou nenhuma)", () => {
  // O cenário da 41686: select em PIX e duas parcelas → NÃO recria.
  assert.equal(salvarRecriaParcelaAVista(2, "17"), false);
  assert.equal(salvarRecriaParcelaAVista(3, "03"), false);
  // À vista comum, igual a hoje.
  assert.equal(salvarRecriaParcelaAVista(1, "17"), true);
  assert.equal(salvarRecriaParcelaAVista(0, "17"), true);
  // Boleto nunca.
  assert.equal(salvarRecriaParcelaAVista(1, "15"), false);
  assert.equal(salvarRecriaParcelaAVista(2, "15"), false);
});

caso("I. (c) Salvar mudou o conjunto: a 41686 pararia aqui", () => {
  assert.equal(salvarMudouAsParcelas(MISTA, UM_PIX), true);
  assert.equal(salvarMudouAsParcelas(MISTA, MISTA.map((p) => ({ ...p, valor: "1" }))), false); // valor não conta
  assert.equal(salvarMudouAsParcelas(UM_PIX, [{ ...UM_PIX[0], valor: "999" }]), false); // à vista recriada com total novo
  assert.equal(salvarMudouAsParcelas(MISTA, [MISTA[0], { ...MISTA[1], forma_pagamento: "17" }]), true);
  assert.equal(salvarMudouAsParcelas(MISTA, []), true);
  assert.match(descreverParcelas(MISTA), /1: PIX R\$\s?10\.675,97 · 2: Boleto bancário R\$\s?10\.675,96/);
});

caso("J. (c) conferência com o Faturado com entrada", () => {
  assert.deepEqual(diferencasDoFaturadoComEntrada(MISTA, FATURADO_25427), []);
  const da41686 = diferencasDoFaturadoComEntrada(UM_PIX, FATURADO_25427);
  assert.ok(da41686.some((d) => /Falta a parcela de entrada/.test(d)));
  assert.ok(da41686.some((d) => /parcela 1 está em PIX; o restante do pedido é em boleto/.test(d)));
  assert.ok(da41686.some((d) => /restante soma R\$\s?21\.351,93/.test(d)));
  const entradaBoleto = diferencasDoFaturadoComEntrada([{ ...MISTA[0], forma_pagamento: "15" }, MISTA[1]], FATURADO_25427);
  assert.deepEqual(entradaBoleto, ["A entrada está em Boleto bancário; no pedido ela é PIX."]);
  // Restante em dois boletos somando certo: bate.
  assert.deepEqual(
    diferencasDoFaturadoComEntrada(
      [MISTA[0], { ...MISTA[1], valor: "5000.00" }, { ...MISTA[1], numero_parcela: 3, valor: "5675.96" }],
      FATURADO_25427
    ),
    []
  );
  assert.ok(diferencasDoFaturadoComEntrada([MISTA[0]], FATURADO_25427).some((d) => /Falta o boleto do restante/.test(d)));
});

caso("K. (e) forma do cabeçalho acompanha as parcelas", () => {
  assert.equal(formaDaNotaPelasParcelas(MISTA), "15");
  assert.equal(formaDaNotaPelasParcelas(UM_PIX), "17"); // a 41686 dizia 15
  assert.equal(formaDaNotaPelasParcelas([MISTA[1]]), "15");
  assert.equal(formaDaNotaPelasParcelas([{ ...MISTA[0], forma_pagamento: "03" }, { ...MISTA[1], forma_pagamento: "17" }]), "17");
  assert.equal(formaDaNotaPelasParcelas([]), null);
});

caso("L. (d) resumo do payload: mista, a 41686 e boleto comum", () => {
  const mista = resumoPagamentoDoPayload({
    valor_total: "21351.93",
    formas_pagamento: [
      { forma_pagamento: "15", valor_pagamento: "10675.96", indicador_pagamento: "1" },
      { forma_pagamento: "17", valor_pagamento: "10675.97", indicador_pagamento: "0" }
    ],
    duplicatas: [{ numero: "001", data_vencimento: "2026-12-04", valor: "10675.96" }],
    valor_original_fatura: "10675.96",
    valor_desconto_fatura: "0.00",
    valor_liquido_fatura: "10675.96"
  });
  assert.deepEqual(mista?.formas.map((f) => `${f.rotulo}|${f.prazo}|${f.valor}`), ["Boleto bancário|a prazo|10675.96", "PIX|à vista|10675.97"]);
  assert.deepEqual(mista?.duplicatas, [{ numero: "001", vencimento: "2026-12-04", valor: 10675.96 }]);
  assert.deepEqual(mista?.fatura, { original: 10675.96, desconto: 0, liquido: 10675.96 });
  // O payload real da 41686.
  const pix = resumoPagamentoDoPayload({ valor_total: "21351.93", formas_pagamento: [{ forma_pagamento: "17", valor_pagamento: "21351.93" }], duplicatas: [] });
  assert.deepEqual(pix?.formas.map((f) => `${f.rotulo}|${f.prazo}`), ["PIX|à vista"]);
  assert.equal(pix?.duplicatas.length, 0);
  assert.equal(pix?.fatura, null);
  // Boleto comum (sem indicador): a prazo.
  const boleto = resumoPagamentoDoPayload({ formas_pagamento: [{ forma_pagamento: "15", valor_pagamento: "100" }], duplicatas: [{ numero: null, data_vencimento: "2026-12-10", valor: "100" }] });
  assert.equal(boleto?.formas[0].prazo, "a prazo");
  assert.equal(resumoPagamentoDoPayload(null), null);
});

caso("M. a tela e o modal usam as regras", () => {
  const tela = readFileSync("src/features/nfe/components/NfeDetailPage.tsx", "utf8");
  assert.match(tela, /formaDoGeradorPelasParcelas\(dbPayments, dbNote\.forma_pgto\)/);
  assert.doesNotMatch(tela, /setPgtoFormaPagamento\(dbPayments\[0\]/);
  assert.doesNotMatch(tela, /pgtoFormaPagamento !== "15"/);
  assert.equal((tela.match(/salvarRecriaParcelaAVista\(pagamentos\.length, pgtoFormaPagamento\)/g) ?? []).length, 6);
  assert.match(tela, /salvarMudouAsParcelas\(parcelasNaTela, parcelasNoBanco\)/);
  assert.match(tela, /diferencasDoFaturadoComEntrada\(parcelasNoBanco, faturadoComEntrada\)/);
  assert.ok((tela.match(/sincronizarFormaDaNota\(note\.id\)/g) ?? []).length >= 2);
  const modal = readFileSync("src/features/fiscal/components/EmissaoNfeModal.tsx", "utf8");
  assert.match(modal, /resumoPagamentoDoPayload\(nota\.payload_envio\)/);
  assert.match(modal, /data-resumo-pagamento-emissao/);
});

console.log(`\n${ok} casos passaram.`);
