/**
 * QUAL ENDEREÇO DE ENTREGA VALE — regra única (02/09/2026).
 *
 * Nasceu de uma divergência real e grave: depois de `aafc0a6` o modal Despachar
 * passou a exibir `propostas.id_endereco_ent`, mas a etiqueta 10×15, a
 * Declaração de Conteúdo e a prepostagem dos Correios continuaram lendo só
 * `expedicoes.id_endereco_entrega` e, na falta dele, caindo num palpite — o
 * endereço que casa com o CEP cotado, senão **o mais recente do cliente**.
 *
 * No 21503 isso significava a tela dizer *Santarém/PA* e o papel sair com
 * *Garanhuns/PE*: endereço do cadastro 8469, mais recente, que não tem nada a
 * ver com o destinatário. O volume sairia rotulado para o lugar errado.
 *
 * A PRECEDÊNCIA, idêntica à que o modal exibe:
 *   1. despacho CONFIRMADO → o endereço gravado. O que já saiu não se
 *      reescreve, e é o que foi para a etiqueta e para a prepostagem;
 *   2. senão → `propostas.id_endereco_ent`, definido na proposta.
 *
 * RASCUNHO NÃO VENCE A PROPOSTA. Até `aafc0a6` o expedidor escolhia o endereço
 * num select e podia gravar sem despachar; hoje ele não escolhe mais, então um
 * `id_endereco_entrega` sem `data_despacho` só pode ser resquício anterior.
 * Medido em 02/09/2026: **0 pedidos** do painel têm rascunho divergente da
 * proposta, então esta escolha não muda nada hoje — e mantém tela e papel
 * dizendo a mesma coisa, que é o ponto.
 *
 * Devolve `null` quando não há nenhum dos dois. Aí cada documento segue com o
 * seu próprio último recurso, que continua intacto — este módulo não decide o
 * que fazer na ausência, só qual id vale quando existe.
 */
export function idEnderecoEntregaVigente(entrada: {
  /** `expedicoes.data_despacho` preenchida. */
  despachoConfirmado: boolean;
  /** `expedicoes.id_endereco_entrega`. */
  idGravadoNoDespacho: string | null | undefined;
  /** `propostas.id_endereco_ent` — é `text` na tabela, e aponta para `enderecos.id`. */
  idDefinidoNaProposta: string | null | undefined;
}): string | null {
  const gravado = String(entrada.idGravadoNoDespacho ?? "").trim();
  const daProposta = String(entrada.idDefinidoNaProposta ?? "").trim();
  const doDespacho = entrada.despachoConfirmado ? gravado : "";
  return doDespacho || daProposta || null;
}
