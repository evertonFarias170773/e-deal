/**
 * Como a numeração corre entre os lotes montados na grade ("Lista rápida").
 *
 * O QUE ESTE MÓDULO DECIDE
 *   Só a SEQUÊNCIA: onde cada lote começa. A aritmética do Nº Final continua
 *   sendo a de sempre (numeracao-modelo-utils), injetada por `calcularFim` —
 *   é ela que sabe que numerador TICKET consome `ticket_qtd` por unidade, e
 *   duplicar essa conta aqui seria criar uma segunda verdade.
 *
 * POR QUE SEM IMPORTS
 *   Para rodar em `node --experimental-strip-types`, como os outros módulos
 *   puros desta pasta. O alias `@/` não existe fora do bundler.
 *
 * OS DOIS MODOS (escolha do vendedor, na própria grade)
 *   CADA_DO_1   todo lote começa em 1     → 1–300, 1–150, 1–80
 *   SEQUENCIAL  um continua o anterior    → 1–300, 301–450, 451–530
 *
 * Sem modo escolhido a grade não encosta na numeração: os lotes que já vieram
 * do banco mantêm exatamente o que os cards gravaram.
 */

export type ModoNumeracao = "CADA_DO_1" | "SEQUENCIAL";

export type LinhaNumeravel = {
  quantidade: number | "";
  numeracao_inicio?: number | null;
  numeracao_fim?: number | null;
};

/** Primeiro número da série. O padrão do negócio é 1. */
export const INICIO_PADRAO = 1;

/**
 * Aplica o modo escolhido sobre a lista, na ordem em que ela está na tela.
 *
 * `calcularFim` devolve `null` quando não dá para calcular (numerador TICKET
 * sem `ticket_qtd` cadastrado, por exemplo). Nesse caso o Nº Final fica vazio
 * — visível na grade como "—" — e a sequência segue somando a quantidade, que
 * é o melhor palpite possível sem o multiplicador.
 *
 * Lote sem quantidade não recebe numeração e não move a sequência: numerar um
 * lote vazio produziria faixa fantasma na produção.
 */
export function aplicarNumeracao<T extends LinhaNumeravel>(
  linhas: T[],
  modo: ModoNumeracao | null,
  calcularFim: (inicio: number, quantidade: number, linha: T) => number | null
): T[] {
  if (!modo) return linhas;

  let proximo = INICIO_PADRAO;

  return linhas.map((linha) => {
    const qtd = Number(linha.quantidade);
    if (!Number.isFinite(qtd) || qtd <= 0) {
      return { ...linha, numeracao_inicio: null, numeracao_fim: null };
    }

    const inicio = modo === "SEQUENCIAL" ? proximo : INICIO_PADRAO;
    const fim = calcularFim(inicio, qtd, linha);

    if (modo === "SEQUENCIAL") {
      proximo = fim === null ? inicio + qtd : fim + 1;
    }

    return { ...linha, numeracao_inicio: inicio, numeracao_fim: fim };
  });
}

/** Rótulo da faixa para a coluna Numeração. */
export function rotuloFaixa(inicio?: number | null, fim?: number | null): string {
  if (inicio === null || inicio === undefined) return "—";
  const ini = inicio.toLocaleString("pt-BR");
  if (fim === null || fim === undefined) return `${ini}–?`;
  return `${ini}–${fim.toLocaleString("pt-BR")}`;
}
