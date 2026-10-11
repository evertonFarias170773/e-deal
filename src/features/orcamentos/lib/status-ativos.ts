/**
 * O STATUS "ATIVOS" DA LISTA DE PEDIDOS (11/10/2026) — a regra, em um lugar só.
 *
 * "Ativos" é o status de trabalho que a lista abre por padrão. Não é um status
 * gravado: é um filtro derivado, e quem o aplica (a consulta do servidor, a
 * conferência da tela e os cards) lê as constantes e as funções daqui.
 *
 * A REGRA
 *   Ativos = todos os status, EXCETO ENTREGUE, EM TRANSITO e CANCELADO, e EXCETO
 *   os pedidos dos modelos Avulso e Encerrados.
 *   - Avulso: `propostas.is_avulso = true`.
 *   - Encerrados: `propostas.encerrado_teste_em` preenchido (pedido de teste
 *     encerrado).
 *   - CANCELADO vale por prefixo (CANCEL*), como os cards já fazem: há um
 *     "cancelada" legado em minúscula.
 *
 * MODELO ESCOLHIDO VENCE A EXCLUSÃO DE MODELO
 *   Se o usuário escolhe um modelo no filtro Modelo (inclusive Avulso ou
 *   Encerrados), aparecem os pedidos daquele modelo — ainda sem ENTREGUE,
 *   EM TRANSITO e CANCELADO. Só a exclusão de modelo cai; a de status fica.
 *
 * ATIVOS SÓ REMOVE LINHAS
 *   O filtro nunca acrescenta pedido: a lista com "Ativos" é a lista de "Todos
 *   status" menos o que a regra tira. Por isso o pedido sem status não é
 *   tratado aqui — a lista padrão já o esconde por conta própria, e com um card
 *   ligado ele segue como o card sempre tratou.
 *
 * COM TEXTO NA BUSCA, ATIVOS NÃO RECORTA NADA
 *   Quem procura um pedido pelo número ou pelo nome espera achá-lo, entregue ou
 *   não, avulso ou não (mesma regra que a lista já seguia com "Todos status":
 *   ENTREGUE volta e Encerrados são incluídos na busca). Com texto, "Ativos" se
 *   comporta como "Todos status".
 */

/** Valor do filtro Status que liga a visão de trabalho. Fica na URL como `status=ATIVOS`. */
export const STATUS_ATIVOS = "ATIVOS";
/** Valor do filtro Status que não recorta por status. */
export const STATUS_TODOS = "TODOS";
/** Status com que a lista abre. */
export const STATUS_PADRAO_DA_LISTA = STATUS_ATIVOS;
/** Valor do filtro Modelo que não escolhe modelo. */
export const MODELO_TODOS = "TODOS_MODELOS";

/** Status gravados que saem dos Ativos (CANCELADO vale por prefixo, abaixo). */
export const STATUS_FORA_DOS_ATIVOS = ["ENTREGUE", "EM TRANSITO", "CANCELADO"] as const;
const PREFIXO_CANCELADO = "CANCEL";
const STATUS_FORA_POR_NOME = STATUS_FORA_DOS_ATIVOS.filter((status) => !status.startsWith(PREFIXO_CANCELADO));

export function statusEhAtivos(status: string | null | undefined): boolean {
  return status === STATUS_ATIVOS;
}

/**
 * O status escolhido é uma escolha de status de verdade? Nem "Todos status" nem
 * "Ativos" são: os dois são visões gerais, e por isso não ligam a busca ampla
 * (que ignora o período) — a lista abre em Ativos e segue no período.
 */
export function statusEhEspecifico(status: string | null | undefined): boolean {
  return Boolean(status) && status !== STATUS_TODOS && status !== STATUS_ATIVOS;
}

/** "Ativos" só recorta sem texto na busca. */
export function ativosValem(filtros: { status: string | null | undefined; temBusca: boolean }): boolean {
  return statusEhAtivos(filtros.status) && !filtros.temBusca;
}

/** O status (texto cru do banco) sai dos Ativos? Status vazio fica. */
export function statusSaiDosAtivos(statusInterno: string | null | undefined): boolean {
  const status = String(statusInterno ?? "").trim().toUpperCase();
  if (!status) return false;
  return status.startsWith(PREFIXO_CANCELADO) || STATUS_FORA_POR_NOME.includes(status as (typeof STATUS_FORA_POR_NOME)[number]);
}

export function modeloFoiEscolhido(modelo: string | null | undefined): boolean {
  return Boolean(modelo) && modelo !== MODELO_TODOS;
}

/** A parte do pedido que a regra lê. */
export type PedidoParaAtivos = {
  statusInterno: string | null | undefined;
  isAvulsoRaw: boolean | null | undefined;
  encerradoTesteEm?: string | null;
};

/**
 * O pedido passa pelos Ativos? `true` quando a regra não vale (outro status ou
 * texto na busca). A tela e os cards usam esta função; o servidor aplica a
 * mesma regra pelas condições de `condicoesDosAtivosParaOServidor`.
 */
export function passaAtivos(
  pedido: PedidoParaAtivos,
  filtros: { status: string | null | undefined; modelo: string | null | undefined; temBusca: boolean }
): boolean {
  if (!ativosValem(filtros)) return true;
  if (statusSaiDosAtivos(pedido.statusInterno)) return false;
  if (!modeloFoiEscolhido(filtros.modelo) && (pedido.isAvulsoRaw === true || Boolean(pedido.encerradoTesteEm))) return false;
  return true;
}

/**
 * As mesmas exclusões, como condições do PostgREST para `.or()`. Cada texto é
 * uma chamada de `.or()` (as chamadas se somam com E).
 *   - `status`: o status vazio fica; CANCEL* e os da lista saem.
 *   - `modelo`: `null` quando o modelo foi escolhido (a escolha vence); senão
 *     tira os avulsos. Os encerrados já saem pela visibilidade da lista
 *     (`encerradosTeste`, "OCULTAR" sem busca e sem o modelo Encerrados).
 */
export function condicoesDosAtivosParaOServidor(filtros: { modelo: string | null | undefined }): {
  status: string;
  modelo: string | null;
} {
  const listaFora = STATUS_FORA_POR_NOME.map((status) => `"${status}"`).join(",");
  return {
    status: `status_interno.is.null,and(status_interno.not.ilike.${PREFIXO_CANCELADO}*,status_interno.not.in.(${listaFora}))`,
    modelo: modeloFoiEscolhido(filtros.modelo) ? null : "is_avulso.is.null,is_avulso.eq.false"
  };
}
