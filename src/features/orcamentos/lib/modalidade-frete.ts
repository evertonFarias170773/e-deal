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
 * FASE DE ORÇAMENTO — antes de a proposta ser liberada.
 *
 * Até 23/09/2026 isto se chamava `podeEditarModalidade` e TRAVAVA a modalidade
 * e a transportadora a partir de LIBERADO. A trava saiu: modalidade e
 * transportadora se trocam em qualquer status (decisão do dono). O que a fase
 * ainda decide é outra coisa — DE ONDE VEM O FRETE quando a declaração NÃO
 * mudou nesta edição:
 *
 *   - na fase de orçamento, do card cotado, como sempre;
 *   - depois dela, do `valor_frete` GRAVADO. É onde moram o valor negociado e a
 *     recotação da Expedição, que mudam o frete sem tocar `cotacao_frete`.
 *     Regravar o card a cada Salvar desfazia essas correções.
 *
 * Quando a declaração MUDA, o frete sai da declaração nova em qualquer fase —
 * ver `freteSeRecalculaNaGravacao`.
 *
 * `status_interno` pode vir composto de dois jeitos, e os dois ainda são fase de
 * orçamento: com barra ("NOVO / EM ARTE") e com sublinhado
 * ("NOVO_ARTE_APROVADA", "AGUARDANDO_ARTE_APROVADA", gravados pelo motor de
 * status). O sublinhado não era reconhecido — era o que travava a 22448.
 * Proposta nova (sem status gravado) está na fase de orçamento.
 */
const STATUS_FASE_ORCAMENTO = ["NOVO", "AGUARDANDO"];

export function estaNaFaseDeOrcamento(statusInterno: string | null | undefined): boolean {
  const bruto = (statusInterno ?? "").trim();
  if (bruto === "") return true;
  const base = bruto.split("/")[0].trim().toUpperCase().replace(/_ARTE_APROVADA$/, "");
  return STATUS_FASE_ORCAMENTO.includes(base);
}

/**
 * Esta gravação recalcula o frete a partir da declaração da tela?
 *
 * Sim na fase de orçamento, e sim em qualquer fase quando a declaração MUDOU
 * nesta edição — modalidade, transportadora, motoboy ou card escolhido. Fora
 * disso o frete gravado fica. Um predicado só, usado pela tela (resumo) e pelo
 * `saveProposta` (o que grava), para os dois não divergirem.
 *
 * POR QUE A MUDANÇA É DITA PELA TELA E NÃO DEDUZIDA NO SERVIÇO
 *   A tela sabe o que carregou e o que o usuário trocou. O serviço só veria o
 *   banco e o formulário, e compararia um card recotado ou uma correção feita
 *   pela Expedição com o que a tela ainda mostra — um falso "mudou" regravaria
 *   o frete negociado com o valor do card, que é o defeito da 8475ff3.
 *   Formulário velho que não mexeu no frete manda "não mudou", e nada é
 *   regravado.
 */
export function freteSeRecalculaNaGravacao(entrada: {
  faseDeOrcamento: boolean;
  declaracaoMudou: boolean;
}): boolean {
  return entrada.faseDeOrcamento || entrada.declaracaoMudou;
}

/**
 * Texto da aba Fretes depois da liberação, para tela e serviço falarem igual.
 * Não é trava: explica o que a troca faz.
 */
export const AVISO_TROCA_FRETE_APOS_LIBERACAO =
  "Trocar a modalidade, a transportadora ou o frete escolhido recalcula o frete e o total. " +
  "Se a proposta já tem pagamento e o total subir, a diferença aparece na aba Pagamentos para " +
  "cobrança manual, e a proposta fica aguardando essa cobrança. Pedido em produção continua na produção.";

/**
 * A modalidade cobra frete do cliente?
 *
 * DUAS delas não cobram, e pelo mesmo motivo de fundo: NÓS não contratamos o
 * transporte. Em FOB quem contrata e paga é o cliente; em RETIRA não há
 * transporte nenhum — a mercadoria é buscada no balcão. `CIF` e a ausência de
 * modalidade (proposta anterior a 18/08/2026) cobram o valor cotado.
 *
 * POR QUE RETIRA ENTROU DEPOIS (04/09/2026)
 *   A regra nasceu só com FOB, e RETIRA ficou "mantendo o valor cotado". Só que
 *   a aba Fretes esconde os cards em RETIRA sem desmarcar o que já estava
 *   escolhido: trocar CIF → RETIRA deixava a cotação anterior viva por baixo, e
 *   ela seguia sendo cobrada. Foi a proposta 21699 — RETIRA no topo, SEDEX de
 *   R$ 17,43 no total. Manter a modalidade e o dinheiro em desacordo é
 *   exatamente o que este módulo existe para impedir.
 *
 * Um predicado só, usado pelas duas funções abaixo, para elas não divergirem.
 */
export function modalidadeCobraFrete(modalidade: ModalidadeFrete | null | undefined): boolean {
  return modalidade !== "FOB" && modalidade !== "RETIRA";
}

/**
 * Valor do frete que a proposta cobra, dada a modalidade.
 *
 * Em FOB e em RETIRA não há frete a cobrar, qualquer que seja a cotação em tela
 * — ver `modalidadeCobraFrete`. `CIF` e a ausência de modalidade mantêm o valor
 * cotado.
 */
export function valorFreteEfetivo(
  valorCotado: number | null | undefined,
  modalidade: ModalidadeFrete | null | undefined
): number {
  if (!modalidadeCobraFrete(modalidade)) return 0;
  const numero = Number(valorCotado);
  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Lista de fretes com a modalidade já aplicada, para alimentar `calculateResumo`
 * sem que ele precise conhecer modalidade. Só a opção ESCOLHIDA é zerada — as
 * demais seguem com o valor cotado, porque continuam servindo de referência na
 * tela. Quando a modalidade cobra frete devolve o array original, sem cópia.
 */
export function aplicarModalidadeNosFretes(
  fretes: PropostaFrete[],
  modalidade: ModalidadeFrete | null | undefined
): PropostaFrete[] {
  if (modalidadeCobraFrete(modalidade)) return fretes;
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

/** Nome do transporte em RETIRA — o mesmo texto que o salvamento sempre usou para balcão. */
export const NOME_TRANSPORTE_RETIRA = "RETIRADA";

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
 * RETIRA (15/09/2026): o nome é "RETIRADA", qualquer que seja o serviço cotado.
 *   A cotação da tela não é descartada quando o vendedor escolhe RETIRA — o card
 *   que estava marcado (quase sempre o SEDEX pré-selecionado) sobrevive escondido
 *   e chegava ao banco como o transporte do pedido. A 22186 nasceu RETIRA com
 *   "SEDEX" em `frete_escolhido` e em `cotacao_frete.servico`, e a coluna FRETE da
 *   Expedição exibia SEDEX num pedido que o cliente busca no balcão. Mesma
 *   disciplina do FOB: o rótulo segue a modalidade, não a cotação.
 *
 * CIF e modalidade nula devolvem o serviço cotado, sem alteração de comportamento.
 */
export function nomeTransporteEfetivo(
  servicoCotado: string | null | undefined,
  modalidade: ModalidadeFrete | null | undefined,
  nomeTransportadora: string | null | undefined
): string {
  if (modalidade === "RETIRA") return NOME_TRANSPORTE_RETIRA;
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
