/**
 * Descrição sugerida da NFS-e com o desconto do pedido (16/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/nfse-descricao-desconto.test.mts
 *
 * A nota 138 (pedido 23733) saiu com "1 x * Horas Tratam de Imagem - Valor Unit
 * R$ 190,00 - R$ 100,00 un." numa nota de R$ 90,00: o desconto de tabela
 * especial (10%) não aparecia e o nome trazia o preço de tabela do cadastro.
 *
 * O QUE PROVA
 *   1. O "Valor Unit R$ …" do nome do cadastro sai, nas grafias que existem no banco.
 *   2. O caso da nota 138: item, desconto de tabela especial e total.
 *   3. O total é o MESMO do valor sugerido da janela (mesmo fator).
 *   4. Sem desconto: o texto simples de sempre.
 *   5. Outro desconto além da tabela, ou percentual que não bate: "Desconto (x%)".
 *   6. Sem como derivar (item sem subtotal, fator fora de 0..1): texto simples.
 */
import { descricaoDosItens, nomeSemValorUnitDoCadastro } from "../../src/features/nfse/lib/regras-emissao.ts";
import { fatorDoDesconto, valorSugeridoDaNota } from "../../src/features/nfse/lib/composicao-nfse.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

// ── 1. Nome sem o "Valor Unit" ───────────────────────────────────────────────
checar("grafias do banco",
  [
    "* Horas Tratam de Imagem - Valor Unit R$ 190,00",
    "*Pag. c/Fecham Arq e  03 Provas - Valor Unit R$ 440,00",
    "* Fotos c/semi produção -Valor Unit R$ 145,00",
    "* Fotos p/Anúncios - Valor Unit R$15,50",
    "Ingresso MOBI"
  ].map(nomeSemValorUnitDoCadastro),
  ["* Horas Tratam de Imagem", "*Pag. c/Fecham Arq e 03 Provas", "* Fotos c/semi produção", "* Fotos p/Anúncios", "Ingresso MOBI"]);

// ── 2. O caso da nota 138 ────────────────────────────────────────────────────
const item138 = { id: 3759, nome: "* Horas Tratam de Imagem - Valor Unit R$ 190,00", quantidade: 1, valorUnitario: 100, subtotal: 100 };
const fator138 = fatorDoDesconto(90, 100);
checar("nota 138",
  descricaoDosItens(23733, [item138], { fator: fator138, percentualTabelaEspecial: 10, temOutroDesconto: false }),
  "Pedido 23733\n1 x * Horas Tratam de Imagem - R$ 100,00\nDesconto tabela especial (10%): - R$ 10,00\nTotal: R$ 90,00");

// ── 3. Total = valor sugerido ────────────────────────────────────────────────
const itens = [
  { id: 1, nome: "Serviço A", quantidade: 3, valorUnitario: 33.33, subtotal: 99.99 },
  { id: 2, nome: "Serviço B", quantidade: 1, valorUnitario: 57.17, subtotal: 57.17 }
];
const fator = fatorDoDesconto(141.44, 157.16);
const texto = descricaoDosItens(1, itens, { fator, percentualTabelaEspecial: 10, temOutroDesconto: false });
const sugerido = valorSugeridoDaNota(itens, new Set([1, 2]), 141.44);
checar("o total do texto e o valor sugerido da janela",
  texto.endsWith(`Total: R$ ${sugerido.toFixed(2).replace(".", ",")}`), true);
checar("bruto - desconto = total, em centavos", texto.includes("- R$ 15,72"), true);

// ── 4. Sem desconto ──────────────────────────────────────────────────────────
checar("sem desconto: texto simples, sem o Valor Unit",
  descricaoDosItens(23733, [item138], { fator: 1, percentualTabelaEspecial: null, temOutroDesconto: false }),
  "Pedido 23733\n1 x * Horas Tratam de Imagem - R$ 100,00 un.");
checar("sem informacao de desconto: igual", descricaoDosItens(23733, [item138]), "Pedido 23733\n1 x * Horas Tratam de Imagem - R$ 100,00 un.");

// ── 5. Rotulo generico ───────────────────────────────────────────────────────
checar("tabela especial mais outro desconto: rotulo generico",
  descricaoDosItens(5, [item138], { fator: 0.85, percentualTabelaEspecial: 10, temOutroDesconto: true }).split("\n")[2],
  "Desconto (15%): - R$ 15,00");
checar("percentual que nao bate com a tabela: rotulo generico",
  descricaoDosItens(5, [item138], { fator: 0.8, percentualTabelaEspecial: 10, temOutroDesconto: false }).split("\n")[2],
  "Desconto (20%): - R$ 20,00");
checar("desconto sem tabela especial: rotulo generico",
  descricaoDosItens(5, [item138], { fator: 0.95, percentualTabelaEspecial: null, temOutroDesconto: true }).split("\n")[2],
  "Desconto (5%): - R$ 5,00");

// ── 6. Sem como derivar ──────────────────────────────────────────────────────
checar("item sem subtotal: texto simples",
  descricaoDosItens(5, [{ ...item138, subtotal: null }], { fator: 0.9, percentualTabelaEspecial: 10, temOutroDesconto: false }),
  "Pedido 5\n1 x * Horas Tratam de Imagem - R$ 100,00 un.");
checar("fator fora de 0..1: texto simples",
  [1.2, 0, Number.NaN].map((f) => descricaoDosItens(5, [item138], { fator: f, percentualTabelaEspecial: 10, temOutroDesconto: false }).includes("Desconto")),
  [false, false, false]);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
