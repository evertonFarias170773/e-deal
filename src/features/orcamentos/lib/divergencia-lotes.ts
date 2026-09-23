/**
 * Quantidade vendida × soma dos lotes — a trava da liberação para produção
 * (Etapa 7 da reforma do boletim).
 *
 * A REGRA
 *   Vale a soma dos modelos. Para o pedido entrar em produção, cada item ativo
 *   de `produtos_proposta` precisa ter `qtd` IGUAL à soma de
 *   `pedidos_modelos.quantidade` dos lotes pendurados nele. Soma maior, soma
 *   menor e item sem lote nenhum (soma 0) reprovam. Vale para produto de
 *   prateleira também, e para a liberação automática de prateleira.
 *
 * POR QUE EXISTE
 *   O 22194 entrou em produção com a Triband vendida em 500 e nenhum lote — e
 *   o "✓ Distribuição de lotes válida" da tela só reage a soma MAIOR que o
 *   total. Só a rota `lotes-em-massa` sincroniza a quantidade do item com os
 *   lotes; o `saveProposta` e os cards da aba Pedido não. A conferência tem de
 *   estar na liberação, que é a porta que todo pedido atravessa.
 *
 * Item com `status_item = 'CANCELADO'` (inativação lógica de proposta paga)
 * não é conferido: não vai ser produzido. Quem lê filtra antes de chamar.
 *
 * Sem imports de propósito: roda no navegador, na rota do servidor e no teste.
 */

export type ItemParaConferir = {
  /** `produtos_proposta.id` */
  id: number;
  /** `produtos_proposta.nome_produto` */
  nome: string | null;
  /** `produtos_proposta.qtd` — o vendido */
  qtd: number | null;
};

export type LoteParaConferir = {
  id_produto_proposta_origem: number | null;
  quantidade: number | null;
};

export type DivergenciaDeLote = {
  idItem: number;
  nome: string;
  vendido: number;
  somaLotes: number;
};

const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** Os itens cuja quantidade vendida não bate com a soma dos seus lotes. */
export function divergenciasDeLotes(
  itens: readonly ItemParaConferir[],
  lotes: readonly LoteParaConferir[]
): DivergenciaDeLote[] {
  const somaPorItem = new Map<number, number>();
  for (const lote of lotes) {
    const idItem = Number(lote.id_produto_proposta_origem);
    if (!Number.isFinite(idItem) || idItem <= 0) continue; // lote solto não pertence a item nenhum
    somaPorItem.set(idItem, (somaPorItem.get(idItem) ?? 0) + (Number(lote.quantidade) || 0));
  }

  const saida: DivergenciaDeLote[] = [];
  for (const item of itens) {
    const vendido = Number(item.qtd) || 0;
    const somaLotes = somaPorItem.get(Number(item.id)) ?? 0;
    if (vendido !== somaLotes) {
      saida.push({
        idItem: Number(item.id),
        nome: String(item.nome ?? "").trim() || `Item ${item.id}`,
        vendido,
        somaLotes
      });
    }
  }
  return saida;
}

/** Uma linha por divergência: "Produto X: vendido N, lotes somam M". */
export function linhaDaDivergencia(d: DivergenciaDeLote): string {
  return `${d.nome}: vendido ${nf.format(d.vendido)}, lotes somam ${nf.format(d.somaLotes)}`;
}

/** A mensagem da recusa, listando cada divergência. */
export function mensagemDasDivergencias(divergencias: readonly DivergenciaDeLote[]): string {
  return [
    "A quantidade vendida não bate com a soma dos lotes. Acerte os lotes antes de liberar para produção:",
    ...divergencias.map(linhaDaDivergencia)
  ].join("\n");
}
