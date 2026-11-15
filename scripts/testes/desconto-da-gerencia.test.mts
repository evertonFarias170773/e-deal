/**
 * Desconto concedido pela gerência (15/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/desconto-da-gerencia.test.mts
 *
 * Quem não tem a permissão de desconto geral salva o que não afeta o valor;
 * desconto, itens, quantidades, preços e frete têm de ficar iguais ao gravado.
 */
import { readFileSync } from "node:fs";
import {
  MENSAGEM_DESCONTO_DA_GERENCIA,
  assinaturaDeValor,
  conferirDescontoDaGerencia,
  temDescontoGeral,
  type FormularioDeValor,
  type ResumoDeValor
} from "../../src/features/orcamentos/lib/desconto-da-gerencia.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok     " : "FALHOU "} ${nome}${ok ? "" : `\n        obtido:   ${JSON.stringify(obtido)}\n        esperado: ${JSON.stringify(esperado)}`}`);
}

const form: FormularioDeValor = {
  isAvulso: false,
  descontoGeralTipo: "PERCENTUAL",
  descontoGeralValor: "10",
  itens: [{ id: "a", id_produto: 7, quantidade: 1000, valorUnitario: 0.5, valorFixo: 20, variacoesEscolhidas: [{ id_variacao: 3 }] }],
  deletedProdutoPropostaIds: [],
  freteEscolhidoId: "f1",
  modalidadeFrete: "CIF",
  valorProdutosManual: "",
  valorFreteManual: ""
};
const resumo: ResumoDeValor = { subtotalProdutos: 520, descontoGeral: 52, frete: 30, valorTotal: 498 };
const base = assinaturaDeValor(form, resumo);
const conferir = (podeEditarDesconto: boolean, f: FormularioDeValor, r: ResumoDeValor, comBase = true) =>
  conferirDescontoDaGerencia({
    podeEditarDesconto,
    base: comBase ? base : null,
    descontoNaBase: temDescontoGeral(form.descontoGeralValor),
    atual: assinaturaDeValor(f, r),
    descontoAtual: temDescontoGeral(f.descontoGeralValor)
  });

checar("vendedor sem mudança de valor (só observação) salva", conferir(false, { ...form }, { ...resumo }), "livre");
checar("vendedor muda quantidade: recusa", conferir(false, { ...form, itens: [{ ...form.itens[0], quantidade: 2000 }] }, { ...resumo, subtotalProdutos: 1020, descontoGeral: 102, valorTotal: 948 }), "valor_mudou");
checar("vendedor muda o desconto: recusa", conferir(false, { ...form, descontoGeralValor: "15" }, { ...resumo, descontoGeral: 78, valorTotal: 472 }), "valor_mudou");
checar("vendedor tira o desconto: recusa", conferir(false, { ...form, descontoGeralValor: "0" }, { ...resumo, descontoGeral: 0, valorTotal: 550 }), "valor_mudou");
checar("vendedor troca o frete: recusa", conferir(false, { ...form, freteEscolhidoId: "f2" }, { ...resumo, frete: 45, valorTotal: 513 }), "valor_mudou");
checar("vendedor troca a modalidade: recusa", conferir(false, { ...form, modalidadeFrete: "FOB" }, { ...resumo, frete: 0, valorTotal: 468 }), "valor_mudou");
checar("vendedor remove item: recusa", conferir(false, { ...form, deletedProdutoPropostaIds: [11] }, resumo), "valor_mudou");
checar("vendedor troca variação: recusa", conferir(false, { ...form, itens: [{ ...form.itens[0], variacoesEscolhidas: [{ id_variacao: 4 }] }] }, resumo), "valor_mudou");
checar("preço reaplicado muda o total: recusa", conferir(false, form, { ...resumo, valorTotal: 499 }), "valor_mudou");
checar("gerente muda quantidade e desconto: salva", conferir(true, { ...form, descontoGeralValor: "15", itens: [{ ...form.itens[0], quantidade: 2000 }] }, resumo), "livre");
checar("proposta sem desconto: vendedor muda quantidade livre", conferirDescontoDaGerencia({ podeEditarDesconto: false, base, descontoNaBase: false, atual: assinaturaDeValor({ ...form, descontoGeralValor: "0", itens: [{ ...form.itens[0], quantidade: 5 }] }, resumo), descontoAtual: false }), "livre");
checar("proposta nova com desconto digitado sem permissão", conferir(false, form, resumo, false), "sem_permissao");
checar("proposta nova sem desconto", conferir(false, { ...form, descontoGeralValor: "0" }, resumo, false), "livre");
checar("mesma ordem de itens não importa", assinaturaDeValor({ ...form, itens: [...form.itens].reverse() }, resumo).itens, base.itens);
checar("mensagem", MENSAGEM_DESCONTO_DA_GERENCIA, "Esta proposta tem desconto concedido pela gerência. Para alterar itens, quantidades, preços ou frete, peça ao gerente.");

const pagina = readFileSync("src/features/orcamentos/OrcamentoFormPage.tsx", "utf8");
checar("tela não recusa mais só por ter desconto", pagina.includes("!canEditarDescontoGeral && Number(form.descontoGeralValor) > 0"), false);
checar("tela usa a conferência e a mensagem", [pagina.includes("conferirDescontoDaGerencia({"), pagina.includes("description: MENSAGEM_DESCONTO_DA_GERENCIA")], [true, true]);
checar("campos do desconto seguem travados para quem não pode", (pagina.match(/disabled=\{!canEditarDescontoGeral\}/g) ?? []).length, 2);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
