/**
 * A HORA do prazo de entrega, derivada da categoria de frete.
 *
 * POR QUE UMA TABELA, E NAO UMA CONTA
 *   A hora nao se calcula: ela e o horario de corte de cada transporte, dado
 *   pela operacao. Correios fecha a coleta as 15h, a Veppo as 16h, o rodoviario
 *   as 14h. Nao ha regra que derive isso — ha uma lista que alguem decidiu.
 *
 * CATEGORIA DESCONHECIDA DEVOLVE NULL, E ISSO E DE PROPOSITO
 *   Nula, vazia ou fora da lista devolve `null`, que a tela mostra como campo
 *   VAZIO para o ADM preencher. Chutar um horario aqui seria pior do que nao
 *   preencher: o expedidor confiaria numa hora que ninguem prometeu.
 *
 *   Isso nao e caso raro hoje. Em 08/09/2026, `propostas.categoria_frete` esta
 *   preenchida em 39 das 9.093 propostas, e em NENHUM dos pedidos multi-setor.
 *   Ou seja: por enquanto a hora automatica e a excecao, e o campo em branco e
 *   o caminho comum. Conforme a Expedicao for classificando, isso se inverte
 *   sozinho — sem mexer aqui.
 *
 * O VOCABULARIO E O MESMO DE `CATEGORIAS_FRETE`
 *   As sete chaves abaixo sao exatamente as sete de
 *   src/features/orcamentos/lib/categoria-frete.ts. Se uma categoria nova
 *   nascer la, ela cai em `null` aqui ate alguem decidir o horario dela — o que
 *   e o comportamento certo: categoria nova sem horario definido nao deve
 *   herdar o de outra.
 */

/** Horario de corte por categoria de frete. Formato HH:MM, como o input espera. */
export const HORA_POR_CATEGORIA_FRETE: Readonly<Record<string, string>> = {
  CORREIOS: "15:00",
  VEPPO: "16:00",
  MOTOBOY: "15:30",
  AEREO: "15:00",
  RODOVIARIO: "14:00",
  RETIRA: "16:00",
  EXTRAS: "15:00"
};

/**
 * A hora de corte da categoria, ou `null` quando nao ha uma definida.
 *
 * Funcao pura: normaliza espaco e caixa, e nao inventa nada para o que nao
 * estiver na tabela.
 */
export function horaPorCategoriaFrete(categoria: string | null | undefined): string | null {
  const chave = String(categoria ?? "").trim().toUpperCase();
  if (!chave) return null;
  return HORA_POR_CATEGORIA_FRETE[chave] ?? null;
}
