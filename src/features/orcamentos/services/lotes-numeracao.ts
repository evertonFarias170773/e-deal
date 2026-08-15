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
 * SEM MODO ESCOLHIDO cada lote mantém o Nº Inicial que já tem — a grade não
 * reorganiza nada por conta própria. O Nº Final, esse sim, é sempre refeito:
 * é campo automático nos cards também, e deixá-lo velho depois de mudar a
 * quantidade mandaria uma faixa errada para a produção.
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
 * lote vazio produziria faixa fantasma na produção. Sem modo escolhido, porém,
 * um lote sem quantidade fica intacto — não é hora de apagar o que o card
 * gravou.
 */
export function aplicarNumeracao<T extends LinhaNumeravel>(
  linhas: T[],
  modo: ModoNumeracao | null,
  calcularFim: (inicio: number, quantidade: number, linha: T) => number | null
): T[] {
  let proximo = INICIO_PADRAO;

  return linhas.map((linha) => {
    const qtd = Number(linha.quantidade);
    if (!Number.isFinite(qtd) || qtd <= 0) {
      return modo ? { ...linha, numeracao_inicio: null, numeracao_fim: null } : linha;
    }

    const inicio =
      modo === "SEQUENCIAL" ? proximo : modo === "CADA_DO_1" ? INICIO_PADRAO : (linha.numeracao_inicio ?? null);

    // Sem modo e sem Nº Inicial não há de onde tirar faixa: lote fica como está.
    if (inicio === null) return linha;

    const fim = calcularFim(inicio, qtd, linha);

    if (modo === "SEQUENCIAL") {
      proximo = fim === null ? inicio + qtd : fim + 1;
    }

    return { ...linha, numeracao_inicio: inicio, numeracao_fim: fim };
  });
}

/**
 * Faixa por extenso, para o resumo do lote fechado: "De 001 a 080".
 *
 * Zeros à esquerda porque é assim que a numeração é impressa. A largura
 * acompanha o maior número da faixa, com piso de 3 — abaixo disso "1 a 80"
 * não se lê como numeração.
 *
 * Devolve `null` quando o lote não tem faixa: quem chama decide não mostrar
 * nada, em vez de exibir um traço sem sentido.
 */
export function rotuloFaixaExtenso(inicio?: number | null, fim?: number | null): string | null {
  if (inicio === null || inicio === undefined) return null;
  if (fim === null || fim === undefined) return null;
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null;

  const largura = Math.max(3, String(Math.max(inicio, fim)).length);
  return `De ${String(inicio).padStart(largura, "0")} a ${String(fim).padStart(largura, "0")}`;
}

/** Rótulo da faixa para a coluna Numeração. */
export function rotuloFaixa(inicio?: number | null, fim?: number | null): string {
  if (inicio === null || inicio === undefined) return "—";
  const ini = inicio.toLocaleString("pt-BR");
  if (fim === null || fim === undefined) return `${ini}–?`;
  return `${ini}–${fim.toLocaleString("pt-BR")}`;
}
