/**
 * Total da proposta em CENTAVOS EXATOS — a mesma regra do banco.
 *
 * POR QUE EXISTE (06/11/2026, pedido 24606)
 *   A tela somava os itens em ponto flutuante: 1.006,95 − 100,695 dava
 *   906,2549999…, e o arredondamento mostrava R$ 906,25. O banco faz a conta em
 *   decimal exato (906,255) e arredonda para R$ 906,26 — é o que a trava do
 *   despacho (`exp_saldo_despacho`) e a Conta Corrente
 *   (`cc__total_soberano_proposta`) usam. No meio centavo exato a tela
 *   arredondava ora para cima (22302: 541,58; 22114: 1.863,08), ora para baixo
 *   (24606), conforme o ruído da conta. Aqui a conta é feita em inteiros.
 *
 * A REGRA (a de `cc__total_soberano_proposta`):
 *   1. cada item: qtd × (valor unitário + variações) + fixo, arredondado ao
 *      centavo (meio centavo para cima) — como `produtos_proposta.valor_sub_total`;
 *   2. soma dos itens ativos = subtotal bruto;
 *   3. bônus da tabela especial sai da soma, sem arredondar;
 *   4. desconto geral (percentual sobre o resultado, ou valor), limitado a ele;
 *   5. + frete; o TOTAL é arredondado ao centavo, meio centavo para cima.
 *
 * O resumo fecha: bônus mostrado = bruto − subtotal; desconto mostrado =
 * subtotal + frete − total.
 *
 * NÃO é usada pelo salvar: o `valor_total` gravado continua saindo da conta de
 * sempre (`calculateResumo` no `saveProposta`). Esta função só decide o que a
 * tela mostra e compara.
 */
import type { PropostaItem, PropostaResumo } from "@/features/orcamentos/types";

/**
 * Valor decimal escalado para inteiro: `escalar(906.255, 3)` = 906255n.
 * Lê o número pela representação decimal mais curta (a que veio do banco ou
 * foi digitada), e arredonda meio para cima o que passar da escala.
 */
export function escalar(valor: number | string | null | undefined, casas: number): bigint {
  let texto = typeof valor === "string" ? valor.trim() : Number.isFinite(Number(valor)) ? String(Number(valor)) : "0";
  if (!texto) return BigInt(0);
  if (/e/i.test(texto)) texto = Number(texto).toFixed(20);
  const negativo = texto.startsWith("-");
  if (negativo || texto.startsWith("+")) texto = texto.slice(1);
  const [inteira = "0", fracao = ""] = texto.split(".");
  const cabe = fracao.slice(0, casas).padEnd(casas, "0");
  const resto = fracao.slice(casas);
  let n = BigInt((inteira.replace(/\D/g, "") || "0") + cabe);
  if (resto && Number(resto[0]) >= 5) n += BigInt(1);
  return negativo ? -n : n;
}

const DEZ = BigInt(10);
function potencia(n: number): bigint {
  let r = BigInt(1);
  for (let i = 0; i < n; i++) r *= DEZ;
  return r;
}

/** Divide e arredonda meio para cima (valores não negativos). */
function dividirArredondando(n: bigint, d: bigint): bigint {
  if (n <= BigInt(0)) return BigInt(0);
  return (n + d / BigInt(2)) / d;
}

/** Centavos de um valor decimal, meio centavo para cima: 906.255 -> 90626. */
export function centavosDoValor(valor: number | string | null | undefined): number {
  const n = escalar(valor, 3);
  const negativo = n < BigInt(0);
  const c = dividirArredondando(negativo ? -n : n, DEZ);
  return Number(negativo ? -c : c);
}

export type ItemParaTotal = Pick<PropostaItem, "quantidade" | "valorUnitario" | "valorFixo" | "variacoesEscolhidas"> & {
  statusItem?: string | null;
};

/** Centavos de UM item: qtd × (unitário + variações) + fixo, ao centavo. */
export function centavosDoItem(item: ItemParaTotal): number {
  // Escala 6: quantidade (3 casas) × unitário (3 casas).
  const unitario =
    escalar(item.valorUnitario, 3) +
    (item.variacoesEscolhidas || []).reduce((soma, v) => soma + escalar(v.tipo?.v_extra ?? 0, 3), BigInt(0));
  const bruto6 = escalar(item.quantidade, 3) * unitario + escalar(item.valorFixo, 6);
  return Number(dividirArredondando(bruto6, potencia(4)));
}

export type EntradaDoTotal = {
  itens: readonly ItemParaTotal[];
  bonusPercent: number;
  descontoTipo: "PERCENTUAL" | "VALOR";
  descontoValor: number;
  frete: number;
};

export type TotalNoCentavo = {
  brutoCentavos: number;
  bonusCentavos: number;
  subtotalCentavos: number;
  descontoCentavos: number;
  freteCentavos: number;
  totalCentavos: number;
};

/**
 * A conta inteira em inteiros. Escala interna: 1 real = 10^14 (centavo × 10^12),
 * que comporta bônus e desconto percentuais com duas casas sem arredondar no meio.
 */
