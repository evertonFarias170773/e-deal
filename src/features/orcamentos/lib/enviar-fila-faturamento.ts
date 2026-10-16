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
 * TAMBEM EM APROVADO E LIBERADO (15/10/2026)
 *   Pedido com a cobranca confirmada (E-FATURADO, por exemplo) vira APROVADO pelo
 *   gatilho financeiro e nunca passa por REVISAO ATENDENTE: ficava sem caminho para
 *   a Fila (23135, 23714). Em APROVADO e LIBERADO o envio vale com as mesmas duas
 *   flags desligadas e, alem delas, SEM OS (`propostas_os` / `propostas_os_setores`),
 *   SEM NF-e ou NFS-e autorizada de producao e SEM `faturado_fora_em`. Essas tres
 *   so o servidor sabe; a tela confere o que tem (status, flags, faturado fora).
 *   Em REVISAO ATENDENTE a regra e a de antes, sem mudar nada.
 *
 * NAO HA "TIRAR DA FILA": nada no sistema desliga `libera_nf`. O pedido sai da Fila
 * ao ser faturado (ou pela acao "Nota emitida no sistema antigo").
 */

export const STATUS_PARA_ENVIAR_A_FILA = "REVISAO ATENDENTE";

/** Status em que o envio tambem vale, com as conferencias a mais (OS, nota, faturado fora). */
export const STATUS_APROVADOS_PARA_ENVIAR_A_FILA: readonly string[] = ["APROVADO", "LIBERADO"];

/** `os_status_log.origem` das linhas gravadas por esta acao. */
export const ORIGEM_LOG_ENVIO_FILA_FATURAMENTO = "ENVIO_FILA_FATURAMENTO";

export const CODIGO_FORA_DO_STATUS = "FORA_DE_REVISAO_ATENDENTE";
export const CODIGO_JA_NA_PRODUCAO = "JA_NA_PRODUCAO";
export const CODIGO_TEM_OS = "TEM_OS";
export const CODIGO_NOTA_EMITIDA_NO_ENVIO = "NOTA_EMITIDA";
export const CODIGO_FATURADO_FORA = "FATURADO_NO_SISTEMA_ANTIGO";

export type EstadoDoPedido = {
  statusInterno: string | null | undefined;
  liberaNf: boolean | null | undefined;
  isPrdAprovado: boolean | null | undefined;
};

/**
 * O que so o servidor le, para APROVADO e LIBERADO. Ausente = nao conferido: a TELA
 * passa sem isso (mostra o item) e o servidor sempre passa.
 */
export type ConferenciasDoEnvio = {
  temOs?: boolean;
  /** Rotulos das notas autorizadas de producao ("NF-e 7540"); vazio = nenhuma. */
  notasEmitidas?: readonly string[];
  faturadoForaEm?: string | null;
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
 *   2. fora de REVISAO ATENDENTE, APROVADO e LIBERADO -> recusa;
 *   3. `libera_nf` ja ligada -> idempotente (nada a gravar);
 *   4. REVISAO ATENDENTE com as duas flags desligadas -> envia (como antes);
 *   5. APROVADO ou LIBERADO: recusa com OS, com nota autorizada ou com faturado no
 *      sistema antigo; senao envia.
 */
export function decidirEnvioParaFila(estado: EstadoDoPedido & ConferenciasDoEnvio): DecisaoDoEnvio {
  const status = normalizar(estado.statusInterno);
  const aprovado = STATUS_APROVADOS_PARA_ENVIAR_A_FILA.includes(status);

  if (estado.isPrdAprovado === true) {
    return {
      acao: "recusar",
      code: CODIGO_JA_NA_PRODUCAO,
      message: "O pedido já está liberado para a produção. Quem está na produção já está na Fila de Faturamento."
    };
  }
  if (status !== STATUS_PARA_ENVIAR_A_FILA && !aprovado) {
    return {
      acao: "recusar",
      code: CODIGO_FORA_DO_STATUS,
      message: `Só dá para enviar à Fila de Faturamento um pedido em ${STATUS_PARA_ENVIAR_A_FILA}, APROVADO ou LIBERADO. Este está em ${status || "sem status"}.`
    };
  }
  if (estado.liberaNf === true) return { acao: "idempotente" };
  if (!aprovado) return { acao: "enviar" };

  if (estado.faturadoForaEm) {
    return { acao: "recusar", code: CODIGO_FATURADO_FORA, message: "O pedido está marcado como faturado no sistema antigo. Desfaça a marca (menu da linha em Pedidos) antes de enviar à Fila." };
  }
  if (estado.temOs === true) {
    return { acao: "recusar", code: CODIGO_TEM_OS, message: "O pedido já tem OS na produção: ele entra na Fila de Faturamento pela liberação para a produção, não por aqui." };
  }
  if (estado.notasEmitidas && estado.notasEmitidas.length > 0) {
    return { acao: "recusar", code: CODIGO_NOTA_EMITIDA_NO_ENVIO, message: `O pedido já tem nota fiscal emitida (${estado.notasEmitidas.join(", ")}). Não há o que faturar pela Fila.` };
  }
  return { acao: "enviar" };
}

/** O usuario da tela: o ADM vem do CADASTRO (`isAdmNoCadastro`), nao do perfil. */
type UsuarioDaTela = { isAdmNoCadastro?: boolean | null } | null | undefined;

/**
 * O item aparece no menu? So para ADM do CADASTRO (`usuarios.is_admin` ou
 * `is_super_adm`, lido de `user.isAdmNoCadastro`) — o MESMO teste da rota e do
 * "Marcar como entregue" (16/10/2026; antes a tela usava o perfil e divergia da rota).
 * E so onde o envio vale, com o que a tela sabe (OS e nota so o servidor confere).
 * Depois de enviado, o item some (`libera_nf` ja ligada). Esconder nao protege nada:
 * quem tranca e a rota.
 */
export function podeVerEnviarParaFila(usuario: UsuarioDaTela, estado: EstadoDoPedido & ConferenciasDoEnvio): boolean {
  const adm = usuario?.isAdmNoCadastro === true;
  return adm && decidirEnvioParaFila(estado).acao === "enviar";
}
