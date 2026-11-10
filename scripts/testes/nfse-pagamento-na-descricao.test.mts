/**
 * NFS-e: a DESCRIÇÃO termina nos itens (e no frete) e o Preparar Cobrança vem
 * preenchido. Em 04/11/2026 a frase do pagamento e a linha da natureza entraram
 * no fim da descrição; em 05/11/2026 o financeiro decidiu tirar as duas.
 *
 *   node --experimental-strip-types scripts/testes/nfse-pagamento-na-descricao.test.mts
 *
 * O QUE PROVA
 *   1. A descrição proposta do 24623 = linhas dos itens, e acaba no último item:
 *      sem "Forma de pagamento", sem "Vencimento", sem "Natureza da operação".
 *   2. Ter ou não cobrança ativa não muda a descrição (o montador nem a recebe).
 *   3. A descrição de muitos itens comuns cabe no limite (1000).
 *   4. As parcelas do Preparar Cobrança: 24623 dá 1 parcela em 24/11/2026 de
 *      R$ 748,80; parcelado em 3 com intervalo dá as três datas; sem vencimento,
 *      com entrada ou cancelada, não preenche (null).
 *   5. O modal da NFS-e não propõe a frase nas informações complementares nem na
 *      descrição, e a NF-e de produto não usa este montador.
 */
import { readFileSync } from "node:fs";
import { descricaoDaNfse, parcelasParaLancamento, type CobrancaDoPedido } from "../../src/features/nfse/lib/composicao-nfse.ts";
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
const desc24623 = descricaoDaNfse(itens24623);
checar("24623: so os itens, acabando no ultimo", desc24623.split("\n"), [
  "Pedido 24623",
  "1.520 x Ingressos MOBI - R$ 0,23 un. - Subtotal R$ 349,60",
  "1.520 x Pulseira ColorBand - R$ 0,21 un. - Subtotal R$ 319,20"
]);
checar("24623: sem frase de pagamento nem natureza", /Forma de pagamento|Vencimento|Natureza da opera/.test(desc24623), false);
checar("24623: a descricao passa na conferencia da rota", conferirDescricao(desc24623).ok, true);

// 2. O montador nao recebe cobranca: a descricao e a mesma com ou sem pagamento
checar("montador: dois parametros (itens e frete), sem cobrancas", descricaoDaNfse.length <= 2, true);
checar("sem frete: igual aos itens", descricaoDaNfse(itens24623, 0), itens24623);

// 3. Limite
const muitos = descricaoDosItens(1, Array.from({ length: 12 }, (_, i) => ({ nome: `Produto de teste numero ${i + 1}`, quantidade: 1000, valorUnitario: 1.25 })));
checar(`12 itens + frete cabem em ${LIMITE_DESCRICAO_NFSE}`, descricaoDaNfse(muitos, 30).length <= LIMITE_DESCRICAO_NFSE, true);

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
checar("modal: as tres portas da descricao usam descricaoDaNfse", (modal.match(/descricaoDaNfse\(\s*descricaoDosItens\(/g) ?? []).length, 3);
checar("modal: nada de pagamento nem natureza na descricao", /descricaoComPagamento|LINHA_NATUREZA_NFSE|textoDoPagamentoParaNota/.test(modal), false);
const nfe = ["src/features/nfe/components/NfeDetailPage.tsx", "src/features/nfe/services/nfe.service.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
checar("NF-e de produto nao usa o montador da NFS-e", /composicao-nfse|descricaoDaNfse|textoDoPagamentoParaNota/.test(nfe), false);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
