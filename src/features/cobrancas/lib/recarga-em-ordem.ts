/**
 * Ordem das recargas da lista de cobranças.
 *
 * O PROBLEMA
 *   A lista é recarregada inteira por vários caminhos, e as recargas demoram
 *   (dezenas de requisições). Quando uma linha é atualizada sozinha — a
 *   confirmação da Conferência — duas coisas podem trazer dado velho de volta:
 *
 *   1. uma recarga que JÁ ESTAVA em andamento quando a linha mudou: ela leu o
 *      banco antes da mudança e termina depois;
 *   2. duas recargas que terminam fora de ordem: a mais antiga chega por último
 *      e apaga o que a mais nova trouxe.
 *
 * A REGRA
 *   Cada recarga e cada linha atualizada recebem um número de ordem. Ao
 *   terminar, a recarga:
 *   - é DESCARTADA se outra, iniciada depois dela, já foi aplicada;
 *   - recebe por cima as linhas atualizadas DEPOIS do início dela;
 *   - encerra as linhas atualizadas ANTES do início dela: o que ela leu do
 *     banco já é igual ou mais novo.
 *
 * Sem React e sem rede: é só a contabilidade, para ser testada sozinha.
 */

export type FimDaCarga<T> = {
  /** `false`: uma recarga mais nova já foi aplicada; esta não mexe na tela. */
  aplicar: boolean;
  /** Devolve a lista com as linhas atualizadas depois do início desta recarga. */
  sobrepor: (lista: T[]) => T[];
};

export type ControleDeRecarga<T extends { id: string }> = {
  /** Chame ao INICIAR uma recarga; guarde o número para `concluirCarga`. */
  iniciarCarga: () => number;
  /** Chame ao atualizar uma linha sozinha, com a linha já no estado novo. */
  registrarLinha: (linha: T) => void;
  /** Chame quando a recarga terminar com sucesso, antes de gravar o estado. */
  concluirCarga: (inicio: number) => FimDaCarga<T>;
  /** Quantas linhas atualizadas ainda esperam uma recarga mais nova. */
  linhasPendentes: () => number;
};

export function criarControleDeRecarga<T extends { id: string }>(): ControleDeRecarga<T> {
  let ordem = 0;
  let ultimaAplicada = 0;
  const linhas = new Map<string, { ordem: number; linha: T }>();

  return {
    iniciarCarga() {
      ordem += 1;
      return ordem;
    },

    registrarLinha(linha) {
      ordem += 1;
      linhas.set(linha.id, { ordem, linha });
    },

    concluirCarga(inicio) {
      if (inicio < ultimaAplicada) {
        return { aplicar: false, sobrepor: (lista) => lista };
      }
      ultimaAplicada = inicio;

      for (const [id, registro] of linhas) {
        if (registro.ordem < inicio) linhas.delete(id);
      }

      const vigentes = new Map(Array.from(linhas, ([id, registro]) => [id, registro.linha] as const));
      return {
        aplicar: true,
        // Linha que a recarga não trouxe (fora do filtro da leitura) não é
        // acrescentada: quem decide o conjunto é a recarga.
        sobrepor: (lista) => (vigentes.size === 0 ? lista : lista.map((item) => vigentes.get(item.id) ?? item))
      };
    },

    linhasPendentes() {
      return linhas.size;
    }
  };
}

/**
 * A linha relida do banco, com o que só a recarga completa sabe.
 *
 * A releitura de uma cobrança traz as colunas de `pagamentos_v2`. Os dados que
 * a recarga completa busca em OUTRAS tabelas (crédito do cliente, cliente
 * principal, sócio pagador, PDF do boleto) não vêm nela, e sem isto a linha
 * perderia o nome do cliente principal e o link do boleto até a recarga
 * terminar.
 */
export function manterDadosDaRecarga<T extends object>(relida: T, anterior: T | undefined, campos: readonly (keyof T)[]): T {
  if (!anterior) return relida;
  const linha = { ...relida };
  for (const campo of campos) {
    const valor = anterior[campo];
    if (valor !== undefined && valor !== null && valor !== "") linha[campo] = valor;
  }
  return linha;
}
