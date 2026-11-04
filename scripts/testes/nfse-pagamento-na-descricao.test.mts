/**
 * NFS-e: condição de pagamento na DESCRIÇÃO e Preparar Cobrança preenchido (04/11/2026,
 * pedido do financeiro, exemplo pedido 24623).
 *
 *   node --experimental-strip-types scripts/testes/nfse-pagamento-na-descricao.test.mts
 *
 * O QUE PROVA
 *   1. A descrição proposta = linhas dos itens + a frase do pagamento, embaixo.
 *      O texto do 24623: "Forma de pagamento: Faturado. 1 parcela. Vencimento: 24/11/2026 (R$ 748,80)."
 *   2. Sem cobrança ativa, a descrição fica só com os itens (nada de linha vazia).
 *   3. A frase cabe no limite da descrição (1000) num pedido de muitos itens comuns.
 *   4. As parcelas do Preparar Cobrança saem da MESMA conta da frase: 24623 dá
 *      1 parcela em 24/11/2026 de R$ 748,80; parcelado em 3 com intervalo dá as
 *      três datas; sem vencimento, com entrada ou cancelada, não preenche (null).
 *   5. O modal da NFS-e não propõe mais a frase nas informações complementares, e
 *      a NF-e de produto não usa este montador.
 */
import { readFileSync } from "node:fs";
import { descricaoComPagamento, parcelasParaLancamento, textoDoPagamentoParaNota, type CobrancaDoPedido } from "../../src/features/nfse/lib/composicao-nfse.ts";
import { LIMITE_DESCRICAO_NFSE, conferirDescricao, descricaoDosItens } from "../../src/features/nfse/lib/regras-emissao.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${ok ? "" : `\n      obtido:   ${JSON.stringify(obtido)}\n      esperado: ${JSON.stringify(esperado)}`}`);
}
const cob = (p: Partial<CobrancaDoPedido>): CobrancaDoPedido => ({
  tipo: "E-FATURADO", forma: "Prazo 21 dias", valor: 748.8, vencimento: "2026-11-24", status: "A_VENCER",
  confirmado: true, parcelas: 1, intervaloDias: 0, valorEntrada: 0, ...p
});

// 1. O 24623
const itens24623 = descricaoDosItens(24623, [
  { nome: "Ingressos MOBI", quantidade: 1520, valorUnitario: 0.23 },
  { nome: "Pulseira ColorBand", quantidade: 1520, valorUnitario: 0.21 }
]);
const desc24623 = descricaoComPagamento(itens24623, [cob({})]);
checar("24623: itens e, embaixo, a condicao de pagamento", desc24623.split("\n"), [
  "Pedido 24623",
  "1.520 x Ingressos MOBI - R$ 0,23 un.",
  "1.520 x Pulseira ColorBand - R$ 0,21 un.",
  "Forma de pagamento: Faturado. 1 parcela. Vencimento: 24/11/2026 (R$ 748,80)."
]);
checar("24623: a frase e a mesma das complementares de antes", desc24623.endsWith(textoDoPagamentoParaNota([cob({})])), true);
checar("24623: a descricao passa na conferencia da rota", conferirDescricao(desc24623).ok, true);

// 2. Sem cobranca ativa
checar("sem cobranca: so os itens", descricaoComPagamento(itens24623, []), itens24623);
checar("so cancelada: so os itens", descricaoComPagamento(itens24623, [cob({ status: "CANCELADO" })]), itens24623);

// 3. Limite
const muitos = descricaoDosItens(1, Array.from({ length: 12 }, (_, i) => ({ nome: `Produto de teste numero ${i + 1}`, quantidade: 1000, valorUnitario: 1.25 })));
const comFrase = descricaoComPagamento(muitos, [cob({ parcelas: 3, intervaloDias: 30, valor: 3000 })]);
checar(`12 itens + parcelado em 3 cabe em ${LIMITE_DESCRICAO_NFSE}`, comFrase.length <= LIMITE_DESCRICAO_NFSE, true);

// 4. Parcelas do Preparar Cobranca
checar("24623: 1 parcela em 24/11/2026 de R$ 748,80", parcelasParaLancamento(cob({})), [{ numero: 1, total: 1, vencimento: "2026-11-24", valor: 748.8 }]);
checar("3 parcelas de 30 em 30 dias, resto na ultima", parcelasParaLancamento(cob({ valor: 100, parcelas: 3, intervaloDias: 30, vencimento: "2026-12-01" })), [
  { numero: 1, total: 3, vencimento: "2026-12-01", valor: 33.33 },
  { numero: 2, total: 3, vencimento: "2026-12-31", valor: 33.33 },
  { numero: 3, total: 3, vencimento: "2027-01-30", valor: 33.34 }
]);
checar("sem vencimento: nao preenche", parcelasParaLancamento(cob({ vencimento: null })), null);
checar("parcelado sem intervalo: nao preenche", parcelasParaLancamento(cob({ parcelas: 2, intervaloDias: null })), null);
checar("com entrada: nao preenche", parcelasParaLancamento(cob({ valorEntrada: 100 })), null);
checar("cancelada: nao preenche", parcelasParaLancamento(cob({ status: "CANCELADO" })), null);

// 5. Quem usa o montador
const modal = readFileSync("src/features/nfse/components/GerarNfseModal.tsx", "utf8");
checar("modal: complementares nascem vazias", /setInfComp\(""\)/.test(modal) && !/setInfComp\(textoDoPagamentoParaNota/.test(modal), true);
checar("modal: as tres portas da descricao levam o pagamento", (modal.match(/descricaoComPagamento\(descricaoDosItens\(/g) ?? []).length, 3);
const nfe = ["src/features/nfe/components/NfeDetailPage.tsx", "src/features/nfe/services/nfe.service.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
checar("NF-e de produto nao usa o montador da NFS-e", /composicao-nfse|descricaoComPagamento|textoDoPagamentoParaNota/.test(nfe), false);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
