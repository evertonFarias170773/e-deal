import type { ResultadoRelatorio } from "../types";

/**
 * Corta o resultado na página pedida (relatório com `paginacao`). Total, cards e avisos ficam
 * como vieram: são do período inteiro. `pagina` vem da URL: "todas" devolve tudo (CSV);
 * número fora do intervalo vira a primeira ou a última página.
 */
export function paginarResultado(
  resultado: ResultadoRelatorio,
  tamanho: number,
  paginaPedida: string | null
): ResultadoRelatorio {
  if (paginaPedida === "todas") return resultado;
  const totalLinhas = resultado.linhas.length;
  const totalPaginas = Math.max(1, Math.ceil(totalLinhas / tamanho));
  const numero = Number.parseInt(paginaPedida ?? "1", 10);
  const pagina = Math.min(Math.max(Number.isFinite(numero) ? numero : 1, 1), totalPaginas);
  return {
    ...resultado,
    linhas: resultado.linhas.slice((pagina - 1) * tamanho, pagina * tamanho),
    paginacao: { pagina, tamanho, totalLinhas, totalPaginas }
  };
}
