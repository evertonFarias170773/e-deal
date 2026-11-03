/**
 * Comissão dos vendedores (03/11/2026) — fonte única da tabela de faixas.
 *
 * A faixa sai do total do vendedor no período, na base escolhida (com ou sem frete), e o
 * percentual vale sobre o total inteiro (não é por degrau). Comissão = total × %, arredondada
 * em centavos. Toda a conta é feita em centavos e em centésimos de ponto percentual, para não
 * depender de arredondamento de número decimal.
 *
 * Usado pelo relatório "Pagamento de comissão" (tela, PDF da lista e recibo).
 */

export type BaseComissao = "COM_FRETE" | "SEM_FRETE";

export const ROTULO_BASE: Record<BaseComissao, string> = {
  COM_FRETE: "Com frete",
  SEM_FRETE: "Sem frete"
};

export function ehBaseComissao(valor: unknown): valor is BaseComissao {
  return valor === "COM_FRETE" || valor === "SEM_FRETE";
}

/**
 * Faixas em ordem crescente. `acimaDe` em reais: a faixa vale para total maior que esse valor
 * (o limite em si fica na faixa de baixo). `centesimos` é o percentual × 100 (530 = 5,30%).
 */
export const FAIXAS_COMISSAO: readonly { acimaDe: number; centesimos: number }[] = [
  { acimaDe: 0, centesimos: 500 },
  { acimaDe: 100_000, centesimos: 515 },
  { acimaDe: 150_000, centesimos: 530 },
  { acimaDe: 200_000, centesimos: 540 },
  { acimaDe: 250_000, centesimos: 550 },
  { acimaDe: 300_000, centesimos: 560 },
  { acimaDe: 350_000, centesimos: 570 },
  { acimaDe: 400_000, centesimos: 575 }
];

const emCentavos = (reais: number) => Math.round(reais * 100);

/** Centésimos de ponto percentual da faixa do total (530 = 5,30%). Total zero ou negativo: 5%. */
function centesimosDaFaixa(total: number): number {
  const centavos = emCentavos(total);
  let escolhida = FAIXAS_COMISSAO[0].centesimos;
  for (const faixa of FAIXAS_COMISSAO) {
    if (centavos > faixa.acimaDe * 100) escolhida = faixa.centesimos;
  }
  return escolhida;
}

/** Percentual da faixa, em pontos (5.3 = 5,30%). */
export function percentualDaComissao(total: number): number {
  return centesimosDaFaixa(total) / 100;
}

/** Comissão em reais, arredondada em centavos. */
export function valorDaComissao(total: number): number {
  const centavos = Math.round((emCentavos(total) * centesimosDaFaixa(total)) / 10_000);
  return centavos / 100;
}

/** Texto das faixas, para o critério da tela e do PDF. */
export function textoDasFaixas(): string {
  const pct = (c: number) => `${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%`;
  const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR")} mil`.replace(".000 mil", " mil");
  return FAIXAS_COMISSAO.map((f, i) =>
    i === 0
      ? `até ${reais(FAIXAS_COMISSAO[1].acimaDe)} inclusive, ${pct(f.centesimos)}`
      : `acima de ${reais(f.acimaDe)}, ${pct(f.centesimos)}`
  ).join("; ");
}
