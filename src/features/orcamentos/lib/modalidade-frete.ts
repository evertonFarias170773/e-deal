/**
 * Modalidade do frete na PROPOSTA — quem paga o transporte, declarado pelo
 * vendedor na aba Fretes.
 *
 * POR QUE ISSO EXISTE COMO MÓDULO
 *   A regra "FOB não tem frete a cobrar" precisa valer em três lugares que não
 *   se enxergam: o resumo da tela, o resumo do salvamento e o valor gravado em
 *   `propostas.valor_frete` / `cotacao_frete.valor`. Escrever a regra em cada um
 *   deles era garantir divergência — o próprio módulo de frete do orçamento já
 *   tem a montagem de opções duplicada em dois blocos quase idênticos.
 *
 *   Como a regra mora aqui e é aplicada na FRONTEIRA de consumo (quem calcula
 *   dinheiro), os dois blocos de cotação não precisam saber que ela existe: eles
 *   seguem montando as opções com os valores reais cotados, que continuam
 *   visíveis na tela como referência.
 *
 * O VOCABULÁRIO É O MESMO DA EXPEDIÇÃO, de propósito: `ModalidadeFrete` tem uma
 * definição só no sistema (`src/features/expedicao/types.ts`), e as duas pontas
 * comparam o que foi vendido com o que foi despachado sem tradução no meio.
 *
 * Sem I/O: funções puras, testáveis e usadas tanto no client quanto no service.
 */

import type { ModalidadeFrete } from "@/features/expedicao/types";
import { LABEL_MODALIDADE } from "@/features/expedicao/types";
import type { PropostaFrete } from "../types";

export type { ModalidadeFrete };
export { LABEL_MODALIDADE };

/** Ordem de exibição no orçamento. As três são oferecidas. */
export const MODALIDADES_ORCAMENTO: ModalidadeFrete[] = ["RETIRA", "FOB", "CIF"];

/**
 * Status em que a modalidade ainda pode ser declarada ou corrigida.
 *
 * A partir de `LIBERADO` os campos ficam somente leitura. O motivo é do banco,
 * não de processo: salvar o orçamento faz DELETE + INSERT em `cotacao_frete`, e
 * o trigger `trg_frete_sync_financeiro` reescreve `status_interno` a partir de
 * `pagamentos_v2` — com zero pagamentos ele força `NOVO` incondicionalmente.
 * Editar o frete de um pedido que já saiu da fase de orçamento o rebaixaria.
 */
const STATUS_EDITAVEIS = ["NOVO", "AGUARDANDO"];

/**
 * `status_interno` pode vir composto ("NOVO / EM ARTE", "AGUARDANDO / EM ARTE"),
 * e esses ainda são fase de orçamento — a barra separa o estado de arte, não o
 * estágio do pedido. Proposta nova (sem status gravado) é editável.
 */
export function podeEditarModalidade(statusInterno: string | null | undefined): boolean {
  const bruto = (statusInterno ?? "").trim();
  if (bruto === "") return true;
  const base = bruto.split("/")[0].trim().toUpperCase();
  return STATUS_EDITAVEIS.includes(base);
}

/** Mensagem única do aviso de somente leitura, para tela e toast falarem igual. */
export function motivoBloqueioModalidade(statusInterno: string | null | undefined): string {
  return (
    `A modalidade e a transportadora ficam somente leitura a partir de LIBERADO ` +
    `(status atual: ${statusInterno || "—"}). Alterar o frete depois dessa fase reabre a ` +
    `proposta como NOVO e a tira do fluxo de produção.`
  );
}

/**
 * Valor do frete que a proposta cobra, dada a modalidade.
 *
 * Em FOB o transporte é contratado e pago pelo cliente: não há frete a cobrar,
 * qualquer que seja a cotação em tela. `RETIRA`, `CIF` e a ausência de
 * modalidade (proposta anterior a 18/08/2026) mantêm o valor cotado.
 */