export function totalNoCentavo(entrada: EntradaDoTotal): TotalNoCentavo {
  const ativos = entrada.itens.filter((item) => String(item.statusItem ?? "").toUpperCase() !== "CANCELADO");
  const brutoCentavos = ativos.reduce((soma, item) => soma + centavosDoItem(item), 0);

  const bruto = BigInt(brutoCentavos);
  const bonusBp = escalar(Math.max(0, Math.min(100, Number(entrada.bonusPercent) || 0)), 2); // % × 100
  const dezMil = BigInt(10000);
  const fatorLiquido = dezMil - bonusBp;
  // centavos × 10^12
  const subtotal = bruto * fatorLiquido * potencia(8);

  let desconto: bigint;
  if (entrada.descontoTipo === "PERCENTUAL") {
    const descBp = escalar(Math.max(0, Number(entrada.descontoValor) || 0), 2);
    desconto = bruto * fatorLiquido * descBp * potencia(4);
  } else {
    desconto = escalar(Math.max(0, Number(entrada.descontoValor) || 0), 4) * potencia(10);
  }
  if (desconto > subtotal) desconto = subtotal;
  if (desconto < BigInt(0)) desconto = BigInt(0);

  const frete = escalar(Math.max(0, Number(entrada.frete) || 0), 4) * potencia(10);
  const total = subtotal + frete - desconto;

  const um = potencia(12);
  const totalCentavos = Number(dividirArredondando(total, um));
  const subtotalCentavos = Number(dividirArredondando(subtotal, um));
  const freteCentavos = Number(dividirArredondando(frete, um));

  return {
    brutoCentavos,
    bonusCentavos: brutoCentavos - subtotalCentavos,
    subtotalCentavos,
    descontoCentavos: Math.max(0, subtotalCentavos + freteCentavos - totalCentavos),
    freteCentavos,
    totalCentavos
  };
}

/**
 * O percentual de bônus que os itens carregam (acréscimo ÷ bruto), com duas
 * casas. A edição usa este, e não o do cadastro: é o mesmo bônus que já está
 * na soma dos itens da tela. Sem item com bruto, 0.
 */
export function bonusPercentDosItens(
  itens: readonly (Pick<PropostaItem, "subtotalBruto" | "acrescimoBonus"> & { statusItem?: string | null })[]
): number {
  const item = itens.find(
    (i) => String(i.statusItem ?? "").toUpperCase() !== "CANCELADO" && Number(i.subtotalBruto) > 0 && Number(i.acrescimoBonus) > 0
  );
  if (!item) return 0;
  return Math.round((Number(item.acrescimoBonus) / Number(item.subtotalBruto)) * 10000) / 100;
}

/** O resumo sem arredondar, guardado para quem grava (NF-e, consolidação). */
export type ResumoSemArredondar = Pick<PropostaResumo, "subtotalProdutos" | "descontoGeral" | "valorTotal" | "frete">;

export type ResumoNoCentavo = PropostaResumo & { semArredondar?: ResumoSemArredondar };

/**
 * O resumo com os valores de dinheiro trocados pelos da conta em centavos.
 * Peso, prazos e tipo de desconto ficam como vieram.
 *
 * Mantém o formato de quem chamou: se o resumo traz o bônus separado
 * (`subtotalBrutoProdutos` ≠ `subtotalProdutos`, caso da edição), devolve
 * bruto e bônus; se não (carga da proposta), bruto = subtotal e bônus 0.
 *
 * Avulsa não tem item: o total é o do resumo, só arredondado ao centavo.
 */
export function resumoNoCentavo(
  resumo: PropostaResumo,
  entrada: { itens: readonly ItemParaTotal[]; bonusPercent: number; isAvulso?: boolean }
): ResumoNoCentavo {
  const semArredondar: ResumoSemArredondar = {
    subtotalProdutos: resumo.subtotalProdutos,
    descontoGeral: resumo.descontoGeral,
    valorTotal: resumo.valorTotal,
    frete: resumo.frete
  };

  if (entrada.isAvulso) {
    return { ...resumo, valorTotal: centavosDoValor(resumo.valorTotal) / 100, semArredondar };
  }

  const conta = totalNoCentavo({
    itens: entrada.itens,
    bonusPercent: entrada.bonusPercent,
    descontoTipo: resumo.descontoGeralTipo,
    descontoValor: resumo.descontoGeralValor,
    frete: resumo.frete
  });

  const bonusSeparado = Math.abs(Number(resumo.subtotalBrutoProdutos) - Number(resumo.subtotalProdutos)) > 1e-9;
  return {
    ...resumo,
    subtotalBrutoProdutos: (bonusSeparado ? conta.brutoCentavos : conta.subtotalCentavos) / 100,
    acrescimoBonus: bonusSeparado ? conta.bonusCentavos / 100 : 0,
    subtotalProdutos: conta.subtotalCentavos / 100,
    descontoGeral: conta.descontoCentavos / 100,
    frete: conta.freteCentavos / 100,
    valorTotal: conta.totalCentavos / 100,
    semArredondar
  };
}
