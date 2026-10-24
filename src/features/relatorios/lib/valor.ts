import type { FiltroDef } from "../types";

/**
 * Filtro "Valor" — regra do modelo para todo relatório de venda (24/10/2026).
 *
 * Sem frete é o padrão (valor em branco na URL); "Com frete" soma o frete da proposta.
 * Cada relatório repassa `incluirFrete(filtros)` à função do banco e escreve no cabeçalho,
 * por `notaValor`, qual está ativo.
 */
export const FILTRO_VALOR: FiltroDef = {
  chave: "valor",
  rotulo: "Valor",
  todasRotulo: "Sem frete",
  opcoes: [{ valor: "COM_FRETE", rotulo: "Com frete" }]
};

export function incluirFrete(filtros: Record<string, string>) {
  return filtros.valor === "COM_FRETE";
}

export function rotuloValor(incluir: boolean) {
  return incluir ? "com frete" : "sem frete";
}

export function notaValor(filtros: Record<string, string>) {
  return `Valor mostrado: ${rotuloValor(incluirFrete(filtros))}.`;
}
