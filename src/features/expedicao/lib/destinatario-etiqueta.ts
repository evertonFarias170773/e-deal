/**
 * Em nome de quem a etiqueta sai.
 *
 * O PROBLEMA
 *   Quando o pagador (`propostas.id_faturado`) difere do cliente da proposta, o
 *   nome do destinatario podia ser um ou outro — depende do caso, e nao ha regra
 *   automatica: as vezes a caixa vai para o cliente num endereco do pagador, as
 *   vezes o contrario. Ate 24/08/2026 saia SEMPRE o cliente da proposta, mesmo
 *   quando o endereco escolhido era do pagador.
 *
 * ONDE A ESCOLHA VIVE
 *   `expedicoes.id_cliente_destinatario_etiqueta`, gravada no despacho. Guarda o
 *   ID do cadastro, nao o papel: se o pagador da proposta mudar depois, a
 *   etiqueta continua saindo em nome de quem foi escolhido no momento — mesmo
 *   criterio de `id_endereco_entrega`, que guarda o endereco e nao a regra.
 *
 * ESTA FUNCAO E A VALIDACAO
 *   O despacho e gravado por PostgREST direto do browser, sem rota de API no
 *   caminho (secao 3.5 do EXPEDICAO.md), entao nao existe servidor para barrar a
 *   ESCRITA. A guarda fica na LEITURA, que e server-side nos dois consumidores
 *   (etiqueta 10x15 e prepostagem dos Correios): um id que nao seja o cliente
 *   nem o pagador e ignorado, e o destinatario volta a ser o cliente da
 *   proposta. Nao ha caminho por onde um id arbitrario chegue ao papel.
 *
 * NULO E O COMPORTAMENTO DE SEMPRE: sem escolha, destinatario e o cliente.
 */
export function resolverIdDestinatarioEtiqueta(
  idClienteProposta: number | null,
  idFaturado: number | null,
  idEscolhido: number | null | undefined
): number | null {
  const escolhido = Number(idEscolhido);
  if (!Number.isFinite(escolhido) || escolhido <= 0) return idClienteProposta;
  // Só os dois cadastros da proposta são destinos legítimos.
  if (escolhido === idClienteProposta || (idFaturado !== null && escolhido === idFaturado)) {
    return escolhido;
  }
  return idClienteProposta;
}

/**
 * QUEM SAI NO PAPEL — regra única, tela e documento (02/09/2026).
 *
 * `resolverIdDestinatarioEtiqueta` acima só valida um id JÁ ESCOLHIDO. Faltava
 * quem respondesse "e quando não há escolha?", e as duas pontas respondiam
 * diferente: o modal exibia o PAGADOR (default de 24/08/2026, decisão do dono)
 * e a etiqueta, a Declaração e a prepostagem imprimiam o CLIENTE. No 21503 a
 * tela dizia `PAGADOR #70004` e o papel saía com LISITON DOCUMENTOS SEGUROS.
 *
 * A PRECEDÊNCIA, desde 04/09/2026 com DOIS degraus:
 *   1. escolha GRAVADA vence sempre — é decisão explícita de quem despachou, e
 *      continua passando pela validação acima. São 21 escolhas na base;
 *   2. sem escolha → o PAGADOR quando existir; não existindo, o cliente, que
 *      é o único nome do cadastro.
 *
 * O DEGRAU DO MEIO SAIU (decisão do dono, 04/09/2026). Ele dizia "pedido já
 * despachado imprime o cliente", para não reescrever o que já tinha saído no
 * papel. Caiu junto com o select "Em nome de quem sai a etiqueta": sem o
 * select não há mais escolha nova a gravar, e a regra precisava ser fixa.
 *
 * A BASE CONFIRMA A REGRA: das 21 escolhas gravadas em pedidos com pagador
 * distinto, as 21 escolheram o PAGADOR — nenhuma escolheu o cliente. O select
 * só confirmava o padrão.
 *
 * MUDA O NOME IMPRESSO EM 4 PEDIDOS já despachados e sem escolha gravada
 * (20974, 20464, 20382 e 18360): eles imprimiam o cliente e passam a imprimir
 * o pagador. Medido e autorizado pelo dono em 04/09/2026.
 *
 * NOME E ENDEREÇO SEGUEM INDEPENDENTES. Esta função é irmã de
 * `idEnderecoEntregaVigente` (`lib/endereco-entrega.ts`) e nenhuma consulta a
 * outra: a caixa pode ir para o endereço de um em nome do outro, que é o
 * desenho desde 24/08/2026.
 */
export function idDestinatarioEtiquetaVigente(entrada: {
  /** `expedicoes.data_despacho` preenchida. */
  despachoConfirmado: boolean;
  idClienteProposta: number | null;
  idFaturado: number | null;
  /** `expedicoes.id_cliente_destinatario_etiqueta`. */
  idGravadoNoDespacho: number | null | undefined;
}): number | null {
  const escolhido = Number(entrada.idGravadoNoDespacho);
  if (Number.isFinite(escolhido) && escolhido > 0) {
    return resolverIdDestinatarioEtiqueta(entrada.idClienteProposta, entrada.idFaturado, escolhido);
  }
  return temPagadorDistinto(entrada.idClienteProposta, entrada.idFaturado)
    ? entrada.idFaturado
    : entrada.idClienteProposta;
}

/** Há pagador distinto do cliente? É a condição para a escolha existir. */
export function temPagadorDistinto(idClienteProposta: number | null, idFaturado: number | null): boolean {
  return (
    idFaturado !== null &&
    Number.isFinite(Number(idFaturado)) &&
    Number(idFaturado) > 0 &&
    Number(idFaturado) !== Number(idClienteProposta)
  );
}
