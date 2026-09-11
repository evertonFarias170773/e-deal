/**
 * Qual nota fiscal representa o pedido, quando ele tem mais de uma.
 *
 * `notas_fiscais` é 1:N por `id_int`, e isso é desenho: o formato
 * `NFE-{id_int}-{seq}` existe para faturamento parcial, e
 * `conferencia-faturamento` trata segunda nota como AVISO, nunca bloqueio.
 *
 * O exemplo canônico deste módulo era o pedido 20370, que tem duas linhas
 * AUTORIZADAS (nº 1003 e nº 1005). Ele DEIXOU DE VALER em 11/09/2026, quando o
 * ambiente entrou no critério: as duas saíram em HOMOLOGAÇÃO, pela empresa 2
 * (IDEAL BIRÔ), que até hoje está em `ambiente_nfe = homologacao`. Para esta
 * função, portanto, o 20370 passou a ser pedido SEM nota. Hoje nenhum pedido
 * tem duas autorizadas de produção — o desempate abaixo continua no lugar
 * porque faturamento parcial em produção é questão de tempo, não de hipótese.
 *
 * Sem um critério único, cada tela escolhia de um jeito e podiam discordar entre
 * si sobre "a nota do pedido". Este módulo é a resposta única.
 */

/** O mínimo que uma linha de `notas_fiscais` precisa expor para ser avaliada. */
export type NotaCandidata = {
  status?: string | null;
  numero_nf?: string | null;
  ambiente?: string | null;
  data_autorizacao?: string | null;
  created_at?: string | null;
};

const emMilissegundos = (valor: unknown): number => Date.parse(String(valor ?? "")) || 0;

/**
 * A nota AUTORIZADA que vale para o pedido, ou `null` quando não há nenhuma.
 *
 * SÓ AUTORIZADA — nota pendente, em erro ou cancelada não representa o pedido
 * perante ninguém. Quem precisa saber que existe rascunho deve olhar a lista
 * inteira, não esta função.
 *
 * SÓ COM NÚMERO. O pedido 20925 tem uma linha `AUTORIZADA` com `numero_nf`
 * nulo: o número é o que a conferência e a etiqueta leem, e uma autorizada sem
 * ele não serve para nada. Sem este filtro, a escolha podia parar nela e
 * esconder uma nota boa do mesmo pedido.
 *
 * SÓ DE PRODUÇÃO. Nota autorizada em homologação é teste: não tem valor fiscal,
 * não acompanha mercadoria, não vira número de boleto. `notas_fiscais.ambiente`
 * é `NOT NULL DEFAULT 'homologacao'` e o vocabulário é o de
 * `@/features/fiscal/services/ambiente-fiscal` — só `producao` e `homologacao`,
 * minúsculas. Ausente ou vazio NÃO produz nota emitida: o default do banco já
 * faz homologação ser a resposta silenciosa, e adivinhar produção a partir de
 * um campo em branco erraria no lado caro. O tipo aceita `null` por defesa; o
 * banco não tem uma linha nessa situação.
 *
 * MAIS RECENTE POR `data_autorizacao`, com `created_at` como desempate — nessa
 * ordem porque o que importa é quando a SEFAZ autorizou, não quando o rascunho
 * nasceu. Nota sem `data_autorizacao` cai para o fim e nunca ganha de uma que
 * tem data.
 *
 * PARENTE PRÓXIMO, DE PROPÓSITO SEPARADO: `isNotaImpeditiva`
 * (`@/features/cobrancas/cancelamento-elegibilidade`) também exige AUTORIZADA
 * de produção, mas NÃO exige número, e é predicado sobre uma nota só. Uma
 * autorizada de produção sem número ainda impede cancelar cobrança, embora não
 * sirva como "a nota do pedido". Unificar as duas apagaria essa diferença.
 */
export function escolherNotaAutorizadaDoPedido<T extends NotaCandidata>(
  notas: readonly T[] | null | undefined
): T | null {
  const candidatas = (notas ?? []).filter(
    (nota) =>
      String(nota.status ?? "").toUpperCase() === "AUTORIZADA" &&
      String(nota.numero_nf ?? "").trim() !== "" &&
      String(nota.ambiente ?? "").trim().toUpperCase() === "PRODUCAO"
  );

  if (candidatas.length === 0) return null;

  return [...candidatas].sort((a, b) => {
    const autorizacaoA = emMilissegundos(a.data_autorizacao);
    const autorizacaoB = emMilissegundos(b.data_autorizacao);
    if (autorizacaoA !== autorizacaoB) return autorizacaoB - autorizacaoA;
    return emMilissegundos(b.created_at) - emMilissegundos(a.created_at);
  })[0];
}

/**
 * Colunas mínimas a pedir no SELECT para alimentar a escolha.
 *
 * Use a constante, não a lista literal. Quem escreveu as colunas à mão ficou
 * sem `ambiente` quando ele entrou no critério — e uma nota boa vinda sem o
 * campo é lida como se não fosse de produção, o que apaga a nota da tela em
 * silêncio, sem erro nenhum.
 */
export const COLUNAS_NOTA_DO_PEDIDO = "status, numero_nf, ambiente, data_autorizacao, created_at";
