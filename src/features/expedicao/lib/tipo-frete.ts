import type { ModalidadeFrete, TipoFreteNormalizado } from "../types";

/** Ordem de exibição no select de filtro da tela. */
export const TIPOS_FRETE: TipoFreteNormalizado[] = [
  "CORREIOS",
  "MOTOBOY",
  "TRANSPORTADORA",
  "RETIRA_BALCAO",
  "SEM_CUSTO",
  "INDEFINIDO"
];

const LABELS: Record<TipoFreteNormalizado, string> = {
  CORREIOS: "Correios",
  MOTOBOY: "Motoboy",
  TRANSPORTADORA: "Transportadora",
  RETIRA_BALCAO: "Retira balcão",
  SEM_CUSTO: "Sem custo",
  INDEFINIDO: "A definir"
};

export function labelTipoFrete(tipo: TipoFreteNormalizado): string {
  return LABELS[tipo];
}

/**
 * Normaliza o texto LIVRE de cotacao_frete.servico nas categorias canônicas.
 * Vocabulário levantado do banco em 15/08/2026: SEDEX(490), FRETE INCLUSO(1077),
 * SEM CUSTO(97), MOTOBOY(69), SÃO MIGUEL(28), AZUL ECOMM/ECOMM/AZUL(34),
 * VEPPO/VEPPO-RS(23), RETIRA*(25), UNESUL(5), BRASPRESS/BRASPESS(3), TROCA(2),
 * TRANSPORTADORA PARCEIRA(5) e lixo ("12", "AS", "DD", "NÃO", "FRETE"...).
 * "RETIRA" antes de "TRANSPORTADORA"; acentos são removidos antes do match.
 * IMPORTANTE: "SEM CUSTO" é envio grátis, NÃO retirada (corrige a heurística
 * antiga da tela, que jogava SEM CUSTO em retirada local).
 */
export function normalizarTipoFrete(
  servico: string | null | undefined
): TipoFreteNormalizado {
  const s = (servico ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  if (!s) return "INDEFINIDO";
  if (/(^|[^A-Z])(SEDEX|PAC)([^A-Z]|$)/.test(s)) return "CORREIOS";
  if (s.includes("MOTOBOY")) return "MOTOBOY";
  if (s.includes("RETIRA") || s.includes("BALCAO")) return "RETIRA_BALCAO";
  if (s.includes("SEM CUSTO")) return "SEM_CUSTO";
  if (
    s.includes("SAO MIGUEL") ||
    s.includes("UNESUL") ||
    s.includes("BRASPRESS") ||
    s.includes("BRASPESS") ||
    s.includes("AZUL") ||
    s.includes("ECOMM") ||
    s.includes("VEPPO") ||
    s.includes("TROCA") ||
    s.includes("TRANSPORTADORA")
  ) {
    return "TRANSPORTADORA";
  }
  return "INDEFINIDO";
}

/**
 * Modalidade com que o modal de despacho ABRE.
 *
 * PRECEDÊNCIA, e o porquê de cada degrau:
 *   1. `expedicoes.modalidade_frete` — o que o expedidor já declarou na bancada.
 *      Soberana: é o que de fato aconteceu.
 *   2. Cotação `RETIRA_BALCAO` — a mercadoria é buscada no balcão, então não há
 *      transporte para ninguém pagar. Vence a modalidade do orçamento, EXCETO
 *      quando ela é FOB.
 *   3. `propostas.modalidade_frete` — o que o vendedor declarou.
 *   4. nada, e o modal exige escolha explícita.
 *
 * POR QUE O DEGRAU 2 VENCE O 3 (e como isso dispensa coluna nova)
 *   Desde 19/08/2026 o orçamento nasce em CIF por padrão. Sem o degrau 2, uma
 *   venda de balcão em que o vendedor não trocou a modalidade chegaria ao
 *   despacho pré-selecionada como CIF — e a inferência de RETIRA, que existia
 *   antes, nunca mais rodaria.
 *
 *   Distinguir "CIF escolhido" de "CIF por default" parece exigir uma coluna
 *   nova, mas não exige: RETIRA e FOB só existem por escolha explícita — nenhum
 *   dos dois é, ou pode ser, o padrão. CIF é o ÚNICO valor que chega sem alguém
 *   ter escolhido. Logo "CIF vindo do orçamento" já É o caso ambíguo, por
 *   construção do vocabulário, e tratá-lo como evidência mais fraca que uma
 *   cotação de balcão não perde informação nenhuma.
 *
 *   FOB fica de fora do degrau 2 de propósito: é sempre escolha deliberada, e
 *   carrega uma transportadora obrigatória junto. Sobrepor RETIRA a um FOB
 *   explícito descartaria uma decisão real do vendedor.
 *
 *   O limite, dito com todas as letras: um CIF escolhido a dedo numa venda de
 *   balcão também abre como RETIRA. É combinação contraditória — quem retira no
 *   balcão não tem frete para a empresa pagar — e continua sendo só uma
 *   pré-seleção, que o expedidor troca em um clique.
 */
export function modalidadeInicialDoDespacho(
  doDespacho: ModalidadeFrete | null | undefined,
  doOrcamento: ModalidadeFrete | null | undefined,
  tipoFreteCotado: TipoFreteNormalizado
): ModalidadeFrete | null {
  if (doDespacho) return doDespacho;
  if (tipoFreteCotado === "RETIRA_BALCAO" && doOrcamento !== "FOB") return "RETIRA";
  return doOrcamento ?? null;
}
