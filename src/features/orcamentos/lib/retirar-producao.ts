/**
 * "RETIRAR DA PRODUCAO" (13/10/2026) — a regra, em um lugar so.
 *
 * O PROBLEMA QUE ISTO FECHA
 *   A retirada gravava so `is_prd_aprovado = false` e deixava o `status_interno`
 *   como estava. O pedido ficava em REVISAO PRODUCAO sem a flag: fora da fila de
 *   Producao, com a impressao da OS dando 409, e sem saida pela tela, porque
 *   "Liberar para Producao" so existe em REVISAO ATENDENTE. Quatro pedidos ficaram
 *   assim em oito dias (23186, 23470, 23381, 23458).
 *
 * A REGRA
 *   Retirar = voltar para o atendente: `is_prd_aprovado = false` E `status_interno =
 *   'REVISAO ATENDENTE'`, juntos, na mesma linha — a MESMA gravacao do "Devolver
 *   para o atendente" (`PAYLOAD_DEVOLUCAO_AO_ATENDENTE`, usado pelos dois).
 *   So vale em REVISAO PRODUCAO e sem OS: dai em diante (EM PRODUCAO ou alem, ou
 *   com `propostas_os` / `propostas_os_setores`) a devolucao e feita pela producao.
 *   Repetir com o pedido ja em REVISAO ATENDENTE nao grava nada.
 */

export const STATUS_RETIRAVEL = "REVISAO PRODUCAO";
export const STATUS_APOS_RETIRAR = "REVISAO ATENDENTE";

/**
 * A gravacao da devolucao ao atendente. UMA definicao, usada por
 * `devolverPropostaParaRevisaoAtendente` (tela de Pedidos da producao) e pela
 * retirada. `liberado_producao_em` fica de fora de proposito: o carimbo e o que
 * sobra da passagem pela fila (ver o comentario das duas funcoes).
 */
export const PAYLOAD_DEVOLUCAO_AO_ATENDENTE = {
  is_prd_aprovado: false,
  status_interno: STATUS_APOS_RETIRAR
} as const;

/** Status de EM PRODUCAO em diante: a devolucao desses pedidos e da producao. */
export const STATUS_DA_PRODUCAO_EM_DIANTE: readonly string[] = [
  "EM PRODUCAO",
  "EM IMPRESSAO",
  "EM IMPRESSAO / PENDENTE",
  "EM ACABAMENTO",
  "EM ACABAMENTO / PENDENTE",
  "EXPEDICAO",
  "A RETIRAR",
  "EM TRANSITO",
  "RECEBIDO",
  "ENTREGUE"
];

/** `os_status_log.origem` das linhas gravadas por esta acao. */
export const ORIGEM_LOG_RETIRAR_PRODUCAO = "RETIRAR_PRODUCAO";

export const CODIGO_DEVOLUCAO_PELA_PRODUCAO = "DEVOLUCAO_PELA_PRODUCAO";
export const CODIGO_FORA_DA_PRODUCAO = "FORA_DA_PRODUCAO";

export type DecisaoDaRetirada =
  | { acao: "retirar" }
  | { acao: "idempotente" }
  | { acao: "recusar"; code: string; message: string };

const normalizar = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase();

/**
 * O que fazer com o pedido, dado o que o banco diz agora. Pura: quem le o banco e
 * quem grava e a rota.
 *   1. ja em REVISAO ATENDENTE com a flag desligada -> idempotente (nada a gravar);
 *   2. de EM PRODUCAO em diante -> recusa: a devolucao e da producao;
 *   3. com OS ou setores -> recusa, pelo mesmo motivo;
 *   4. REVISAO PRODUCAO (ou REVISAO ATENDENTE com a flag ainda ligada, que so limpa
 *      a flag) -> retira;
 *   5. qualquer outro status (ainda nao esta na producao) -> recusa.
 */
export function decidirRetirada(entrada: {
  statusInterno: string | null | undefined;
  isPrdAprovado: boolean | null | undefined;
  temOs: boolean;
  temSetores: boolean;
}): DecisaoDaRetirada {
  const status = normalizar(entrada.statusInterno);

  if (status === STATUS_APOS_RETIRAR && entrada.isPrdAprovado !== true) return { acao: "idempotente" };

  if (STATUS_DA_PRODUCAO_EM_DIANTE.includes(status)) {
    return {
      acao: "recusar",
      code: CODIGO_DEVOLUCAO_PELA_PRODUCAO,
      message: `O pedido está em ${status}: a devolução dele é feita pela produção, não por aqui.`
    };
  }

  if (entrada.temOs || entrada.temSetores) {
    return {
      acao: "recusar",
      code: CODIGO_DEVOLUCAO_PELA_PRODUCAO,
      message: "O pedido já tem OS na produção: a devolução dele é feita pela produção, não por aqui."
    };
  }

  if (status === STATUS_RETIRAVEL || status === STATUS_APOS_RETIRAR) return { acao: "retirar" };

  return {
    acao: "recusar",
    code: CODIGO_FORA_DA_PRODUCAO,
    message: `Só dá para retirar da produção um pedido em ${STATUS_RETIRAVEL}. Este está em ${status || "sem status"}.`
  };
}

/**
 * O item "Retirar da Producao" aparece no menu? So onde a retirada vale: pedido em
 * REVISAO PRODUCAO com a flag ligada. Em EM PRODUCAO ou alem o item some em vez de
 * oferecer uma acao que o servidor recusaria. A permissao e a do chamador.
 */
export function podeVerRetirarDaProducao(entrada: {
  statusInterno: string | null | undefined;
  isPrdAprovado: boolean | null | undefined;
}): boolean {
  return entrada.isPrdAprovado === true && normalizar(entrada.statusInterno) === STATUS_RETIRAVEL;
}
