/**
 * Testes das regras de edição de proposta com faturado a vencer.
 *
 * O projeto não tem runner de testes; este arquivo roda sozinho pelo Node,
 * que remove os tipos na hora (o módulo testado não importa nada, então não
 * precisa de bundler):
 *
 *   node --experimental-strip-types scripts/testes/faturado-editavel.test.mts
 *
 * Sai com código 1 se algo falhar. Rode depois de mexer em
 * src/features/orcamentos/services/faturado-editavel.ts — é dinheiro.
 */
import {
  avaliarEdicaoFaturado,
  avaliarElegibilidadeFaturado,
  isFaturadoAjustavel,
  isTituloQuitado,
  tituloExigeCancelamentoBancario
} from "../../src/features/orcamentos/services/faturado-editavel.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

const fat = (over: Record<string, unknown> = {}) => ({
  id: "F1", id_pagamento: "100-B", tipo_cobranca: "E-FATURADO",
  status: "A_VENCER", paid_at: null, valor: 1000, ...over
});
const pix = (over: Record<string, unknown> = {}) => ({
  id: "P1", id_pagamento: "100-A", tipo_cobranca: "PIX",
  status: "PAID", paid_at: "2026-08-01T10:00:00Z", valor: 300, ...over
});
const titulo = (over: Record<string, unknown> = {}) => ({
  id: "T1", id_pagamento: "100-B", parcela: 1, total_parcelas: 1, valor: 1000,
  vencimento: "2026-09-10", status: "A_VENCER", paid_at: null,
  deposito_conta: false, id_boleto_c6: null, id_empresa: 2, ...over
});

// — Identificação —
checar("faturado a vencer e ajustavel", isFaturadoAjustavel(fat()), true);
checar("E-Faturado minusculo tambem", isFaturadoAjustavel(fat({ tipo_cobranca: "E-Faturado" })), true);
checar("E_FATURADO com underline tambem", isFaturadoAjustavel(fat({ tipo_cobranca: "E_FATURADO" })), true);
checar("faturado com paid_at nao e ajustavel", isFaturadoAjustavel(fat({ paid_at: "2026-08-01" })), false);
checar("faturado PAID nao e ajustavel", isFaturadoAjustavel(fat({ status: "PAID" })), false);
checar("PIX nao e faturado", isFaturadoAjustavel(pix()), false);
checar("confirmado nao importa", isFaturadoAjustavel(fat({ confirmado: false } as never)), true);

// — Título —
checar("titulo PAID esta quitado", isTituloQuitado(titulo({ status: "PAID" })), true);
checar("titulo com paid_at esta quitado", isTituloQuitado(titulo({ paid_at: "2026-08-02" })), true);
checar("titulo a vencer nao esta quitado", isTituloQuitado(titulo()), false);
checar("boleto registrado exige banco", tituloExigeCancelamentoBancario(titulo({ id_boleto_c6: "ABC" })), true);
checar("deposito nunca exige banco", tituloExigeCancelamentoBancario(titulo({ deposito_conta: true, id_boleto_c6: "ABC" })), false);
checar("boleto sem codigo nao exige banco", tituloExigeCancelamentoBancario(titulo()), false);

// — Caso simples: só faturado, sem título —
const so = avaliarEdicaoFaturado({ cobrancas: [fat()], titulos: [], novoTotal: 1200 });
checar("so faturado: elegivel", so.elegivel, true);
checar("so faturado: novo valor = novo total", so.elegivel && so.novoValorFaturado, 1200);
checar("so faturado: nada a excluir", so.elegivel && so.titulosParaExcluir.length, 0);

// — Título antigo sem id_pagamento, proposta com uma cobrança só —
const antigo = avaliarEdicaoFaturado({
  cobrancas: [fat()], titulos: [titulo({ id_pagamento: null })], novoTotal: 900
});
checar("uma cobranca: titulo sem vinculo entra na lista", antigo.elegivel && antigo.titulosParaExcluir.length, 1);

// — Título cancelado não conta —
const cancelado = avaliarEdicaoFaturado({
  cobrancas: [fat()], titulos: [titulo({ status: "CANCELADO" })], novoTotal: 900
});
checar("titulo cancelado nao entra na lista", cancelado.elegivel && cancelado.titulosParaExcluir.length, 0);

// — Título quitado bloqueia —
const quitado = avaliarEdicaoFaturado({
  cobrancas: [fat()], titulos: [titulo({ status: "PAID", paid_at: "2026-08-02" })], novoTotal: 900
});
checar("titulo quitado bloqueia", quitado.elegivel === false && quitado.motivo, "TITULO_QUITADO");

