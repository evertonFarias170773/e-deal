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

/** Há pagador distinto do cliente? É a condição para a escolha existir. */
export function temPagadorDistinto(idClienteProposta: number | null, idFaturado: number | null): boolean {
  return (
    idFaturado !== null &&
    Number.isFinite(Number(idFaturado)) &&
    Number(idFaturado) > 0 &&
    Number(idFaturado) !== Number(idClienteProposta)
  );
}
