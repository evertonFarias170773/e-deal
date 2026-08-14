/**
 * Leitura da lista de lotes colada pelo vendedor.
 *
 * Separado do componente por ser onde dado se perde em silêncio: uma linha mal
 * interpretada vira lote errado no chão de fábrica. Sem React e sem I/O, para
 * poder ser testado com os formatos reais que chegam dos clientes.
 */

export type CorOpcao = { id?: number | string; name: string };

export type LinhaColada = {
  quantidade: number;
  /** Nome exato da cor no cadastro, quando reconhecida. */
  padrao: string | null;
  /** Texto colado que não casou com nenhuma cor — vai em vermelho na tela. */
  corNaoReconhecida: string | null;
};

function normalizar(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    // Acento não pode decidir se o lote entra: "Verde Agua" tem de casar com
    // "Verde Água".
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Interpreta o texto colado. Aceita o que sai de planilha (`cor<TAB>qtd`) e o
 * que se digita à mão (`cor;qtd`, `cor,qtd`).
 *
 * A quantidade é o ÚLTIMO campo numérico da linha e a cor é todo o resto —
 * assim "Verde Água claro;500" funciona sem exigir ordem fixa de colunas.
 * Linha sem número é ignorada, que é o caso do cabeçalho da planilha.
 */
export function interpretarColagem(texto: string, cores: CorOpcao[]): LinhaColada[] {
  const porNome = new Map(cores.map((c) => [normalizar(c.name), c.name]));

  return texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha): LinhaColada | null => {
      // A quantidade é capturada como o número no FIM da linha, e não por
      // divisão em colunas: a vírgula é separador de campo E decimal ao mesmo
      // tempo, então dividir "Branco,100,4" em colunas transformava a
      // quantidade em 4. Tudo o que vem antes é a cor, o que também resolve
      // nome de cor com espaço sem exigir ordem fixa de colunas.
      const casamento = linha.match(/^(.*?)[\t;,|\s]+([\d.,]+)\s*$/);
      if (!casamento) return null;

      // Separador de milhar some; vírgula decimal vira ponto. Quantidade é
      // sempre inteira — lote de 2,5 unidades não existe.
      const bruto = casamento[2].replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
      const quantidade = Number(bruto);
      if (!Number.isFinite(quantidade) || quantidade <= 0) return null;

      const corBruta = casamento[1].replace(/[\t;,|\s]+$/, "").trim();
      const casada = porNome.get(normalizar(corBruta)) ?? null;

      return {
        quantidade: Math.round(quantidade),
        padrao: casada,
        corNaoReconhecida: casada ? null : corBruta || null
      };
    })
    .filter((l): l is LinhaColada => l !== null);
}

export function somaQuantidades(linhas: { quantidade: number | "" }[]): number {
  return linhas.reduce((total, l) => total + (Number(l.quantidade) || 0), 0);
}