// — Mista: PIX pago 300 + faturado. Novo total 800 → faturado vira 500 —
const mista = avaliarEdicaoFaturado({
  cobrancas: [fat(), pix()], titulos: [titulo()], novoTotal: 800
});
checar("mista: elegivel", mista.elegivel, true);
checar("mista: faturado absorve a diferenca", mista.elegivel && mista.novoValorFaturado, 500);
checar("mista: outras cobrancas preservadas", mista.elegivel && mista.valorOutrasCobrancas, 300);
checar("mista: so o titulo do faturado sai", mista.elegivel && mista.titulosParaExcluir.map((t) => t.id), ["T1"]);

// — Mista: título de outra cobrança não pode ser tocado —
const doPix = avaliarEdicaoFaturado({
  cobrancas: [fat(), pix()], titulos: [titulo({ id: "T2", id_pagamento: "100-A" })], novoTotal: 800
});
checar("mista: titulo de outra cobranca fica de fora", doPix.elegivel && doPix.titulosParaExcluir.length, 0);

// — Mista com título órfão: ambíguo, bloqueia —
const orfao = avaliarEdicaoFaturado({
  cobrancas: [fat(), pix()], titulos: [titulo({ id_pagamento: null })], novoTotal: 800
});
checar("mista: titulo sem vinculo bloqueia", orfao.elegivel === false && orfao.motivo, "TITULO_AMBIGUO");

// — Novo total não cobre o que já foi pago —
const naoCabe = avaliarEdicaoFaturado({ cobrancas: [fat(), pix()], titulos: [], novoTotal: 250 });
checar("novo total abaixo do pago bloqueia", naoCabe.elegivel === false && naoCabe.motivo, "VALOR_NAO_CABE");

// — Total exatamente igual às outras cobranças: faturado zeraria —
const zera = avaliarEdicaoFaturado({ cobrancas: [fat(), pix()], titulos: [], novoTotal: 300 });
checar("faturado zerado bloqueia", zera.elegivel === false && zera.motivo, "VALOR_NAO_CABE");

// — Sem faturado —
const semFat = avaliarEdicaoFaturado({ cobrancas: [pix()], titulos: [], novoTotal: 500 });
checar("sem faturado", semFat.elegivel === false && semFat.motivo, "SEM_FATURADO");

// — Faturado já liquidado —
const liquidado = avaliarEdicaoFaturado({
  cobrancas: [fat({ paid_at: "2026-08-05" })], titulos: [], novoTotal: 500
});
checar("faturado liquidado", liquidado.elegivel === false && liquidado.motivo, "FATURADO_LIQUIDADO");

// — Dois faturados —
const dois = avaliarEdicaoFaturado({
  cobrancas: [fat(), fat({ id: "F2", id_pagamento: "100-C" })], titulos: [], novoTotal: 500
});
checar("dois faturados", dois.elegivel === false && dois.motivo, "MAIS_DE_UM_FATURADO");

// — Cobrança cancelada é ignorada por completo —
const comCancelada = avaliarEdicaoFaturado({
  cobrancas: [fat(), pix({ id: "P9", status: "CANCELADO", valor: 9999 })], titulos: [], novoTotal: 700
});
checar("cobranca cancelada nao entra na conta", comCancelada.elegivel && comCancelada.novoValorFaturado, 700);

// — Centavos —
const centavos = avaliarEdicaoFaturado({
  cobrancas: [fat(), pix({ valor: 140.44 })], titulos: [], novoTotal: 280.89
});
checar("centavos batem", centavos.elegivel && centavos.novoValorFaturado, 140.45);

// — Elegibilidade estrutural NÃO depende do total —
// É o que destrava o formulário na tela: se dependesse do valor digitado,
// baixar o total abaixo do já pago congelaria a edição no meio.
const estrutural = avaliarElegibilidadeFaturado({ cobrancas: [fat(), pix()], titulos: [] });
checar("estrutural: elegivel mesmo sem total", estrutural.elegivel, true);
checar("estrutural: soma das outras cobrancas", estrutural.elegivel && estrutural.valorOutrasCobrancas, 300);
checar(
  "estrutural segue elegivel onde o valor nao caberia",
  avaliarElegibilidadeFaturado({ cobrancas: [fat(), pix()], titulos: [] }).elegivel === true &&
    avaliarEdicaoFaturado({ cobrancas: [fat(), pix()], titulos: [], novoTotal: 250 }).elegivel === false,
  true
);
checar(
  "estrutural barra o que e bloqueio de verdade",
  (() => {
    const r = avaliarElegibilidadeFaturado({
      cobrancas: [fat()],
      titulos: [titulo({ status: "PAID" })]
    });
    return r.elegivel === false && r.motivo;
  })(),
  "TITULO_QUITADO"
);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
