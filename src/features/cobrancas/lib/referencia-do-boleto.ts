/**
 * A referência do título criado pela janela "Preparar boletos".
 *
 * O MESMO valor vai em `boletos.ext_reference` e em `boletos.n_doc_boleto`: as
 * rotas de registro mandam `ext_reference` ao banco, o n8n usa esse valor como
 * código do link, e a Edge Function `boleto-publico` acha o título por
 * `n_doc_boleto`, com igualdade exata. Por isso esta função devolve UM texto, e
 * quem grava usa o mesmo nos dois campos.
 *
 * E o valor tem de ser único entre os títulos ativos
 * (`idx_boletos_n_doc_boleto_ativo`). Daí a regra:
 *
 *   aberta pela NOTA             -> a ref da nota. Nota com 2+ parcelas é
 *                                   barrada antes, na tela (`notaParcelada`).
 *   aberta pela COBRANÇA:
 *     2 ou mais parcelas         -> `P` + parcela + total + pedido, SEMPRE,
 *                                   com ou sem nota;
 *     parcela única, com nota    -> a ref da nota;
 *     parcela única, sem nota    -> `P` + parcela + total + pedido.
 *
 * POR QUE (09/10/2026, pedido 23181). Até essa data, pedido com NF-e autorizada
 * usava a ref da nota também com várias parcelas: as três linhas do mesmo
 * INSERT levavam `NFE-23181-001` e a segunda colidia no índice único. Não tinha
 * aparecido antes porque o faturado parcelado costuma ser preparado ANTES de a
 * nota sair — os 44 títulos parcelados existentes já estavam no formato `P…`.
 * O número da nota continua indo para `n_nf`, que não é chave de nada.
 *
 * O formato `P…` é único por parcela dentro do pedido porque o banco já garante
 * uma só parcela ativa por (`id_int`, `parcela`) — `boletos_unico_parcela_ativo`.
 * Com duas cobranças faturadas no mesmo pedido, a segunda não repete o número de
 * parcela da primeira: a janela recusa antes ("Duplicidade detectada").
 */

export type EntradaDaReferencia = {
  idInt: number | string | null | undefined;
  parcela: number;
  totalParcelas: number;
  /** Quantas linhas esta janela vai gravar de uma vez. */
  quantidadeDeParcelas: number;
  /** Ref da nota quando a janela foi aberta PELA nota. */
  refDaNotaDeOrigem?: string | null;
  /** Ref da NF-e autorizada do pedido, quando a janela foi aberta pela cobrança. */
  refDaNotaDoPedido?: string | null;
};

/** `P` + parcela + total de parcelas + número do pedido. */
export function referenciaPorParcela(parcela: number, totalParcelas: number, idInt: number | string | null | undefined): string {
  return `P${parcela}${totalParcelas}${idInt}`;
}

export function referenciaDoBoleto(entrada: EntradaDaReferencia): string {
  const refDeOrigem = String(entrada.refDaNotaDeOrigem ?? "").trim();
  if (refDeOrigem) return refDeOrigem;

  const parcelado = entrada.quantidadeDeParcelas >= 2 || entrada.totalParcelas >= 2;
  const refDoPedido = String(entrada.refDaNotaDoPedido ?? "").trim();
  if (refDoPedido && !parcelado) return refDoPedido;

  return referenciaPorParcela(entrada.parcela, entrada.totalParcelas, entrada.idInt);
}

/** As referências de um lançamento inteiro, na ordem das parcelas. */
export function referenciasDoLancamento(
  parcelas: ReadonlyArray<{ parcela: number; total_parcelas: number }>,
  origem: { idInt: number | string | null | undefined; refDaNotaDeOrigem?: string | null; refDaNotaDoPedido?: string | null }
): string[] {
  return parcelas.map((item) =>
    referenciaDoBoleto({
      idInt: origem.idInt,
      parcela: item.parcela,
      totalParcelas: item.total_parcelas,
      quantidadeDeParcelas: parcelas.length,
      refDaNotaDeOrigem: origem.refDaNotaDeOrigem,
      refDaNotaDoPedido: origem.refDaNotaDoPedido
    })
  );
}

/** Há referência repetida no lançamento? Devolve a primeira, para a mensagem. */
export function referenciaRepetida(referencias: readonly string[]): string | null {
  const vistas = new Set<string>();
  for (const ref of referencias) {
    if (vistas.has(ref)) return ref;
    vistas.add(ref);
  }
  return null;
}