export function valorFreteEfetivo(
  valorCotado: number | null | undefined,
  modalidade: ModalidadeFrete | null | undefined
): number {
  if (modalidade === "FOB") return 0;
  const numero = Number(valorCotado);
  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Lista de fretes com a modalidade já aplicada, para alimentar `calculateResumo`
 * sem que ele precise conhecer modalidade. Só a opção ESCOLHIDA é zerada — as
 * demais seguem com o valor cotado, porque continuam servindo de referência na
 * tela. Fora de FOB devolve o array original, sem cópia.
 */
export function aplicarModalidadeNosFretes(
  fretes: PropostaFrete[],
  modalidade: ModalidadeFrete | null | undefined
): PropostaFrete[] {
  if (modalidade !== "FOB") return fretes;
  return fretes.map((frete) => (frete.escolhido ? { ...frete, valor: 0 } : frete));
}

/** FOB sem transportadora definida não fecha: é a informação que a Expedição vai usar. */
export function faltaTransportadoraEmFob(
  modalidade: ModalidadeFrete | null | undefined,
  idTransportadoraCliente: number | null | undefined
): boolean {
  return modalidade === "FOB" && (idTransportadoraCliente === null || idTransportadoraCliente === undefined);
}

/**
 * Nome usado quando a modalidade é FOB e a transportadora declarada não pôde ser
 * resolvida no cadastro (linha órfã ou leitura falha). Nunca cai de volta no
 * serviço cotado: dizer "SEDEX" num pedido FOB é exatamente o erro que este
 * módulo existe para impedir.
 */
export const TRANSPORTADORA_FOB_INDEFINIDA = "Transportadora a definir";

/**
 * Nome do transporte que vale para quem lê a proposta DEPOIS — `frete_escolhido`,
 * a "FORMA DE ENVIO" do PDF da OS e a coluna FRETE da Expedição.
 *
 * POR QUE ISSO EXISTE
 *   `valorFreteEfetivo` resolveu o dinheiro, mas não a IDENTIDADE do transporte.
 *   Sob FOB o serviço cotado (SEDEX, PAC) é só a referência de preço que ficou
 *   registrada em `cotacao_frete` — quem leva a mercadoria é a transportadora que
 *   o cliente contratou e o vendedor declarou. Sem esta função cada consumidor
 *   lia `cotacao_frete.servico` cru e imprimia "SEDEX" num pedido que os Correios
 *   nunca vão tocar.
 *
 *   A cotação continua intacta no banco, escolhida e com peso real: o que muda é
 *   o RÓTULO, na fronteira de consumo — mesma disciplina de `valorFreteEfetivo`.
 *
 * Fora de FOB devolve o serviço cotado, sem alteração de comportamento.
 */
export function nomeTransporteEfetivo(
  servicoCotado: string | null | undefined,
  modalidade: ModalidadeFrete | null | undefined,
  nomeTransportadora: string | null | undefined
): string {
  if (modalidade !== "FOB") return (servicoCotado ?? "").trim();
  return (nomeTransportadora ?? "").trim() || TRANSPORTADORA_FOB_INDEFINIDA;
}

/**
 * Nome de exibição de uma transportadora do cadastro (`clientes` com
 * `categoria = TRANSPORTADORA`). Fantasia primeiro, razão social depois, e o id
 * como último recurso — mesma ordem que a aba Fretes e o DespacharModal já usam,
 * para o vendedor e o expedidor lerem exatamente o mesmo texto.
 */
export function nomeTransportadoraCadastro(
  cadastro: { id_cliente: number; nome?: string | null; fantasia?: string | null } | null | undefined
): string | null {
  if (!cadastro) return null;
  return cadastro.fantasia || cadastro.nome || `#${cadastro.id_cliente}`;
}

/**
 * A modalidade exige um CARD DE COTAÇÃO escolhido para salvar?
 *
 * SÓ CIF EXIGE. Em CIF nós contratamos e pagamos o transporte, então o preço é
 * uma decisão e precisa estar escolhido. Em RETIRA a mercadoria é buscada no
 * balcão e em FOB o cliente contrata — nos dois a escolha já foi feita em outro
 * lugar da tela (o balcão, ou a transportadora do drop / o Motoboy ao lado
 * dele), e o valor cobrado é zero de qualquer forma.
 *
 * POR QUE ISSO PRECISOU VIRAR REGRA
 *   Desde 24/08/2026 a aba Fretes esconde os cards fora de CIF. As guardas de
 *   `freteEscolhidoId` continuaram cobrando um card mesmo assim: em proposta
 *   NOVA o campo nasce vazio, e sem cards na tela o vendedor não tinha como
 *   preencher — recusa sem saída, tanto em RETIRA quanto em FOB.
 *
 * MODALIDADE NULA CONTINUA EXIGINDO, de propósito. É o caso de toda proposta
 * anterior a 18/08/2026 e o comportamento delas não muda aqui: afrouxar a
 * exigência para "não declarado" deixaria salvar sem frete um pedido que a
 * regra antiga barrava, e gravaria zero em `cotacao_frete` por tabela. Só os
 * dois casos em que a tela realmente não oferece card são dispensados.
 */
export function exigeCotacaoEscolhida(modalidade: ModalidadeFrete | null | undefined): boolean {
  return modalidade !== "RETIRA" && modalidade !== "FOB";
}
