/**
 * ORDEM DOS MODELOS DO PEDIDO (24/11/2026) — arrastar na aba Pedido.
 *
 * `pedidos_modelos.ordem` já existia (padrão 1) e já era a ordem de leitura da
 * aba Pedido, da tela da OS, do boletim (PDF) e das telas do Imposition
 * (`order=ordem.asc`). Até aqui ela era só a sequência de criação: o lote novo
 * entra com o maior + 1 (gravar-lotes.server, pedidos-modelos.service).
 *
 * Arrastar reordena os lotes de UM produto na lista. A rota
 * `/api/pedidos/modelos-ordem` grava o resultado regravando o pedido inteiro em
 * 1..n: os lotes dos outros produtos ficam nas mesmas posições relativas, os do
 * produto arrastado ocupam as posições que já eram dele, na ordem nova. Assim
 * nenhum pedido fica com `ordem` repetida (12 pedidos tinham todos iguais).
 *
 * Arrastar não renumera: só a coluna `ordem` muda. Os modos "Sequencial entre os
 * modelos" e "Cada modelo começa do 1" seguem a ordem das linhas quando o
 * usuário os marca.
 */

export type ModeloParaOrdenar = { id: number; idItem: number | null; ordem: number | null };

/** Move o elemento da posição `de` para a posição `para` (as duas na lista atual). */
export function moverNaLista<T>(lista: readonly T[], de: number, para: number): T[] {
  if (de === para || de < 0 || para < 0 || de >= lista.length || para >= lista.length) return [...lista];
  const copia = [...lista];
  const [movido] = copia.splice(de, 1);
  copia.splice(para, 0, movido);
  return copia;
}

/** A ordem de leitura de sempre: `ordem` e, no empate, `id`. */
export function ordenarComoNaLeitura<T extends ModeloParaOrdenar>(modelos: readonly T[]): T[] {
  return [...modelos].sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || a.id - b.id);
}

export type ResultadoDaOrdem =
  | { ok: true; mudancas: { id: number; ordem: number }[] }
  | { ok: false; code: "LISTA_DIFERENTE"; message: string };

/**
 * A ordem nova do pedido inteiro, em 1..n, com os lotes de `idItem` na ordem de
 * `idsNaOrdem`. Só devolve as linhas cuja `ordem` muda. Recusa quando a lista da
 * tela não é exatamente a do banco (lote criado ou excluído por outra pessoa).
 */
export function novaOrdemDoPedido(
  modelosDoPedido: readonly ModeloParaOrdenar[],
  idItem: number,
  idsNaOrdem: readonly number[]
): ResultadoDaOrdem {
  const atuais = ordenarComoNaLeitura(modelosDoPedido);
  const doItem = atuais.filter((m) => Number(m.idItem) === idItem).map((m) => m.id);
  const pedidos = idsNaOrdem.map(Number);
  const mesmaLista =
    pedidos.length === doItem.length &&
    new Set(pedidos).size === pedidos.length &&
    doItem.every((id) => pedidos.includes(id));
  if (!mesmaLista) {
    return {
      ok: false,
      code: "LISTA_DIFERENTE",
      message: "A lista de modelos deste produto mudou desde que a tela abriu. Recarregue a página e arraste de novo."
    };
  }
  let i = 0;
  const final = atuais.map((m) => (Number(m.idItem) === idItem ? pedidos[i++] : m.id));
  const ordemAtual = new Map(atuais.map((m) => [m.id, Number(m.ordem)]));
  const mudancas = final
    .map((id, posicao) => ({ id, ordem: posicao + 1 }))
    .filter((m) => ordemAtual.get(m.id) !== m.ordem);
  return { ok: true, mudancas };
}
