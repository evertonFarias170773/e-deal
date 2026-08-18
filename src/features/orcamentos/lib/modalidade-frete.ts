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
