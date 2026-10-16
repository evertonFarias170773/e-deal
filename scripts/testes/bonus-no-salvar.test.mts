/**
 * O total do salvar sai dos itens refeitos com o MESMO bonus que o salvar grava (16/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/bonus-no-salvar.test.mts
 *
 * Reproduz o 23873 (copia de cliente com tabela especial de 10%): 500 x 0,16 + 40 fixo = 120 bruto, 108 com o bonus.
 * Simula as gravacoes de valor_total na ordem do salvar — UPDATE do app, gatilho do frete
 * (`recalcular_proposta_v3`, mesma conta do banco) e a consolidacao final do app — e confere que o
 * valor fica estavel. Nada vai ao banco.
 */
import { readFileSync } from "node:fs";
import { calculateResumo, calculateItemSubtotal, itensComOBonusDoSalvar } from "../../src/features/orcamentos/orcamento-utils.ts";
import type { PropostaItem } from "../../src/features/orcamentos/types.ts";

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

type ItemMinimo = Pick<PropostaItem, "quantidade" | "valorUnitario" | "valorFixo" | "variacoesEscolhidas" | "subtotal" | "subtotalBruto" | "acrescimoBonus">;
const item = (quantidade: number, valorUnitario: number, bonusDaCarga: number, valorFixo = 0): ItemMinimo => {
  const t = calculateItemSubtotal({ quantidade, valorUnitario, valorFixo, variacoesEscolhidas: [] }, bonusDaCarga);
  return { quantidade, valorUnitario, valorFixo, variacoesEscolhidas: [], subtotal: t.subtotal, subtotalBruto: t.subtotalBruto, acrescimoBonus: t.acrescimoBonus };
};
const soma = (itens: readonly ItemMinimo[]) => Math.round(itens.reduce((t, i) => t + i.subtotal, 0) * 100) / 100;

// A conta do banco (`recalcular_proposta_v3`, nao avulsa, sem desconto geral): soma bruta dos itens menos o bonus da linha, mais o frete.
const totalDoGatilho = (itens: readonly ItemMinimo[], bonusDaLinha: number, frete: number) => {
  const bruto = itens.reduce((t, i) => t + i.subtotalBruto, 0);
  return Math.round((bruto - (bruto * bonusDaLinha) / 100 + frete) * 100) / 100;
};

/** As gravacoes de valor_total de UM salvar, na ordem do log do 23873, partindo de `inicial`. */
function salvar(inicial: number, totalDoApp: number, bonusGravado: number, itens: readonly ItemMinimo[], frete: number) {
  const gravacoes = [inicial];
  const grava = (v: number) => { if (v !== gravacoes[gravacoes.length - 1]) gravacoes.push(v); };
  grava(totalDoApp); // UPDATE principal do app
  grava(totalDoGatilho(itens, bonusGravado, frete)); // gatilho do frete com a linha TABELA_ESPECIAL ja gravada
  grava(totalDoApp); // consolidacao final do app
  return gravacoes;
}

// ── 1. O caso do 23873: copia sem a linha, cliente com 10% ──
{
  const itensDaCarga = [item(500, 0.16, 0, 40)]; // a copia nao leva a linha: carregou com bonus 0
  const bonusDoSalvar = 10;
  checar("antes da correcao: o salvar somava o bruto (120)", soma(itensDaCarga), 120);
  checar("antes da correcao: o valor oscilava 120 -> 108 -> 120 num salvar", salvar(120, soma(itensDaCarga), bonusDoSalvar, itensDaCarga, 0), [120, 108, 120]);

  const itensDoSalvar = itensComOBonusDoSalvar(itensDaCarga, bonusDoSalvar);
  checar("depois: o salvar soma os itens com o bonus que grava (108)", soma(itensDoSalvar), 108);
  checar("depois: o total do app bate com o do gatilho do banco", soma(itensDoSalvar), totalDoGatilho(itensDoSalvar, bonusDoSalvar, 0));
  checar("depois: partindo de 120 (a copia), um salvar faz UMA mudanca de valor_total e fica em 108", salvar(120, soma(itensDoSalvar), bonusDoSalvar, itensDoSalvar, 0), [120, 108]);
  checar("depois: salvar de novo nao muda nada (estavel)", salvar(108, soma(itensComOBonusDoSalvar(itensDoSalvar, bonusDoSalvar)), bonusDoSalvar, itensDoSalvar, 0), [108]);
  checar("depois: com frete o total tambem bate (108 + 20,12)", [soma(itensDoSalvar) + 20.12, totalDoGatilho(itensDoSalvar, bonusDoSalvar, 20.12)], [128.12, 128.12]);
}

// ── 2. Proposta que ja carregou com a linha: nao aplica o bonus duas vezes ──
{
  const itensDaCarga = [item(500, 0.16, 10, 40), item(100, 1, 10, 5)];
  const depois = itensComOBonusDoSalvar(itensDaCarga, 10);
  checar("ja carregada com 10%: o subtotal nao muda (sem bonus em dobro)", depois.map((i) => i.subtotal), itensDaCarga.map((i) => i.subtotal));
}

// ── 3. Proposta sem tabela especial: nada muda ──
{
  const itensDaCarga = [item(500, 0.16, 0, 40), item(10, 3.5, 0, 2)];
  const depois = itensComOBonusDoSalvar(itensDaCarga, 0);
  checar("sem bonus em lugar nenhum: os itens voltam como vieram (mesmo objeto)", depois.every((i, k) => i === itensDaCarga[k]), true);
  checar("sem bonus: o total e o mesmo de antes", soma(depois), soma(itensDaCarga));
  // Item com subtotal gravado que nao bate com a conta (ex.: arredondamento antigo) segue intocado sem bonus.
  const estranho = { ...item(3, 0.333, 0), subtotal: 1 };
  checar("sem bonus: subtotal gravado fora da conta nao e reescrito", itensComOBonusDoSalvar([estranho], 0)[0].subtotal, 1);
}

// ── 4. Cliente que perdeu o bonus (linha 10% -> vigente 0, proposta aberta) ──
{
  const itensDaCarga = [item(500, 0.16, 10, 40)];
  const depois = itensComOBonusDoSalvar(itensDaCarga, 0);
  checar("bonus foi a 0: o item que carregou com bonus volta ao bruto, e bate com o gatilho sem linha", [soma(depois), totalDoGatilho(depois, 0, 0)], [120, 120]);
}

// ── 5. A soma do resumo usa os itens refeitos ──
{
  const r = calculateResumo(itensComOBonusDoSalvar([item(500, 0.16, 0, 40)], 10) as unknown as PropostaItem[], [], 0, "VALOR");
  checar("calculateResumo com os itens refeitos: subtotal 108 e total 108", [r.subtotalProdutos, r.valorTotal], [108, 108]);
}

// ── 6. Estrutura: o salvar usa os itens refeitos, com o bonus calculado ANTES da soma ──
const servico = readFileSync("src/features/orcamentos/services/orcamentos.service.ts", "utf8").replace(/\r\n/g, "\n");
const iBonus = servico.indexOf("const bonusDaVenda = formState.isAvulso");
const iSoma = servico.indexOf("const activeItens = formState.isAvulso ? activeItensDoFormulario : itensComOBonusDoSalvar(activeItensDoFormulario, bonusDaVenda);");
checar("salvar: o bonus e decidido antes da soma, e a soma usa os itens refeitos", [iBonus > 0, iSoma > iBonus, (servico.match(/const bonusDaVenda = /g) ?? []).length], [true, true, 1]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
