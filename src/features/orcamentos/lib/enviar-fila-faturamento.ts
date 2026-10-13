/**
 * "ENVIAR PARA FILA DE FATURAMENTO" (13/10/2026) — a regra, em um lugar so.
 *
 * POR QUE EXISTE
 *   Alguns pedidos so precisam da nota (NFS-e) e depois sao marcados como entregues,
 *   sem passar por Producao nem Expedicao. Ate aqui a unica porta para a Fila de
 *   Faturamento era "Liberar para Producao", que liga `libera_nf` junto com
 *   `is_prd_aprovado` — entrar na Fila implicava entrar no painel de Producao.
 *
 * A REGRA
 *   So ADM, so em pedido REVISAO ATENDENTE com `libera_nf` desligada e
 *   `is_prd_aprovado` desligada. Grava APENAS `libera_nf = true`. Nao liga
 *   `is_prd_aprovado`, nao muda `status_interno`, nao toca em `liberado_producao_em`,
 *   cobrancas nem boletim. O pedido aparece na Fila (que le so `libera_nf`) e nao
 *   aparece na Producao nem na Expedicao (que exigem `is_prd_aprovado`).
 *   Repetir no pedido ja enviado nao grava nada.
 *
 * NAO HA "TIRAR DA FILA": nada no sistema desliga `libera_nf`. O pedido sai da Fila
 * ao ser faturado (ou pela acao "Nota emitida no sistema antigo").
 */

export const STATUS_PARA_ENVIAR_A_FILA = "REVISAO ATENDENTE";

/** `os_status_log.origem` das linhas gravadas por esta acao. */
export const ORIGEM_LOG_ENVIO_FILA_FATURAMENTO = "ENVIO_FILA_FATURAMENTO";

export const CODIGO_FORA_DO_STATUS = "FORA_DE_REVISAO_ATENDENTE";
export const CODIGO_JA_NA_PRODUCAO = "JA_NA_PRODUCAO";

export type EstadoDoPedido = {
  statusInterno: string | null | undefined;
  liberaNf: boolean | null | undefined;
  isPrdAprovado: boolean | null | undefined;
};

export type DecisaoDoEnvio =
  | { acao: "enviar" }
  | { acao: "idempotente" }
  | { acao: "recusar"; code: string; message: string };

const normalizar = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase();

/**
 * O pedido esta na Fila de Faturamento SEM estar na producao? E o estado que esta
 * acao produz: REVISAO ATENDENTE, `libera_nf` ligada, `is_prd_aprovado` desligada.
 * O "Marcar como entregue" aceita este estado (ver `lib/marcar-entregue.ts`).
 */
export function estaNaFilaSemProducao(estado: EstadoDoPedido): boolean {
  return normalizar(estado.statusInterno) === STATUS_PARA_ENVIAR_A_FILA && estado.liberaNf === true && estado.isPrdAprovado !== true;
}

/**
 * O que fazer, dado o que o banco diz agora. Pura.
 *   1. flag de producao ligada -> recusa (o pedido ja esta na producao, e na Fila);
 *   2. fora de REVISAO ATENDENTE -> recusa;
 *   3. REVISAO ATENDENTE com `libera_nf` ja ligada -> idempotente (nada a gravar);
 *   4. REVISAO ATENDENTE com as duas flags desligadas -> envia.
 */
export function decidirEnvioParaFila(estado: EstadoDoPedido): DecisaoDoEnvio {
  const status = normalizar(estado.statusInterno);

  if (estado.isPrdAprovado === true) {
    return {
      acao: "recusar",
      code: CODIGO_JA_NA_PRODUCAO,
      message: "O pedido já está liberado para a produção. Quem está na produção já está na Fila de Faturamento."
    };
  }
  if (status !== STATUS_PARA_ENVIAR_A_FILA) {
    return {
      acao: "recusar",
      code: CODIGO_FORA_DO_STATUS,
      message: `Só dá para enviar à Fila de Faturamento um pedido em ${STATUS_PARA_ENVIAR_A_FILA}. Este está em ${status || "sem status"}.`
    };
  }
  if (estado.liberaNf === true) return { acao: "idempotente" };
  return { acao: "enviar" };
}

type UsuarioDaTela = { isSuperAdmin?: boolean | null; isAdmin?: boolean | null } | null | undefined;

/**
 * O item aparece no menu? So para ADM (o mesmo teste do "Marcar como entregue") e so
 * onde o envio vale. Depois de enviado, o item some (`libera_nf` ja ligada). Esconder
 * nao protege nada: quem tranca e a rota.
 */
export function podeVerEnviarParaFila(usuario: UsuarioDaTela, estado: EstadoDoPedido): boolean {
  const adm = Boolean(usuario?.isSuperAdmin || usuario?.isAdmin);
  return adm && decidirEnvioParaFila(estado).acao === "enviar";
}
