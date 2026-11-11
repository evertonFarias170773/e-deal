/**
 * COTAÇÃO SEM VALOR NÃO VIRA CARD (11/11/2026, caso 25058).
 *
 * O webhook do SEDEX respondeu sem valor e a tela montou o card "Correios /
 * SEDEX / R$ 0,00 / Sob consulta", que foi salvo e cobrado sem frete. Regra
 * única para as fontes de cotação (SEDEX/PAC, Azul Cargo, São Miguel e Motoboy,
 * VEPPO): só vira card o valor cotado maior que zero. Falha ou resposta sem
 * valor não monta card; a tela diz qual fonte não cotou e pede "Atualizar
 * fretes".
 *
 * Não vale para valor DIGITADO (avulsa, cliente com "Pode editar valor do
 * frete", motoboy interno, frete manual): esses não passam por aqui.
 *
 * "Não atende" não é falha: Azul fora do RS ou sem unidade na cidade, VEPPO
 * fora da regra ou cidade não atendida, e São Miguel/Motoboy sem tarifa (a
 * função do banco devolve zero) continuam sem card e sem aviso, como antes.
 */

/** Valor cotado que pode virar card: número finito maior que zero. */
export function valorCotadoValido(valor: unknown): boolean {
  if (valor === null || valor === undefined || valor === "") return false;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0;
}

/** Separa os cards com valor dos que vieram sem valor (zero, vazio, negativo). */
export function separarCardsSemValor<T extends { valor: unknown }>(cards: readonly T[]): { comValor: T[]; semValor: T[] } {
  const comValor: T[] = [];
  const semValor: T[] = [];
  for (const card of cards) (valorCotadoValido(card.valor) ? comValor : semValor).push(card);
  return { comValor, semValor };
}

/** A fonte respondeu, mas nenhuma opção veio com valor. */
export class CotacaoSemValorError extends Error {
  readonly fonte: string;
  constructor(fonte: string) {
    super(`${fonte} respondeu sem valor.`);
    this.name = "CotacaoSemValorError";
    this.fonte = fonte;
  }
}

export type FonteDeFrete = "SEDEX" | "AZUL" | "TRANSPORTADORAS" | "VEPPO";

export const ROTULO_FONTE_DE_FRETE: Record<FonteDeFrete, string> = {
  SEDEX: "Correios (SEDEX/PAC)",
  AZUL: "Azul Cargo",
  TRANSPORTADORAS: "São Miguel / Motoboy",
  VEPPO: "VEPPO"
};

/**
 * Status da rota da VEPPO em que ela devia ter cotado: chamou o n8n sem valor
 * ou não conseguiu conferir a lista ou o corte. FORA_DA_REGRA e NAO_ATENDIDA
 * são "não atende", sem aviso.
 */
export function veppoDeviaTerCotado(status: unknown): boolean {
  return status === "SEM_COTACAO" || status === "LISTA_INDISPONIVEL" || status === "CORTE_NAO_CONFERIDO" || status === "COTADA";
}

/** O que aconteceu com uma fonte numa cotação da tela. */
export type ResultadoDaFonte = {
  fonte: FonteDeFrete;
  /** Erro da chamada (falha, tempo ou `CotacaoSemValorError`). */
  erro?: unknown;
  /** Serviços que vieram sem valor e foram descartados (os outros viraram card). */
  descartados?: readonly string[];
  /** A fonte não cotou sem lançar erro (ex.: VEPPO com SEM_COTACAO). */
  naoCotou?: boolean;
};

/**
 * Linhas do aviso "não cotou", uma por fonte. Vazio = todas cotaram (ou não
 * atendem o destino, o que não é aviso).
 */
export function fontesQueNaoCotaram(resultados: readonly ResultadoDaFonte[]): string[] {
  const linhas: string[] = [];
  for (const r of resultados) {
    const rotulo = ROTULO_FONTE_DE_FRETE[r.fonte];
    if (r.erro instanceof CotacaoSemValorError) {
      linhas.push(`${rotulo}: respondeu sem valor`);
    } else if (r.erro !== undefined && r.erro !== null) {
      linhas.push(`${rotulo}: não respondeu`);
    } else if (r.naoCotou) {
      linhas.push(`${rotulo}: não cotou`);
    } else if (r.descartados && r.descartados.length > 0) {
      linhas.push(`${rotulo}: ${[...new Set(r.descartados)].join(", ")} sem valor`);
    }
  }
  return linhas;
}
