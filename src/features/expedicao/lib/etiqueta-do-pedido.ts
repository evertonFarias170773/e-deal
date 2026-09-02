import { abrirEtiqueta, abrirEtiquetaRetirada } from "../services/etiqueta.client";
import { abrirEtiquetaCorreios } from "../services/correios.client";
import type { ModalidadeFrete, TipoFreteNormalizado } from "../types";

/**
 * QUAL ETIQUETA ESTE ENVIO PEDE — regra única.
 *
 * Vivia dentro de `ExpedicaoPage.tsx`, servindo a UMA entrada do menu de ações.
 * Saiu para cá em 01/09/2026 porque a emissão mudou de lugar: passou a viver
 * dentro do `DespacharModal`, junto do despacho que ela documenta. A lógica de
 * escolha NÃO mudou — os três ramos abaixo são os mesmos, na mesma ordem.
 *
 * O QUE MUDOU FOI A ENTRADA. Antes a função lia um `PedidoExpedicao` inteiro, ou
 * seja, o pedido como a LISTA o carregou. Dentro do modal isso estaria errado: o
 * expedidor acabou de trocar a modalidade, o transporte ou os volumes, e a
 * etiqueta tem de sair com o que ele acabou de preencher — não com o que estava
 * na tela antes de ele abrir o modal. Por isso a entrada é explícita, e cada
 * chamador monta a sua a partir da fonte correta.
 *
 * O toast também saiu: a função devolve `abrir()`, e quem chama decide como
 * relatar a falha. Assim ela não depende de hook nenhum.
 */

/** Tudo — e só — o que a escolha do modelo precisa saber. */
export type EntradaEtiqueta = {
  idInt: number;
  /** Modalidade VIGENTE: no modal é a do formulário, na lista é a de `expedicoes`. */
  modalidadeFrete: ModalidadeFrete | null;
  /** Transporte VIGENTE, já normalizado. */
  tipoFrete: TipoFreteNormalizado;
  /** Quantidade de volumes a imprimir. Nula ou zero deixa a rota decidir. */
  volumes: number | null;
  /** `expedicoes.correios_id_prepostagem` — ou a gerada nesta mesma sessão. */
  correiosIdPrepostagem: string | null;
  /** `expedicoes.prepostagem_cancelada_em`: prepostagem cancelada no portal. */
  prepostagemCanceladaEm: string | null;
};

export type AcaoEtiqueta = {
  /** Rótulo do botão — inclui a instrução quando está bloqueada. */
  label: string;
  /**
   * Correios sem prepostagem válida: o rótulo oficial ainda não existe do lado
   * deles, e a rota responde 422. Bloqueia dizendo o que fazer, em vez de sumir
   * (o expedidor ficava sem affordance e sem explicação) ou de cair na 10x15
   * (voltaria a imprimir o papel errado, agora sem ninguém ter escolhido).
   */
  bloqueada: boolean;
  abrir: () => Promise<{ success: boolean; errorMessage?: string }>;
};

export function etiquetaDoPedido(e: EntradaEtiqueta): AcaoEtiqueta {
  // RETIRA NO BALCAO tem etiqueta propria: a 10x15 e documento de envio e
  // imprimia endereco, transportadora e rastreio para um volume que ninguem
  // vai despachar. A modalidade e a fonte — e ela que decide o fluxo de
  // retirada no despacho; `tipo_frete = RETIRA_BALCAO` e consequencia dela,
  // e por isso os dois valem como sinal.
  if (e.modalidadeFrete === "RETIRA" || e.tipoFrete === "RETIRA_BALCAO") {
    return {
      label: "Etiqueta de retirada",
      bloqueada: false,
      abrir: () => abrirEtiquetaRetirada(e.idInt, e.volumes)
    };
  }

  if (e.tipoFrete === "CORREIOS") {
    // Prepostagem cancelada no portal: o rotulo oficial daquele objeto nao
    // vale mais, e a rota dos Correios ainda o entregaria. Enquanto nao houver
    // prepostagem nova, bloqueia — a 10x15 nao substitui o rotulo oficial.
    if (!e.correiosIdPrepostagem || e.prepostagemCanceladaEm) {
      return {
        label: "Etiqueta Correios — gere a prepostagem",
        bloqueada: true,
        abrir: async () => ({ success: false, errorMessage: "Gere a prepostagem antes." })
      };
    }
    return {
      label: "Etiqueta Correios (oficial)",
      bloqueada: false,
      abrir: () => abrirEtiquetaCorreios(e.idInt)
    };
  }

  return {
    label: "Imprimir etiqueta 10x15",
    bloqueada: false,
    abrir: () => abrirEtiqueta(e.idInt, e.volumes)
  };
}
