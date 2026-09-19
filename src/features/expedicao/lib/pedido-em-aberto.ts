/**
 * O QUE A EXPEDICAO CHAMA DE PEDIDO, E O QUE ELA CHAMA DE PEDIDO EM ABERTO.
 *
 * Estava dentro de `expedicao.service.ts` e saiu para ca em 19/09/2026 sem
 * mudar de valor: o modal de endereco do orcamento precisa da MESMA definicao
 * para avisar quantos outros pedidos aquele endereco serve, e importar o
 * servico inteiro so por uma lista seria carregar o painel junto.
 *
 * `expedicao.service.ts` continua reexportando `STATUS_FUNIL_EXPEDICAO`: quem
 * ja importava de la nao precisa saber que a lista mudou de arquivo.
 */

/**
 * Universo do painel: tudo que está aprovado para produção (is_prd_aprovado)
 * do APROVADO até a entrega. EXPEDICAO em diante é o fluxo oficial da doc
 * FLUXO-OFICIAL-STATUS-PROPOSTAS.md §6.13.
 */
export const STATUS_FUNIL_EXPEDICAO = [
  "APROVADO",
  "LIBERADO",
  "REVISAO ATENDENTE",
  "REVISAO PRODUCAO",
  "EM PRODUCAO",
  "EM IMPRESSAO",
  "EM IMPRESSAO / PENDENTE",
  "EM ACABAMENTO",
  "EM ACABAMENTO / PENDENTE",
  "EXPEDICAO",
  "A RETIRAR",
  "EM TRANSITO",
  "ENTREGUE"
];

/**
 * EM ABERTO = no painel e ainda nao entregue.
 *
 * E a mesma conta que o painel faz linha a linha (`const emAberto = etapa !==
 * "ENTREGUE"`), escrita aqui como filtro para quem precisa perguntar ao banco
 * em vez de percorrer a lista pronta. Nao inventar outro corte: pedido fora do
 * funil nao chega a imprimir etiqueta, e entregue nao imprime de novo.
 */
export const STATUS_PEDIDO_EM_ABERTO = STATUS_FUNIL_EXPEDICAO.filter((status) => status !== "ENTREGUE");
