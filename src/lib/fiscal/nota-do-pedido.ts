/**
 * Qual nota fiscal representa o pedido, quando ele tem mais de uma.
 *
 * `notas_fiscais` é 1:N por `id_int`, e isso é desenho: o formato
 * `NFE-{id_int}-{seq}` existe para faturamento parcial, e
 * `conferencia-faturamento` trata segunda nota como AVISO, nunca bloqueio.
 * Há casos reais em produção — o pedido 20370 tem quatro notas, duas delas
 * AUTORIZADAS (nº 1003 em 22/08 e nº 1005 em 23/08).
 *
 * Sem um critério único, cada tela escolhia de um jeito e podiam discordar entre
 * si sobre "a nota do pedido". Este módulo é a resposta única.
 */

/** O mínimo que uma linha de `notas_fiscais` precisa expor para ser avaliada. */
export type NotaCandidata = {
  status?: string | null;
  numero_nf?: string | null;
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
 * MAIS RECENTE POR `data_autorizacao`, com `created_at` como desempate — nessa
 * ordem porque o que importa é quando a SEFAZ autorizou, não quando o rascunho
 * nasceu. Nota sem `data_autorizacao` cai para o fim e nunca ganha de uma que
 * tem data.
 *
 * Extraído de `etiqueta-viewmodel.service.ts` sem alterar uma vírgula do
 * comportamento: a etiqueta continua imprimindo exatamente a mesma nota.
 */
export function escolherNotaAutorizadaDoPedido<T extends NotaCandidata>(
  notas: readonly T[] | null | undefined
): T | null {
  const candidatas = (notas ?? []).filter(
    (nota) =>
      String(nota.status ?? "").toUpperCase() === "AUTORIZADA" &&
      String(nota.numero_nf ?? "").trim() !== ""
  );

  if (candidatas.length === 0) return null;

  return [...candidatas].sort((a, b) => {
    const autorizacaoA = emMilissegundos(a.data_autorizacao);
    const autorizacaoB = emMilissegundos(b.data_autorizacao);
    if (autorizacaoA !== autorizacaoB) return autorizacaoB - autorizacaoA;
    return emMilissegundos(b.created_at) - emMilissegundos(a.created_at);
  })[0];
}

/** Colunas mínimas a pedir no SELECT para alimentar a escolha. */
export const COLUNAS_NOTA_DO_PEDIDO = "status, numero_nf, data_autorizacao, created_at";
