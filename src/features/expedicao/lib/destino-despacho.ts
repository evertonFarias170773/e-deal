import type { TipoFreteNormalizado } from "../types";

/**
 * Status para onde o despacho leva o pedido.
 *
 * TRÊS SAÍDAS DESDE 02/09/2026 (Etapa 7).
 *
 *   RETIRADA                  → `A RETIRAR`, byte a byte como antes;
 *   TRANSPORTADORA / MOTOBOY  → NÃO TRANSICIONA. O pedido segue em
 *                               `EXPEDICAO`, agora com `data_despacho`
 *                               preenchida e `coletado_em` nula — é o estado
 *                               derivado "aguardando coleta". O volume está
 *                               rotulado, na casa, esperando o carro; dizer
 *                               `EM TRANSITO` ali era mentira, ninguém
 *                               transportou nada ainda. `confirmarColeta`
 *                               fecha o passo;
 *   demais (CORREIOS, e o que sobrar) → `EM TRANSITO`, como sempre. A
 *                               postagem É a coleta.
 *
 * `null` = sem transição. Não há status novo: `EXPEDICAO` é o mesmo de
 * sempre, e as dez funções do banco que conhecem o vocabulário não mudam.
 *
 * Extraída de `despachar()` em 14/09/2026 (PEDIDO COMPLEMENTAR, E9): o
 * despacho conjunto leva o complemento para o MESMO destino do principal, e a
 * regra precisa ser uma só para os dois.
 */
export function destinoDoDespacho(
  tipoEntrega: "TRANSPORTE" | "RETIRADA",
  tipoFrete: TipoFreteNormalizado
): string | null {
  if (tipoEntrega === "RETIRADA") return "A RETIRAR";
  if (tipoFrete === "TRANSPORTADORA" || tipoFrete === "MOTOBOY") return null;
  return "EM TRANSITO";
}
