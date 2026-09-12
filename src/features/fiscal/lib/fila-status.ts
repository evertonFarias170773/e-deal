/**
 * O recorte por STATUS DO PEDIDO na Fila de Faturamento.
 *
 * POR QUE AS OPÇÕES NASCEM DO CONJUNTO, E NÃO DE UM ENUM
 *   `propostas.status_interno` é texto livre. A fila mostrava, em 12/09/2026,
 *   seis valores — ENTREGUE, EM PRODUCAO, EM TRANSITO, EXPEDICAO, CANCELADO e
 *   REVISAO PRODUCAO —, um punhado diante dos que `status_interno` admite. Um
 *   enum cravado no código ofereceria dezenas de opções que devolvem zero, e
 *   deixaria de fora qualquer status que aparecesse depois.
 *
 * POR QUE A CONTAGEM CONSIDERA OS OUTROS FILTROS
 *   Contar sobre a tabela inteira mente para quem já filtrou: escolher
 *   "Entregue (27)" com "Só faturados" ligado e receber 3 é pior do que não ter
 *   contagem nenhuma. O número ao lado de cada opção é quantas linhas AQUELA
 *   escolha vai deixar na tela, agora.
 *
 * O RECORTE SOMA, NUNCA SUBSTITUI. Busca, empresa, "Só faturados" e "Permitir
 *   faturar de novo" continuam valendo por inteiro; o status é mais uma
 *   dimensão sobre o que sobrou delas.
 *
 * ESTE MÓDULO NÃO CONSULTA NADA. A fila já vem inteira do
 *   `getFaturaveisPropostas` — uma consulta, sem `range` e sem `limit` —, e é
 *   por isso que o recorte é no cliente: não há paginação de servidor a
 *   acompanhar, e a contagem por status exigiria uma segunda consulta de
 *   agregação para nada.
 */

/** O mínimo que a linha da fila precisa expor. */
export type LinhaComStatus = { status_interno?: string | null };

export type OpcaoStatusFila = {
  /** O valor cru de `status_interno`, que é o que se compara. */
  valor: string;
  /** O rótulo já humanizado — o MESMO texto que a coluna da lista exibe. */
  rotulo: string;
  quantidade: number;
};

const cru = (item: LinhaComStatus) => String(item.status_interno ?? "").trim();

/**
 * As opções do drop, ordenadas por frequência.
 *
 * `passaNosOutrosFiltros` é o predicado de TODOS os outros filtros da fila —
 * entra por parâmetro para este módulo não precisar conhecer nenhum deles.
 * `humanizar` é `humanizeStatus`, injetado pelo mesmo motivo.
 *
 * Linha sem status não vira opção: "(vazio)" não é escolha útil, e escolher
 * nada é o que a opção padrão já faz.
 */
export function opcoesStatusDaFila<T extends LinhaComStatus>(
  itens: readonly T[],
  passaNosOutrosFiltros: (item: T) => boolean,
  humanizar: (valor: string) => string
): OpcaoStatusFila[] {
  const contagem = new Map<string, number>();
  for (const item of itens) {
    if (!passaNosOutrosFiltros(item)) continue;
    const valor = cru(item);
    if (!valor) continue;
    contagem.set(valor, (contagem.get(valor) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .map(([valor, quantidade]) => ({ valor, quantidade, rotulo: humanizar(valor) }))
    .sort((a, b) => b.quantidade - a.quantidade || a.rotulo.localeCompare(b.rotulo));
}

/**
 * O status que de fato vale agora.
 *
 * O escolhido pode ter saído da fila desde a escolha — o pedido mudou de etapa,
 * ou outro filtro o excluiu, ou o valor veio de um link antigo na URL. Nesses
 * casos o recorte é IGNORADO em vez de devolver lista vazia sem explicação: uma
 * tela vazia por causa de um filtro invisível é o tipo de coisa que se debuga
 * por quinze minutos.
 */
export function statusVigenteDaFila(escolhido: string, opcoes: readonly OpcaoStatusFila[]): string {
  const alvo = String(escolhido ?? "").trim();
  if (!alvo) return "";
  return opcoes.some((o) => o.valor === alvo) ? alvo : "";
}

/** O recorte em si. Vazio devolve tudo — é a opção "Todos os status". */
export function recortarPorStatus<T extends LinhaComStatus>(
  itens: readonly T[],
  statusVigente: string
): T[] {
  if (!statusVigente) return [...itens];
  return itens.filter((item) => cru(item) === statusVigente);
}
