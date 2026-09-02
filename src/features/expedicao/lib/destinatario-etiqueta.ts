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
 * A PRECEDÊNCIA:
 *   1. escolha GRAVADA vence sempre, despachado ou não — é decisão explícita de
 *      quem despachou, e continua passando pela validação acima;
 *   2. sem escolha e com despacho CONFIRMADO → o cliente, que é o que aquele
 *      documento já imprimiu. Não se reescreve o que já saiu;
 *   3. sem escolha e sem despacho → o mesmo default que o modal exibe: o
 *      pagador, quando distinto.
 *
 * O degrau 2 é o que protege os já despachados — hoje 1 pedido do painel está
 * exatamente nessa situação. O 3 é o que faz tela e papel convergirem nos 5 que
 * divergiam.
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
  if (entrada.despachoConfirmado) return entrada.idClienteProposta;
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
